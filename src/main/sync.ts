/**
 * 云同步引擎（端到端加密），协议见 docs/server-api.md。
 *
 * - 本地修改由数据库触发器记录（sync_dirty / sync_tombstones，见 db.ts v7），业务代码无需关心同步
 * - 一轮同步 = 拉取 → 合并 → 推送；推送遇到冲突（其他设备刚改过）时重新拉取后再推，最多 3 轮
 * - 冲突以记录为单位按修改时间「后写者胜」；删除与修改冲突时删除优先
 * - 服务端只看到记录类型、随机 id、版本号、修改时间和密文
 */
import type Database from 'better-sqlite3'
import type { Category, ExtraField, Repeat, StatusKind } from '../shared/types'
import { cloudRequest, cloudState, onSessionChange, setSyncStatus, vaultKey } from './cloud'
import { decrypt, encrypt } from './crypto'
import { SYNC_TABLES, getDb, type SyncKind } from './db'
import { decryptRecord, encryptRecord } from './e2ee'
import { getSetting, setSetting } from './settings'
import { updateTrayMenu } from './tray'
import { broadcast, syncWidgets } from './windows'

const KEY = { cursor: 'sync.cursor', account: 'sync.account' }
const PAGE = 500
const MAX_ROUNDS = 3
const INTERVAL_MS = 2 * 60_000
const DEBOUNCE_MS = 3_000

const TABLE: Record<SyncKind, string> = Object.fromEntries(SYNC_TABLES.map((t) => [t.kind, t.table])) as Record<
  SyncKind,
  string
>
const KINDS = SYNC_TABLES.map((t) => t.kind)
const isKind = (k: string): k is SyncKind => (KINDS as string[]).includes(k)

// ---------- 记录内容（加密前的明文结构） ----------

type Ref = string | null

interface PriorityData {
  label: string
  name: string
  color: string
  sort_order: number
  is_default: boolean
}
interface StatusData {
  name: string
  color: string
  kind: StatusKind
  sort_order: number
}
interface ProjectData {
  name: string
  color: string
  description: string
  sort_order: number
}
interface EntryData {
  project: Ref
  category: Category
  title: string
  env: string
  url: string
  username: string
  password: string
  verify_code: string
  totp: string
  expires_at: string
  notes: string
  tags: string
  extra: ExtraField[]
  favorite: boolean
  created_at: string
  updated_at: string
}
interface TodoData {
  project: Ref
  parent: Ref
  priority: Ref
  status: Ref
  title: string
  notes: string
  done: boolean
  done_at: string | null
  start_date: string
  due_date: string
  remind_at: string
  tags: string
  repeat: Repeat
  created_at: string
  updated_at: string
}
interface CommentData {
  todo: string
  content: string
  created_at: string
}

// ---------- 服务端接口 ----------

interface RemoteItem {
  kind: string
  id: string
  revision: number
  deleted: boolean
  modifiedAt: number
  payload?: string | null
}
interface PullResponse {
  items: RemoteItem[]
  revision: number
  hasMore: boolean
}
interface ItemRef {
  kind: string
  id: string
  revision: number
}
interface PushResponse {
  accepted: ItemRef[]
  conflicts: ItemRef[]
  revision: number
}

// ---------- 工具 ----------

type Row = Record<string, unknown> & { id: number; uid: string; sync_rev: number; sync_dirty: number; sync_mtime: number }

const db = (): Database.Database => getDb()

const stmtCache = new Map<string, Database.Statement>()
function stmt(sql: string): Database.Statement {
  let s = stmtCache.get(sql)
  if (!s) {
    s = db().prepare(sql)
    stmtCache.set(sql, s)
  }
  return s
}

const uidOf = (kind: SyncKind, id: unknown): Ref =>
  id == null ? null : ((stmt(`SELECT uid FROM ${TABLE[kind]} WHERE id = ?`).get(id) as { uid: string } | undefined)?.uid ?? null)

const idOf = (kind: SyncKind, uid: Ref): number | null =>
  uid == null ? null : ((stmt(`SELECT id FROM ${TABLE[kind]} WHERE uid = ?`).get(uid) as { id: number } | undefined)?.id ?? null)

function firstStatus(done: boolean): number | null {
  const kinds = done ? ['done'] : ['todo', 'active']
  for (const k of kinds) {
    const row = stmt(`SELECT id FROM statuses WHERE kind = ? ORDER BY sort_order, id LIMIT 1`).get(k) as { id: number } | undefined
    if (row) return row.id
  }
  return null
}

function defaultPriority(): number | null {
  const row = stmt(`SELECT id FROM priorities ORDER BY is_default DESC, sort_order, id LIMIT 1`).get() as { id: number } | undefined
  return row?.id ?? null
}

/** 本地记录 → 明文内容（解开本机 DPAPI 加密的字段，把关联 id 转成 uid） */
function serialize(kind: SyncKind, r: Row): unknown {
  switch (kind) {
    case 'priority':
      return { label: r.label, name: r.name, color: r.color, sort_order: r.sort_order, is_default: !!r.is_default } as PriorityData
    case 'status':
      return { name: r.name, color: r.color, kind: r.kind, sort_order: r.sort_order } as StatusData
    case 'project':
      return { name: r.name, color: r.color, description: r.description, sort_order: r.sort_order } as ProjectData
    case 'entry': {
      let extra: ExtraField[] = []
      try {
        extra = (JSON.parse(String(r.extra)) as ExtraField[]).map((f) => ({
          key: f.key ?? '',
          secret: !!f.secret,
          value: f.secret ? decrypt(f.value) : (f.value ?? '')
        }))
      } catch {
        extra = []
      }
      return {
        project: uidOf('project', r.project_id),
        category: r.category as Category,
        title: String(r.title),
        env: String(r.env),
        url: String(r.url),
        username: String(r.username),
        password: decrypt(r.password as string),
        verify_code: String(r.verify_code),
        totp: decrypt(r.totp as string),
        expires_at: String(r.expires_at),
        notes: String(r.notes),
        tags: String(r.tags),
        extra,
        favorite: !!r.favorite,
        created_at: String(r.created_at),
        updated_at: String(r.updated_at)
      } satisfies EntryData
    }
    case 'todo':
      return {
        project: uidOf('project', r.project_id),
        parent: uidOf('todo', r.parent_id),
        priority: uidOf('priority', r.priority),
        status: uidOf('status', r.status_id),
        title: String(r.title),
        notes: String(r.notes),
        done: !!r.done,
        done_at: (r.done_at as string | null) ?? null,
        start_date: String(r.start_date),
        due_date: String(r.due_date),
        remind_at: String(r.remind_at),
        tags: String(r.tags),
        repeat: r.repeat as Repeat,
        created_at: String(r.created_at),
        updated_at: String(r.updated_at)
      } satisfies TodoData
    case 'comment':
      return { todo: uidOf('todo', r.todo_id) ?? '', content: String(r.content), created_at: String(r.created_at) } satisfies CommentData
  }
}

/** 按 uid 插入或覆盖本地记录，并记下服务端版本；extraSet 为覆盖时额外执行的赋值 */
function upsert(kind: SyncKind, uid: string, data: Record<string, unknown>, item: RemoteItem, extraSet: string[] = []): void {
  const table = TABLE[kind]
  const cols = Object.keys(data)
  const sql = `INSERT INTO ${table} (uid, ${cols.join(', ')}, sync_rev, sync_dirty, sync_mtime)
    VALUES (@uid, ${cols.map((c) => '@' + c).join(', ')}, @sync_rev, 0, @sync_mtime)
    ON CONFLICT(uid) DO UPDATE SET ${[...cols.map((c) => `${c} = excluded.${c}`), ...extraSet].join(', ')},
      sync_rev = excluded.sync_rev, sync_dirty = 0, sync_mtime = excluded.sync_mtime`
  const params: Record<string, unknown> = { uid, sync_rev: item.revision, sync_mtime: item.modifiedAt }
  for (const [k, v] of Object.entries(data)) params[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v
  stmt(sql).run(params)
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** 云端内容写入本地（调用方已开启 sync_apply，触发器不会把这些写入当作本地修改） */
function applyUpsert(kind: SyncKind, item: RemoteItem, data: unknown, parents: Map<string, Ref>): void {
  const d = data as Record<string, unknown>
  switch (kind) {
    case 'priority':
      return upsert(kind, item.id, {
        label: str(d.label, '?'),
        name: str(d.name),
        color: str(d.color, '#3b6cff'),
        sort_order: num(d.sort_order),
        is_default: !!d.is_default
      }, item)
    case 'status':
      return upsert(kind, item.id, {
        name: str(d.name, '?'),
        color: str(d.color, '#8a919e'),
        kind: ['todo', 'active', 'done'].includes(d.kind as string) ? d.kind : 'todo',
        sort_order: num(d.sort_order)
      }, item)
    case 'project':
      return upsert(kind, item.id, {
        name: str(d.name, '未命名项目'),
        color: str(d.color, '#3b6cff'),
        description: str(d.description),
        sort_order: num(d.sort_order)
      }, item)
    case 'entry': {
      const e = d as Partial<EntryData>
      const extra = (Array.isArray(e.extra) ? e.extra : []).map((f) => ({
        key: str(f?.key),
        secret: !!f?.secret,
        value: f?.secret ? encrypt(str(f?.value)) : str(f?.value)
      }))
      return upsert(kind, item.id, {
        project_id: idOf('project', e.project ?? null),
        category: str(e.category, 'other'),
        title: str(e.title, '未命名'),
        env: str(e.env),
        url: str(e.url),
        username: str(e.username),
        password: encrypt(str(e.password)),
        verify_code: str(e.verify_code),
        totp: encrypt(str(e.totp)),
        expires_at: str(e.expires_at),
        notes: str(e.notes),
        tags: str(e.tags),
        extra: JSON.stringify(extra),
        favorite: !!e.favorite,
        created_at: str(e.created_at, new Date().toLocaleString('sv')),
        updated_at: str(e.updated_at, new Date().toLocaleString('sv'))
      }, item)
    }
    case 'todo': {
      const t = d as Partial<TodoData>
      const done = !!t.done
      // 父任务可能在本批稍后才写入，先置空，全部写完后再补上
      parents.set(item.id, t.parent ?? null)
      return upsert(
        kind,
        item.id,
        {
          project_id: idOf('project', t.project ?? null),
          parent_id: idOf('todo', t.parent ?? null),
          title: str(t.title, '未命名'),
          notes: str(t.notes),
          priority: idOf('priority', t.priority ?? null) ?? defaultPriority(),
          status_id: idOf('status', t.status ?? null) ?? firstStatus(done),
          done,
          done_at: done ? (t.done_at ?? null) : null,
          start_date: str(t.start_date),
          due_date: str(t.due_date),
          remind_at: str(t.remind_at),
          tags: str(t.tags),
          repeat: str(t.repeat),
          created_at: str(t.created_at, new Date().toLocaleString('sv')),
          updated_at: str(t.updated_at, new Date().toLocaleString('sv'))
        },
        item,
        // 提醒时间变化后重新提醒；已完成的任务从桌面移除
        ['reminded = CASE WHEN remind_at <> excluded.remind_at THEN 0 ELSE reminded END',
          'pinned = CASE WHEN excluded.done = 1 THEN 0 ELSE pinned END']
      )
    }
    case 'comment': {
      const c = d as Partial<CommentData>
      const todoId = idOf('todo', c.todo ?? null)
      if (todoId == null) return // 所属待办已在本机删除
      return upsert(kind, item.id, {
        todo_id: todoId,
        content: str(c.content),
        created_at: str(c.created_at, new Date().toLocaleString('sv'))
      }, item)
    }
  }
}

// ---------- 拉取与合并 ----------

interface Decoded {
  item: RemoteItem
  kind: SyncKind
  data: unknown
}

/** 被依赖的类型先写入；删除按相反顺序 */
const ORDER: SyncKind[] = ['priority', 'status', 'project', 'entry', 'todo', 'comment']

/** 合并云端变更，返回是否改动了本地数据 */
function applyRemote(items: Decoded[], cursor: number): boolean {
  const d = db()
  let changed = false
  d.transaction(() => {
    d.prepare(`INSERT INTO sync_apply (x) VALUES (1)`).run()
    const parents = new Map<string, Ref>()
    const deletes: Decoded[] = []

    const sorted = [...items].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.item.revision - b.item.revision)
    for (const x of sorted) {
      const { item, kind } = x
      const table = TABLE[kind]
      const local = stmt(`SELECT id, sync_rev, sync_dirty, sync_mtime FROM ${table} WHERE uid = ?`).get(item.id) as
        | Pick<Row, 'id' | 'sync_rev' | 'sync_dirty' | 'sync_mtime'>
        | undefined
      const tomb = stmt(`SELECT rev, mtime FROM sync_tombstones WHERE kind = ? AND uid = ?`).get(kind, item.id) as
        | { rev: number; mtime: number }
        | undefined

      if (local && local.sync_rev >= item.revision) continue // 本机已是该版本（通常是自己刚推送的）

      // 删除优先：一端删除、另一端同时修改时保留删除。
      // 否则删除项目导致的「所属项目置空」这类连带修改会让已删除的待办复活
      if (tomb) {
        if (item.deleted) stmt(`DELETE FROM sync_tombstones WHERE kind = ? AND uid = ?`).run(kind, item.id)
        else stmt(`UPDATE sync_tombstones SET rev = ? WHERE kind = ? AND uid = ?`).run(item.revision, kind, item.id)
        continue
      }
      if (!item.deleted && local?.sync_dirty && local.sync_mtime > item.modifiedAt) {
        // 本机修改更晚：保留本机内容，记下云端版本号以便推送
        stmt(`UPDATE ${table} SET sync_rev = ? WHERE id = ?`).run(item.revision, local.id)
        continue
      }

      if (item.deleted) {
        if (local) deletes.push(x)
        continue
      }
      applyUpsert(kind, item, x.data, parents)
      changed = true
    }

    // 补上父子关系
    for (const [uid, parentUid] of parents) {
      if (parentUid) stmt(`UPDATE todos SET parent_id = ? WHERE uid = ?`).run(idOf('todo', parentUid), uid)
    }

    deletes.sort((a, b) => ORDER.indexOf(b.kind) - ORDER.indexOf(a.kind))
    for (const { kind, item } of deletes) {
      stmt(`DELETE FROM ${TABLE[kind]} WHERE uid = ?`).run(item.id)
      changed = true
    }

    setSetting(KEY.cursor, String(cursor))
    d.prepare(`DELETE FROM sync_apply`).run()

    // 云端删除了本机待办仍在使用的优先级 / 状态时，改用默认值（作为本机修改同步出去）
    const def = defaultPriority()
    if (def != null) d.prepare(`UPDATE todos SET priority = ? WHERE priority NOT IN (SELECT id FROM priorities)`).run(def)
    for (const done of [false, true]) {
      const s = firstStatus(done)
      if (s != null)
        d.prepare(`UPDATE todos SET status_id = ? WHERE done = ? AND status_id NOT IN (SELECT id FROM statuses)`).run(s, done ? 1 : 0)
    }
  })()
  return changed
}

async function pull(key: Buffer, account: string): Promise<boolean> {
  let since = Number(getSetting(KEY.cursor) ?? 0) || 0
  const items: RemoteItem[] = []
  for (;;) {
    const page = await cloudRequest<PullResponse>(`/api/sync/pull?since=${since}&limit=${PAGE}`)
    items.push(...page.items)
    since = page.revision
    if (!page.hasMore) break
  }
  if (currentAccount() !== account) throw new Error('账号已变更，同步已取消')

  const decoded: Decoded[] = []
  for (const item of items) {
    if (!isKind(item.kind)) continue // 新版本客户端才支持的类型，忽略
    let data: unknown = null
    if (!item.deleted) {
      try {
        data = decryptRecord(key, item.kind, item.id, item.payload ?? '')
      } catch {
        throw new Error('无法解密云端数据：数据密钥不匹配或数据已损坏，请重新登录')
      }
    }
    decoded.push({ item, kind: item.kind, data })
  }
  return applyRemote(decoded, since)
}

// ---------- 推送 ----------

interface Outgoing {
  kind: SyncKind
  id: string
  baseRevision: number
  deleted: boolean
  modifiedAt: number
  payload: string | null
}

function collect(key: Buffer, limit: number): Outgoing[] {
  const out: Outgoing[] = []
  for (const { table, kind } of SYNC_TABLES) {
    if (out.length >= limit) break
    const rows = stmt(`SELECT * FROM ${table} WHERE sync_dirty = 1 AND uid IS NOT NULL ORDER BY id LIMIT ?`).all(
      limit - out.length
    ) as Row[]
    for (const r of rows) {
      out.push({
        kind,
        id: r.uid,
        baseRevision: r.sync_rev,
        deleted: false,
        modifiedAt: r.sync_mtime,
        payload: encryptRecord(key, kind, r.uid, serialize(kind, r))
      })
    }
  }
  if (out.length < limit) {
    const tombs = stmt(`SELECT kind, uid, rev, mtime FROM sync_tombstones ORDER BY mtime LIMIT ?`).all(limit - out.length) as {
      kind: string
      uid: string
      rev: number
      mtime: number
    }[]
    for (const t of tombs) {
      if (isKind(t.kind)) out.push({ kind: t.kind, id: t.uid, baseRevision: t.rev, deleted: true, modifiedAt: t.mtime, payload: null })
    }
  }
  return out
}

/** 推送本机修改，返回是否存在冲突（需要重新拉取） */
async function push(key: Buffer, account: string): Promise<boolean> {
  for (;;) {
    const changes = collect(key, PAGE)
    if (!changes.length) return false
    const res = await cloudRequest<PushResponse>('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) })
    if (currentAccount() !== account) throw new Error('账号已变更，同步已取消')

    const sent = new Map(changes.map((c) => [`${c.kind}/${c.id}`, c]))
    db().transaction(() => {
      for (const a of res.accepted) {
        const c = sent.get(`${a.kind}/${a.id}`)
        if (!c) continue
        if (c.deleted) {
          stmt(`DELETE FROM sync_tombstones WHERE kind = ? AND uid = ? AND mtime = ?`).run(c.kind, c.id, c.modifiedAt)
        } else {
          // 推送期间又被修改的记录保持待同步
          stmt(
            `UPDATE ${TABLE[c.kind]} SET sync_rev = @rev, sync_dirty = CASE WHEN sync_mtime = @mtime THEN 0 ELSE 1 END WHERE uid = @uid`
          ).run({ rev: a.revision, mtime: c.modifiedAt, uid: c.id })
        }
      }
    })()
    if (res.conflicts.length) {
      resolveConflicts(res.conflicts)
      return true
    }
    if (changes.length < PAGE) return false
  }
}

/**
 * 冲突的记录需要拉取云端版本后再合并。正常情况下它们的版本号都大于游标，下次拉取自然会带回；
 * 游标异常（如恢复了旧的本地数据库）时把游标回退，确保能拉到这些记录。
 */
function resolveConflicts(conflicts: ItemRef[]): void {
  db().transaction(() => {
    let cursor = Number(getSetting(KEY.cursor) ?? 0) || 0
    for (const c of conflicts) {
      if (!isKind(c.kind)) continue
      if (c.revision === 0) {
        // 云端没有这条记录（例如服务端数据被清空）：修改按新记录重新上传，删除则无需再推送
        stmt(`UPDATE ${TABLE[c.kind]} SET sync_rev = 0 WHERE uid = ?`).run(c.id)
        stmt(`DELETE FROM sync_tombstones WHERE kind = ? AND uid = ?`).run(c.kind, c.id)
      } else {
        cursor = Math.min(cursor, c.revision - 1)
      }
    }
    setSetting(KEY.cursor, String(cursor))
  })()
}

// ---------- 账号绑定与调度 ----------

function currentAccount(): string | null {
  const s = cloudState()
  return s.loggedIn && s.user ? `${s.serverUrl}|${s.user.id}` : null
}

/** 切换到另一个账号（或服务器）时，本机所有数据视为未同步，登录后整体上传并与云端合并 */
function bindAccount(account: string): void {
  if (getSetting(KEY.account) === account) return
  const d = db()
  d.transaction(() => {
    for (const { table } of SYNC_TABLES) d.prepare(`UPDATE ${table} SET sync_rev = 0, sync_dirty = 1`).run()
    d.prepare(`DELETE FROM sync_tombstones WHERE rev > 0`).run()
    setSetting(KEY.cursor, '0')
    setSetting(KEY.account, account)
  })()
}

export function pendingCount(): number {
  const parts = SYNC_TABLES.map(({ table }) => `(SELECT COUNT(*) FROM ${table} WHERE sync_dirty = 1)`)
  return (stmt(`SELECT ${parts.join(' + ')} + (SELECT COUNT(*) FROM sync_tombstones) AS n`).get() as { n: number }).n
}

let running: Promise<void> | null = null
let rerun = false
let debounce: NodeJS.Timeout | null = null
let interval: NodeJS.Timeout | null = null

async function runOnce(): Promise<void> {
  const account = currentAccount()
  const key = vaultKey()
  if (!account || !key) return
  bindAccount(account)
  setSyncStatus({ syncing: true })
  let changed = false
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      changed = (await pull(key, account)) || changed
      if (!(await push(key, account))) break
    }
    setSyncStatus({ lastSyncAt: new Date().toISOString(), error: null })
  } catch (e) {
    if (currentAccount()) setSyncStatus({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    if (changed) {
      syncWidgets()
      broadcast('todos:changed')
      updateTrayMenu()
    }
    if (currentAccount()) setSyncStatus({ syncing: false, pending: pendingCount() })
  }
}

/** 立即同步；正在同步时等待当前这轮结束后再补一轮 */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = runOnce().finally(() => {
    running = null
    if (rerun) {
      rerun = false
      void syncNow()
    }
  })
  return running
}

/** 本地数据变化后调用：合并短时间内的多次修改，稍后再同步 */
export function scheduleSync(delay = DEBOUNCE_MS): void {
  if (!currentAccount()) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void syncNow()
  }, delay)
}

function start(): void {
  if (!interval) interval = setInterval(() => void syncNow(), INTERVAL_MS)
  setSyncStatus({ pending: pendingCount() })
  scheduleSync(1_000)
}

function stop(): void {
  if (interval) clearInterval(interval)
  if (debounce) clearTimeout(debounce)
  interval = debounce = null
}

export function initSync(): void {
  onSessionChange((loggedIn) => (loggedIn ? start() : stop()))
  if (currentAccount()) start()
}
