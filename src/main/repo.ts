import { getDb } from './db'
import { decrypt, encrypt } from './crypto'
import type {
  Attachment,
  AttachmentOwner,
  Category,
  Entry,
  EntryInput,
  ExtraField,
  ImportResult,
  ListQuery,
  PriorityInput,
  PriorityLevel,
  PriorityRemoval,
  Project,
  ProjectInput,
  Scope,
  Repeat,
  StatusInput,
  StatusKind,
  Stats,
  Todo,
  TodoComment,
  TodoInput,
  TodoPatch,
  TodoStatus
} from '../shared/types'

const NOW = `datetime('now','localtime')`
const DATE_RE = /^(\d{4}-\d{2}-\d{2})?$/
const CATEGORIES: Category[] = ['account', 'git', 'vpn', 'server', 'database', 'other']

// ---------- 通用查询片段 ----------

function scopeClause(scope: Scope, col: string, params: unknown[]): string[] {
  if (scope === 'none') return [`${col} IS NULL`]
  if (typeof scope === 'number') {
    params.push(scope)
    return [`${col} = ?`]
  }
  return []
}

/** 空格分隔的多个关键词需全部命中，每个关键词在任一列中模糊匹配即可 */
function keywordClauses(keyword: string | undefined, cols: string[], params: unknown[]): string[] {
  const words = (keyword ?? '').trim().split(/\s+/).filter(Boolean)
  return words.map((w) => {
    const like = `%${w.replace(/[\\%_]/g, (m) => '\\' + m)}%`
    cols.forEach(() => params.push(like))
    return '(' + cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')'
  })
}

function whereSql(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

function normalizeTags(tags: string): string {
  return Array.from(
    new Set(
      tags
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ).join(',')
}

// ---------- 项目 ----------

export function listProjects(): Project[] {
  return getDb()
    .prepare(
      `SELECT p.id, p.name, p.color, p.description, p.created_at,
        (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id) AS entry_count,
        (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.done = 0 AND t.parent_id IS NULL) AS todo_count
       FROM projects p ORDER BY p.sort_order, p.id`
    )
    .all() as Project[]
}

export function saveProject(p: ProjectInput): number {
  const db = getDb()
  const data = { name: p.name.trim(), color: p.color, description: p.description.trim() }
  if (!data.name) throw new Error('项目名称不能为空')
  if (p.id) {
    db.prepare(`UPDATE projects SET name=@name, color=@color, description=@description WHERE id=@id`).run({
      ...data,
      id: p.id
    })
    return p.id
  }
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM projects`).get() as { m: number }
  return Number(
    db
      .prepare(`INSERT INTO projects (name, color, description, sort_order) VALUES (@name, @color, @description, @sort)`)
      .run({ ...data, sort: max.m + 1 }).lastInsertRowid
  )
}

export function deleteProject(id: number): void {
  getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id)
}

export function getStats(): Stats {
  return getDb()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM entries) AS entries,
        (SELECT COUNT(*) FROM todos WHERE done = 0 AND parent_id IS NULL) AS todos,
        (SELECT COUNT(*) FROM entries WHERE project_id IS NULL) AS noneEntries,
        (SELECT COUNT(*) FROM todos WHERE done = 0 AND parent_id IS NULL AND project_id IS NULL) AS noneTodos`
    )
    .get() as Stats
}

// ---------- 账号凭据 ----------

interface EntryRow extends Omit<Entry, 'favorite' | 'extra' | 'attachments'> {
  favorite: number
  extra: string
}

function rowToEntry(r: EntryRow): Entry {
  let extra: ExtraField[] = []
  try {
    extra = (JSON.parse(r.extra) as ExtraField[]).map((f) => ({
      key: f.key ?? '',
      secret: !!f.secret,
      value: f.secret ? decrypt(f.value) : (f.value ?? '')
    }))
  } catch {
    extra = []
  }
  return { ...r, password: decrypt(r.password), totp: decrypt(r.totp), favorite: !!r.favorite, extra, attachments: [] }
}

export function listEntries(q: ListQuery): Entry[] {
  const params: unknown[] = []
  const clauses = [
    ...scopeClause(q.scope, 'e.project_id', params),
    ...keywordClauses(
      q.keyword,
      [
        'e.title',
        'e.username',
        'e.url',
        'e.notes',
        'e.tags',
        'e.env',
        'e.verify_code',
        'e.extra',
        'p.name',
        `(SELECT group_concat(a.name, ' ') FROM attachments a WHERE a.entry_id = e.id)`
      ],
      params
    )
  ]
  const rows = getDb()
    .prepare(
      `SELECT e.*, p.name AS project_name, p.color AS project_color
       FROM entries e LEFT JOIN projects p ON p.id = e.project_id
       ${whereSql(clauses)}
       ORDER BY e.favorite DESC, e.updated_at DESC, e.id DESC`
    )
    .all(...params) as EntryRow[]
  const entries = rows.map(rowToEntry)

  const byEntry = new Map(entries.map((e) => [e.id, e]))
  const files = getDb()
    .prepare(`SELECT id, entry_id, name, size, created_at FROM attachments WHERE entry_id IS NOT NULL ORDER BY id`)
    .all() as (Attachment & { entry_id: number })[]
  for (const { entry_id, ...a } of files) byEntry.get(entry_id)?.attachments.push(a)
  return entries
}

function entryParams(e: EntryInput) {
  const extra = (e.extra ?? [])
    .filter((f) => f.key.trim() || f.value)
    .map((f) => ({ key: f.key.trim(), secret: !!f.secret, value: f.secret ? encrypt(f.value) : f.value }))
  return {
    project_id: e.project_id ?? null,
    category: CATEGORIES.includes(e.category) ? e.category : 'other',
    title: e.title.trim(),
    env: e.env ?? '',
    url: (e.url ?? '').trim(),
    username: e.username ?? '',
    password: encrypt(e.password ?? ''),
    verify_code: (e.verify_code ?? '').trim(),
    totp: encrypt((e.totp ?? '').trim()),
    expires_at: DATE_RE.test(e.expires_at ?? '') ? (e.expires_at ?? '') : '',
    notes: e.notes ?? '',
    tags: normalizeTags(e.tags ?? ''),
    extra: JSON.stringify(extra),
    favorite: e.favorite ? 1 : 0
  }
}

export function saveEntry(e: EntryInput): number {
  const db = getDb()
  const data = entryParams(e)
  if (!data.title) throw new Error('名称不能为空')
  if (e.id) {
    db.prepare(
      `UPDATE entries SET project_id=@project_id, category=@category, title=@title, env=@env, url=@url,
        username=@username, password=@password, verify_code=@verify_code, totp=@totp, expires_at=@expires_at,
        notes=@notes, tags=@tags,
        extra=@extra, favorite=@favorite, updated_at=${NOW}
       WHERE id=@id`
    ).run({ ...data, id: e.id })
    return e.id
  }
  return Number(
    db
      .prepare(
        `INSERT INTO entries (project_id, category, title, env, url, username, password, verify_code, totp, expires_at,
           notes, tags, extra, favorite)
         VALUES (@project_id, @category, @title, @env, @url, @username, @password, @verify_code, @totp, @expires_at,
           @notes, @tags, @extra, @favorite)`
      )
      .run(data).lastInsertRowid
  )
}

export function deleteEntry(id: number): void {
  getDb().prepare(`DELETE FROM entries WHERE id = ?`).run(id)
}

export function toggleFavorite(id: number): void {
  getDb().prepare(`UPDATE entries SET favorite = 1 - favorite WHERE id = ?`).run(id)
}

// ---------- 待办 ----------

interface TodoRow extends Omit<Todo, 'done' | 'pinned' | 'pin_top'> {
  done: number
  pinned: number
  pin_top: number
}

const TODO_SELECT = `SELECT t.id, t.project_id, t.parent_id, t.title, t.notes, t.priority, t.status_id,
    t.start_date, t.due_date, t.remind_at, t.tags, t.repeat, t.done, t.done_at, t.pinned, t.pin_top, t.created_at, t.updated_at,
    p.name AS project_name, p.color AS project_color,
    pr.label AS priority_label, pr.name AS priority_name, pr.color AS priority_color,
    st.name AS status_name, st.color AS status_color,
    COALESCE(st.kind, CASE WHEN t.done = 1 THEN 'done' ELSE 'todo' END) AS status_kind,
    par.title AS parent_title,
    (SELECT COUNT(*) FROM todos c WHERE c.parent_id = t.id) AS subtask_total,
    (SELECT COUNT(*) FROM todos c WHERE c.parent_id = t.id AND c.done = 1) AS subtask_done,
    (SELECT COUNT(*) FROM todo_comments m WHERE m.todo_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM attachments a WHERE a.todo_id = t.id) AS attachment_count
  FROM todos t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN priorities pr ON pr.id = t.priority
  LEFT JOIN statuses st ON st.id = t.status_id
  LEFT JOIN todos par ON par.id = t.parent_id`

/** 按等级顺序排序，未定级（等级已不存在）的排最后 */
const PRIORITY_ORDER = `COALESCE(pr.sort_order, 1000000)`
const TODO_ORDER = `t.done ASC, ${PRIORITY_ORDER} ASC, (t.due_date = '') ASC, t.due_date ASC, t.id DESC`

const REPEATS: Repeat[] = ['', 'daily', 'weekdays', 'weekly', 'monthly']
const REMIND_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/

const rowToTodo = (r: TodoRow): Todo => ({ ...r, done: !!r.done, pinned: !!r.pinned, pin_top: !!r.pin_top })

/** 返回范围内的全部待办（含子任务），由界面决定是否只展示顶层任务 */
export function listTodos(q: ListQuery): Todo[] {
  const params: unknown[] = []
  const clauses = [
    ...scopeClause(q.scope, 't.project_id', params),
    ...keywordClauses(q.keyword, ['t.title', 't.notes', 't.tags', 'p.name'], params)
  ]
  const rows = getDb()
    .prepare(`${TODO_SELECT} ${whereSql(clauses)} ORDER BY ${TODO_ORDER}`)
    .all(...params) as TodoRow[]
  return rows.map(rowToTodo)
}

export function listSubtasks(parentId: number): Todo[] {
  const rows = getDb()
    .prepare(`${TODO_SELECT} WHERE t.parent_id = ? ORDER BY t.done ASC, t.id ASC`)
    .all(parentId) as TodoRow[]
  return rows.map(rowToTodo)
}

export function getTodo(id: number): Todo | null {
  const row = getDb().prepare(`${TODO_SELECT} WHERE t.id = ?`).get(id) as TodoRow | undefined
  return row ? rowToTodo(row) : null
}

function statusById(id: number | undefined | null): { id: number; kind: StatusKind } | undefined {
  if (id == null) return undefined
  return getDb().prepare(`SELECT id, kind FROM statuses WHERE id = ?`).get(id) as { id: number; kind: StatusKind } | undefined
}

/** 按顺序取第一个属于给定分类的状态 */
function firstStatus(kinds: StatusKind[]): number {
  for (const kind of kinds) {
    const row = getDb().prepare(`SELECT id FROM statuses WHERE kind = ? ORDER BY sort_order, id LIMIT 1`).get(kind) as
      | { id: number }
      | undefined
    if (row) return row.id
  }
  throw new Error('没有可用的状态')
}

/** 新建待办（或导入时整体写入）。子任务沿用父任务的项目 */
export function saveTodo(t: TodoInput): number {
  const db = getDb()
  const parent = t.parent_id ? (db.prepare(`SELECT id, project_id FROM todos WHERE id = ?`).get(t.parent_id) as
    | { id: number; project_id: number | null }
    | undefined) : undefined
  const status = statusById(t.status_id) ?? statusById(firstStatus(['todo', 'active']))!
  const data = {
    project_id: parent ? parent.project_id : (t.project_id ?? null),
    parent_id: parent?.id ?? null,
    title: t.title.trim(),
    notes: t.notes ?? '',
    priority: priorityExists(t.priority) ? t.priority : defaultPriorityId(),
    status_id: status.id,
    done: status.kind === 'done' ? 1 : 0,
    start_date: DATE_RE.test(t.start_date ?? '') ? (t.start_date ?? '') : '',
    due_date: DATE_RE.test(t.due_date ?? '') ? (t.due_date ?? '') : '',
    remind_at: REMIND_RE.test(t.remind_at ?? '') ? (t.remind_at ?? '') : '',
    tags: normalizeTags(t.tags ?? ''),
    repeat: REPEATS.includes(t.repeat ?? '') ? (t.repeat ?? '') : ''
  }
  if (!data.title) throw new Error('待办内容不能为空')
  if (t.id) {
    db.prepare(
      `UPDATE todos SET project_id=@project_id, parent_id=@parent_id, title=@title, notes=@notes, priority=@priority,
        status_id=@status_id, done=@done, start_date=@start_date, due_date=@due_date, remind_at=@remind_at, reminded=0,
        tags=@tags, repeat=@repeat, updated_at=${NOW} WHERE id=@id`
    ).run({ ...data, id: t.id })
    return t.id
  }
  return Number(
    db
      .prepare(
        `INSERT INTO todos (project_id, parent_id, title, notes, priority, status_id, done, done_at, start_date, due_date,
           remind_at, tags, repeat)
         VALUES (@project_id, @parent_id, @title, @notes, @priority, @status_id, @done,
           CASE WHEN @done = 1 THEN ${NOW} ELSE NULL END, @start_date, @due_date, @remind_at, @tags, @repeat)`
      )
      .run(data).lastInsertRowid
  )
}

/** 修改状态，同步完成标记；完成时从桌面移除，重复任务自动生成下一次 */
function setStatus(id: number, statusId: number): void {
  const db = getDb()
  const st = statusById(statusId)
  if (!st) throw new Error('状态不存在')
  const cur = db.prepare(`SELECT done, pinned FROM todos WHERE id = ?`).get(id) as
    | { done: number; pinned: number }
    | undefined
  if (!cur) return
  const done = st.kind === 'done' ? 1 : 0
  db.prepare(
    `UPDATE todos SET status_id = @s, done = @done,
      done_at = CASE WHEN @done = 1 THEN COALESCE(done_at, ${NOW}) ELSE NULL END,
      pinned = CASE WHEN @done = 1 THEN 0 ELSE pinned END,
      updated_at = ${NOW}
     WHERE id = @id`
  ).run({ s: st.id, done, id })
  if (done && !cur.done) spawnNextOccurrence(id, !!cur.pinned)
}

/** 勾选 / 取消勾选：在第一个「已完成」与第一个「未开始」状态之间切换 */
export function toggleTodo(id: number): void {
  const cur = getDb().prepare(`SELECT done FROM todos WHERE id = ?`).get(id) as { done: number } | undefined
  if (!cur) return
  setStatus(id, cur.done ? firstStatus(['todo', 'active']) : firstStatus(['done']))
}

export function patchTodo(id: number, patch: TodoPatch): void {
  const db = getDb()
  db.transaction(() => {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = @${col}`)
      params[col] = v
    }
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new Error('待办内容不能为空')
      set('title', patch.title.trim())
    }
    if (patch.notes !== undefined) set('notes', patch.notes)
    if (patch.priority !== undefined) set('priority', priorityExists(patch.priority) ? patch.priority : defaultPriorityId())
    if (patch.start_date !== undefined) set('start_date', DATE_RE.test(patch.start_date) ? patch.start_date : '')
    if (patch.due_date !== undefined) set('due_date', DATE_RE.test(patch.due_date) ? patch.due_date : '')
    if (patch.remind_at !== undefined) {
      set('remind_at', REMIND_RE.test(patch.remind_at) ? patch.remind_at : '')
      set('reminded', 0)
    }
    if (patch.tags !== undefined) set('tags', normalizeTags(patch.tags))
    if (patch.repeat !== undefined) set('repeat', REPEATS.includes(patch.repeat) ? patch.repeat : '')
    if (patch.project_id !== undefined) {
      set('project_id', patch.project_id)
      // 子任务跟随父任务的项目
      db.prepare(`UPDATE todos SET project_id = ? WHERE parent_id = ?`).run(patch.project_id, id)
    }
    if (sets.length) db.prepare(`UPDATE todos SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = @id`).run(params)
    if (patch.status_id !== undefined) setStatus(id, patch.status_id)
  })()
}

// ---------- 重复任务 ----------

const fmtDate = (d: Date) => d.toLocaleDateString('sv')

function advance(d: Date, repeat: Repeat): void {
  if (repeat === 'daily') d.setDate(d.getDate() + 1)
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
  else if (repeat === 'weekdays') {
    do d.setDate(d.getDate() + 1)
    while (d.getDay() === 0 || d.getDay() === 6)
  } else if (repeat === 'monthly') {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
}

/** 下一次的截止日期：从原截止日期（无则今天）起按规则推进，直到不早于今天 */
export function nextDueDate(due: string, repeat: Repeat, today = fmtDate(new Date())): string {
  const d = new Date(`${due || today}T00:00:00`)
  do advance(d, repeat)
  while (fmtDate(d) < today)
  return fmtDate(d)
}

function spawnNextOccurrence(id: number, wasPinned: boolean): void {
  const db = getDb()
  const t = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(id) as
    | (Omit<Todo, 'pin_top'> & { pin_top: number; pin_x: number | null; pin_y: number | null })
    | undefined
  if (!t || !t.repeat) return

  const due = nextDueDate(t.due_date, t.repeat)
  let start = ''
  if (t.start_date) {
    const gap = t.due_date ? (Date.parse(t.due_date) - Date.parse(t.start_date)) / 86400000 : 0
    const s = new Date(`${due}T00:00:00`)
    s.setDate(s.getDate() - Math.max(0, Math.round(gap)))
    start = fmtDate(s)
  }
  // 提醒时间保留原来的时刻，日期对齐到新的截止日期
  const remind = t.remind_at ? `${due}T${t.remind_at.slice(11, 16)}` : ''
  const newId = saveTodo({
    project_id: t.project_id,
    parent_id: t.parent_id,
    title: t.title,
    notes: t.notes,
    priority: t.priority,
    start_date: start,
    due_date: due,
    remind_at: remind,
    tags: t.tags,
    repeat: t.repeat
  })
  // 子任务作为检查清单一并复制（重置为未完成）
  for (const c of db.prepare(`SELECT title, notes, priority, tags FROM todos WHERE parent_id = ? ORDER BY id`).all(id) as {
    title: string
    notes: string
    priority: number
    tags: string
  }[]) {
    saveTodo({ ...c, project_id: t.project_id, parent_id: newId, due_date: '' })
  }
  // 原任务不再重复；钉在桌面上的话，新任务接替其位置
  db.prepare(`UPDATE todos SET repeat = '' WHERE id = ?`).run(id)
  if (wasPinned) {
    db.prepare(`UPDATE todos SET pinned = 1, pin_x = ?, pin_y = ?, pin_top = ? WHERE id = ?`).run(
      t.pin_x,
      t.pin_y,
      t.pin_top,
      newId
    )
  }
}

export function deleteTodo(id: number): void {
  // 子任务、进展记录、附件记录随外键级联删除，附件文件由 attachments.gc() 清理
  getDb().prepare(`DELETE FROM todos WHERE id = ?`).run(id)
}

/** 清理已完成的顶层任务（仍有未完成子任务的除外），其子任务一并删除 */
export function clearDoneTodos(scope: Scope): number {
  const params: unknown[] = []
  const clauses = [
    'done = 1',
    'parent_id IS NULL',
    'NOT EXISTS (SELECT 1 FROM todos c WHERE c.parent_id = todos.id AND c.done = 0)',
    ...scopeClause(scope, 'project_id', params)
  ]
  return getDb().prepare(`DELETE FROM todos ${whereSql(clauses)}`).run(...params).changes
}

// ---------- 提醒 ----------

/** 已到提醒时间、尚未提醒过的未完成待办 */
export function dueReminders(now: string): { id: number; title: string; due_date: string }[] {
  return getDb()
    .prepare(
      `SELECT id, title, due_date FROM todos
       WHERE done = 0 AND reminded = 0 AND remind_at <> '' AND remind_at <= ? ORDER BY remind_at`
    )
    .all(now) as { id: number; title: string; due_date: string }[]
}

export function markReminded(id: number): void {
  getDb().prepare(`UPDATE todos SET reminded = 1 WHERE id = ?`).run(id)
}

export interface Digest {
  dueToday: { id: number; title: string }[]
  overdue: number
  expiring: { id: number; title: string; expires_at: string }[]
}

/** 每日摘要：今天到期、已逾期的顶层待办，以及 N 天内到期（含已过期）的账号 */
export function digest(today: string, expiryDays: number): Digest {
  const db = getDb()
  const limit = new Date(`${today}T00:00:00`)
  limit.setDate(limit.getDate() + expiryDays)
  return {
    dueToday: db
      .prepare(`SELECT id, title FROM todos WHERE done = 0 AND parent_id IS NULL AND due_date = ? ORDER BY id`)
      .all(today) as Digest['dueToday'],
    overdue: (
      db
        .prepare(`SELECT COUNT(*) AS n FROM todos WHERE done = 0 AND parent_id IS NULL AND due_date <> '' AND due_date < ?`)
        .get(today) as { n: number }
    ).n,
    expiring: db
      .prepare(`SELECT id, title, expires_at FROM entries WHERE expires_at <> '' AND expires_at <= ? ORDER BY expires_at`)
      .all(limit.toLocaleDateString('sv')) as Digest['expiring']
  }
}

// ---------- 进展记录 ----------

export function listComments(todoId: number): TodoComment[] {
  return getDb().prepare(`SELECT * FROM todo_comments WHERE todo_id = ? ORDER BY id`).all(todoId) as TodoComment[]
}

export function addComment(todoId: number, content: string): number {
  if (!content.trim()) throw new Error('内容不能为空')
  return Number(
    getDb().prepare(`INSERT INTO todo_comments (todo_id, content) VALUES (?, ?)`).run(todoId, content.trim()).lastInsertRowid
  )
}

export function deleteComment(id: number): void {
  getDb().prepare(`DELETE FROM todo_comments WHERE id = ?`).run(id)
}

// ---------- 状态 ----------

export function listStatuses(): TodoStatus[] {
  return getDb()
    .prepare(
      `SELECT s.id, s.name, s.color, s.kind, s.sort_order,
        (SELECT COUNT(*) FROM todos t WHERE t.status_id = s.id) AS todo_count
       FROM statuses s ORDER BY s.sort_order, s.id`
    )
    .all() as TodoStatus[]
}

/** 整体保存状态配置；被删除状态下的待办迁移到 moveTo（未指定则迁到同分类的第一个状态） */
export function saveStatuses(items: StatusInput[], removed: PriorityRemoval[]): void {
  const clean = items.map((x) => ({ ...x, name: x.name.trim() }))
  if (clean.some((x) => !x.name)) throw new Error('状态名称不能为空')
  const names = clean.map((x) => x.name)
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) throw new Error(`状态「${dup}」重复`)
  if (!clean.some((x) => x.kind === 'done')) throw new Error('至少需要一个「已完成」类的状态')
  if (!clean.some((x) => x.kind !== 'done')) throw new Error('至少需要一个未完成类的状态')

  const db = getDb()
  db.transaction(() => {
    const oldKinds = new Map(listStatuses().map((x) => [x.id, x.kind]))
    const update = db.prepare(`UPDATE statuses SET name=@name, color=@color, kind=@kind, sort_order=@sort WHERE id=@id`)
    const insert = db.prepare(`INSERT INTO statuses (name, color, kind, sort_order) VALUES (@name, @color, @kind, @sort)`)
    const saved = clean.map((x, sort) => {
      const row = { name: x.name, color: x.color, kind: x.kind, sort }
      if (x.id) {
        update.run({ ...row, id: x.id })
        return { id: x.id, kind: x.kind }
      }
      return { id: Number(insert.run(row).lastInsertRowid), kind: x.kind }
    })
    const kept = new Set(saved.map((x) => x.id))
    const move = db.prepare(`UPDATE todos SET status_id = ? WHERE status_id = ?`)
    for (const r of removed) {
      if (kept.has(r.id)) continue
      const kind = oldKinds.get(r.id)
      const target = r.moveTo != null && kept.has(r.moveTo) ? r.moveTo : (saved.find((x) => x.kind === kind) ?? saved[0]).id
      move.run(target, r.id)
      db.prepare(`DELETE FROM statuses WHERE id = ?`).run(r.id)
    }
    // 状态分类可能变化，重新同步完成标记
    db.prepare(
      `UPDATE todos SET done = 1, done_at = COALESCE(done_at, ${NOW}), pinned = 0
       WHERE done = 0 AND status_id IN (SELECT id FROM statuses WHERE kind = 'done')`
    ).run()
    db.prepare(
      `UPDATE todos SET done = 0, done_at = NULL WHERE done = 1 AND status_id IN (SELECT id FROM statuses WHERE kind <> 'done')`
    ).run()
  })()
}

// ---------- 附件元数据（文件读写见 attachments.ts） ----------

function ownerCol(owner: AttachmentOwner): ['entry_id' | 'todo_id', number] {
  return 'entryId' in owner ? ['entry_id', owner.entryId] : ['todo_id', owner.todoId]
}

export function listAttachments(owner: AttachmentOwner): Attachment[] {
  const [col, id] = ownerCol(owner)
  return getDb()
    .prepare(`SELECT id, name, size, created_at FROM attachments WHERE ${col} = ? ORDER BY id`)
    .all(id) as Attachment[]
}

export function insertAttachment(owner: AttachmentOwner, name: string, size: number, stored: string): number {
  const [col, id] = ownerCol(owner)
  const exists = getDb()
    .prepare(`SELECT 1 FROM ${col === 'entry_id' ? 'entries' : 'todos'} WHERE id = ?`)
    .get(id)
  if (!exists) throw new Error('所属记录不存在')
  return Number(
    getDb()
      .prepare(`INSERT INTO attachments (${col}, name, size, stored) VALUES (?, ?, ?, ?)`)
      .run(id, name, size, stored).lastInsertRowid
  )
}

export function getAttachment(id: number): (Attachment & { stored: string }) | undefined {
  return getDb().prepare(`SELECT id, name, size, stored, created_at FROM attachments WHERE id = ?`).get(id) as
    | (Attachment & { stored: string })
    | undefined
}

export function deleteAttachmentRow(id: number): void {
  getDb().prepare(`DELETE FROM attachments WHERE id = ?`).run(id)
}

export function storedFileNames(): Set<string> {
  return new Set((getDb().prepare(`SELECT stored FROM attachments`).all() as { stored: string }[]).map((r) => r.stored))
}

// ---------- 优先级 ----------

export function listPriorities(): PriorityLevel[] {
  const rows = getDb()
    .prepare(
      `SELECT pr.id, pr.label, pr.name, pr.color, pr.sort_order, pr.is_default,
        (SELECT COUNT(*) FROM todos t WHERE t.priority = pr.id AND t.done = 0) AS todo_count
       FROM priorities pr ORDER BY pr.sort_order, pr.id`
    )
    .all() as (Omit<PriorityLevel, 'is_default'> & { is_default: number })[]
  return rows.map((r) => ({ ...r, is_default: !!r.is_default }))
}

function priorityExists(id: number): boolean {
  return !!getDb().prepare(`SELECT 1 FROM priorities WHERE id = ?`).get(id)
}

export function defaultPriorityId(): number {
  const row = getDb()
    .prepare(`SELECT id FROM priorities ORDER BY is_default DESC, sort_order, id LIMIT 1`)
    .get() as { id: number } | undefined
  if (!row) throw new Error('没有可用的优先级')
  return row.id
}

/**
 * 整体保存优先级配置：数组顺序即优先顺序（靠前更优先）。
 * 被删除等级下的待办（含已完成）迁移到 moveTo 指定的等级，未指定则迁移到默认等级。
 */
export function savePriorities(levels: PriorityInput[], removed: PriorityRemoval[]): void {
  const clean = levels.map((l) => ({ ...l, label: l.label.trim(), name: l.name.trim() }))
  if (!clean.length) throw new Error('至少需要保留一个优先级')
  if (clean.some((l) => !l.label)) throw new Error('优先级标签不能为空')
  const labels = clean.map((l) => l.label)
  const dup = labels.find((l, i) => labels.indexOf(l) !== i)
  if (dup) throw new Error(`优先级标签「${dup}」重复`)

  const db = getDb()
  db.transaction(() => {
    const update = db.prepare(`UPDATE priorities SET label=@label, name=@name, color=@color, sort_order=@sort WHERE id=@id`)
    const insert = db.prepare(`INSERT INTO priorities (label, name, color, sort_order) VALUES (@label, @name, @color, @sort)`)
    const ids = clean.map((l, sort) => {
      const row = { label: l.label, name: l.name, color: l.color, sort }
      if (l.id) {
        update.run({ ...row, id: l.id })
        return l.id
      }
      return Number(insert.run(row).lastInsertRowid)
    })

    const defIdx = Math.max(0, clean.findIndex((l) => l.is_default))
    db.prepare(`UPDATE priorities SET is_default = (id = ?)`).run(ids[defIdx])

    const kept = new Set(ids)
    const move = db.prepare(`UPDATE todos SET priority = ? WHERE priority = ?`)
    const del = db.prepare(`DELETE FROM priorities WHERE id = ?`)
    for (const r of removed) {
      if (kept.has(r.id)) continue
      move.run(r.moveTo != null && kept.has(r.moveTo) ? r.moveTo : ids[defIdx], r.id)
      del.run(r.id)
    }
  })()
}

// ---------- 桌面任务条 ----------

export interface PinState {
  id: number
  pin_top: boolean
  pin_x: number | null
  pin_y: number | null
}

export function listPinned(): PinState[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.pin_top, t.pin_x, t.pin_y FROM todos t LEFT JOIN priorities pr ON pr.id = t.priority
       WHERE t.pinned = 1 AND t.done = 0 ORDER BY ${PRIORITY_ORDER}, t.id`
    )
    .all() as (Omit<PinState, 'pin_top'> & { pin_top: number })[]
  return rows.map((r) => ({ ...r, pin_top: !!r.pin_top }))
}

export function setPinned(id: number, pinned: boolean): void {
  getDb().prepare(`UPDATE todos SET pinned = ? WHERE id = ? AND done = 0`).run(pinned ? 1 : 0, id)
}

export function setPinTop(id: number, top: boolean): void {
  getDb().prepare(`UPDATE todos SET pin_top = ? WHERE id = ?`).run(top ? 1 : 0, id)
}

export function setPinPos(id: number, x: number, y: number): void {
  getDb().prepare(`UPDATE todos SET pin_x = ?, pin_y = ? WHERE id = ?`).run(x, y, id)
}

// ---------- 备份 ----------

export interface BackupAttachment {
  entry_id?: number | null
  todo_id?: number | null
  name: string
  size: number
  /** 备份目录 attachments/ 下的文件名 */
  file: string
}

export interface BackupFile {
  app: 'dev-vault'
  version: 1 | 2 | 3 | 4
  exported_at: string
  priorities?: { id: number; label: string; name: string; color: string }[]
  statuses?: { id: number; name: string; color: string; kind: StatusKind }[]
  projects: { id: number; name: string; color: string; description: string }[]
  entries: Entry[]
  todos: Todo[]
  comments?: { todo_id: number; content: string; created_at: string }[]
  attachments?: BackupAttachment[]
}

export function exportAll(): BackupFile {
  const db = getDb()
  return {
    app: 'dev-vault',
    version: 4,
    exported_at: new Date().toISOString(),
    priorities: listPriorities().map(({ id, label, name, color }) => ({ id, label, name, color })),
    statuses: listStatuses().map(({ id, name, color, kind }) => ({ id, name, color, kind })),
    projects: listProjects().map(({ id, name, color, description }) => ({ id, name, color, description })),
    entries: listEntries({ scope: 'all' }).map(({ attachments: _a, ...e }) => ({ ...e, attachments: [] })),
    todos: listTodos({ scope: 'all' }),
    comments: db.prepare(`SELECT todo_id, content, created_at FROM todo_comments ORDER BY id`).all() as BackupFile['comments'],
    attachments: db
      .prepare(`SELECT entry_id, todo_id, name, size, stored AS file FROM attachments ORDER BY id`)
      .all() as BackupAttachment[]
  }
}

/**
 * 导入为追加合并：同名项目、同名状态、同标签优先级复用，账号和待办全部新增。
 * importFile 负责把备份中的附件文件复制进来，返回新的存储文件名（缺失时返回 null）。
 */
export function importAll(data: BackupFile, importFile: (file: string) => string | null): ImportResult {
  if (data?.app !== 'dev-vault' || !Array.isArray(data.entries)) throw new Error('不是有效的 DevVault 备份文件')
  const db = getDb()
  const result: ImportResult = { projects: 0, entries: 0, todos: 0 }

  db.transaction(() => {
    const idMap = new Map<number, number>()
    const existing = new Map(listProjects().map((p) => [p.name, p.id]))
    for (const p of data.projects ?? []) {
      let newId = existing.get(p.name)
      if (newId === undefined) {
        newId = saveProject({ name: p.name, color: p.color, description: p.description ?? '' })
        existing.set(p.name, newId)
        result.projects++
      }
      idMap.set(p.id, newId)
    }
    const mapPid = (pid: number | null) => (pid == null ? null : (idMap.get(pid) ?? null))

    const entryMap = new Map<number, number>()
    for (const e of data.entries) {
      entryMap.set(e.id, saveEntry({ ...e, id: undefined, project_id: mapPid(e.project_id) }))
      result.entries++
    }

    const mapPriority = priorityMapper(data)
    const mapStatus = statusMapper(data)
    const todoMap = new Map<number, number>()
    const setDoneAt = db.prepare(`UPDATE todos SET done_at = ? WHERE id = ?`)
    for (const t of data.todos ?? []) {
      const id = saveTodo({
        ...t,
        id: undefined,
        parent_id: null,
        project_id: mapPid(t.project_id),
        priority: mapPriority(t.priority),
        status_id: mapStatus(t)
      })
      if (t.done && t.done_at) setDoneAt.run(t.done_at, id)
      todoMap.set(t.id, id)
      result.todos++
    }
    // 第二遍恢复父子关系
    const setParent = db.prepare(`UPDATE todos SET parent_id = ? WHERE id = ?`)
    for (const t of data.todos ?? []) {
      const parent = t.parent_id != null ? todoMap.get(t.parent_id) : undefined
      if (parent) setParent.run(parent, todoMap.get(t.id))
    }

    const insComment = db.prepare(`INSERT INTO todo_comments (todo_id, content, created_at) VALUES (?, ?, ?)`)
    for (const c of data.comments ?? []) {
      const tid = todoMap.get(c.todo_id)
      if (tid) insComment.run(tid, c.content, c.created_at)
    }

    for (const a of data.attachments ?? []) {
      const owner =
        a.entry_id != null && entryMap.has(a.entry_id)
          ? { entryId: entryMap.get(a.entry_id)! }
          : a.todo_id != null && todoMap.has(a.todo_id)
            ? { todoId: todoMap.get(a.todo_id)! }
            : null
      if (!owner) continue
      const stored = importFile(a.file)
      if (stored) insertAttachment(owner, a.name, a.size, stored)
    }
  })()

  return result
}

/** 备份中的状态映射到当前库：v4 按名称匹配（缺失则追加），旧版本按完成标记对应 */
function statusMapper(data: BackupFile): (t: Todo) => number {
  const firstDone = firstStatus(['done'])
  const firstOpen = firstStatus(['todo', 'active'])
  if (!data.statuses) return (t) => (t.done ? firstDone : firstOpen)

  const db = getDb()
  const current = listStatuses()
  const byName = new Map(current.map((x) => [x.name, x.id]))
  let sort = current.length
  const map = new Map<number, number>()
  for (const x of data.statuses) {
    let id = byName.get(x.name)
    if (id === undefined) {
      id = Number(
        db
          .prepare(`INSERT INTO statuses (name, color, kind, sort_order) VALUES (?, ?, ?, ?)`)
          .run(x.name, x.color, x.kind, sort++).lastInsertRowid
      )
      byName.set(x.name, id)
    }
    map.set(x.id, id)
  }
  return (t) => map.get(t.status_id) ?? (t.done ? firstDone : firstOpen)
}

/**
 * 备份中的优先级映射到当前库的等级 id：
 * v1 为 2 高 / 1 中 / 0 低，v2 为 0~3 的序号，均按当前等级顺序对应；
 * v3 按标签匹配，当前库没有的标签会追加为新等级。
 */
function priorityMapper(data: BackupFile): (p: number) => number {
  const levels = listPriorities()
  const byIndex = (i: number) => levels[Math.min(Math.max(i, 0), levels.length - 1)].id
  if (data.version === 1) return (p) => byIndex({ 2: 1, 1: 2, 0: 3 }[p] ?? 2)
  if (data.version === 2 || !data.priorities) return (p) => byIndex(p)

  const db = getDb()
  const byLabel = new Map(levels.map((l) => [l.label, l.id]))
  let sort = levels.length
  const map = new Map<number, number>()
  for (const p of data.priorities) {
    let id = byLabel.get(p.label)
    if (id === undefined) {
      id = Number(
        db
          .prepare(`INSERT INTO priorities (label, name, color, sort_order) VALUES (?, ?, ?, ?)`)
          .run(p.label, p.name ?? '', p.color, sort++).lastInsertRowid
      )
      byLabel.set(p.label, id)
    }
    map.set(p.id, id)
  }
  const def = defaultPriorityId()
  return (p) => map.get(p) ?? def
}
