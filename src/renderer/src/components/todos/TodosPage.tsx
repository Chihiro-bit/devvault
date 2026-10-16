import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PriorityLevel, Project, Scope, Todo, TodoStatus } from '../../../../shared/types'
import { REPEAT_LABEL, dueInfo, levelOf, splitTags, today } from '../../constants'
import { Icon } from '../Icon'
import { PriorityModal } from '../PriorityModal'
import { Empty, ProjectTag, confirmDialog, errText, toast } from '../ui'
import { PriorityBadge, PriorityPicker, StatusLabel, StatusPicker, SubtaskProgress } from './shared'
import { StatusModal } from './StatusModal'
import { TaskDrawer } from './TaskDrawer'

type Filter = 'open' | 'top' | 'today' | 'overdue' | 'done'
type View = 'list' | 'board' | 'calendar'
type GroupBy = 'status' | 'priority' | 'project' | 'none'

interface Props {
  scope: Scope
  keyword: string
  projects: Project[]
  levels: PriorityLevel[]
  statuses: TodoStatus[]
  version: number
  /** 从通知等处要求打开的任务，n 递增表示新的跳转 */
  focus?: { todoId: number; n: number }
  onChanged: () => void
}

/** 视图、分组等个人偏好保存在 localStorage，读写失败时使用默认值 */
function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || fallback
    } catch {
      return fallback
    }
  })
  return [
    v,
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* 忽略 */
      }
    }
  ]
}

export function TodosPage({ scope, keyword, projects, levels, statuses, version, focus, onChanged }: Props) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [view, setView] = usePref<View>('todo.view', 'list')
  const [groupBy, setGroupBy] = usePref<GroupBy>('todo.groupBy', 'status')
  const [openId, setOpenId] = useState<number | null>(null)
  const [managing, setManaging] = useState<null | 'priority' | 'status'>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [due, setDue] = useState('')
  const [pid, setPid] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const defaultLevel = (levels.find((l) => l.is_default) ?? levels[0])?.id ?? 0
  const priority = picked != null && levels.some((l) => l.id === picked) ? picked : defaultLevel
  const top = levels[0]

  useEffect(() => {
    let alive = true
    window.api
      .listTodos({ scope, keyword })
      .then((r) => alive && setTodos(r))
      .catch((e) => toast(errText(e), 'err'))
    return () => {
      alive = false
    }
  }, [scope, keyword, version])

  useEffect(() => {
    if (focus) setOpenId(focus.todoId)
  }, [focus?.n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !document.querySelector('.modal-mask, .drawer-mask')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 无搜索时只展示顶层任务，子任务在详情中查看；搜索时子任务也参与匹配
  const visible = keyword.trim() ? todos : todos.filter((t) => !t.parent_id)

  const d = today()
  const isTop = (t: Todo) => t.priority === top?.id
  const isToday = (t: Todo) => t.due_date === d
  const isOverdue = (t: Todo) => !!t.due_date && t.due_date < d

  const openTodos = visible.filter((t) => !t.done)
  const stats = {
    open: openTodos.length,
    top: openTodos.filter(isTop).length,
    today: openTodos.filter(isToday).length,
    overdue: openTodos.filter(isOverdue).length,
    done: visible.length - openTodos.length
  }

  const match = (t: Todo, f: Filter, board: boolean) => {
    switch (f) {
      case 'open':
        return board || !t.done
      case 'done':
        return board || t.done
      case 'top':
        return !t.done && isTop(t)
      case 'today':
        return !t.done && isToday(t)
      case 'overdue':
        return !t.done && isOverdue(t)
    }
  }
  const shown = visible.filter((t) => match(t, filter, view !== 'list'))

  const add = async (statusId?: number, text = title) => {
    if (!text.trim()) return
    try {
      await window.api.saveTodo({
        project_id: typeof scope === 'number' ? scope : pid,
        title: text,
        notes: '',
        priority,
        status_id: statusId,
        due_date: due
      })
      if (text === title) {
        setTitle('')
        setDue('')
      }
      onChanged()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const patchStatus = async (t: Todo, status_id: number) => {
    await window.api.patchTodo(t.id, { status_id })
    onChanged()
  }

  const toggle = async (t: Todo) => {
    await window.api.toggleTodo(t.id)
    onChanged()
  }

  const togglePin = async (t: Todo) => {
    await window.api.pinTodo(t.id, !t.pinned)
    toast(t.pinned ? '已从桌面移除' : '已添加到桌面，可拖动任务条调整位置')
    onChanged()
  }

  const clearDone = async () => {
    if (!(await confirmDialog(`将删除当前范围内已完成的待办（含其子任务）。`, { title: '清理已完成', okText: '清理' }))) return
    const n = await window.api.clearDoneTodos(scope)
    toast(`已清理 ${n} 条`)
    onChanged()
  }

  const cards: { key: Filter; label: string; value: number; tone?: string; color?: string }[] = [
    { key: 'open', label: '进行中', value: stats.open },
    { key: 'top', label: top ? `${top.label} ${top.name}`.trim() : '最高优先级', value: stats.top, color: top?.color },
    { key: 'today', label: '今天到期', value: stats.today, tone: 'today' },
    { key: 'overdue', label: '已逾期', value: stats.overdue, tone: 'overdue' },
    { key: 'done', label: '已完成', value: stats.done, tone: 'done' }
  ]

  // ---------- 列表分组 ----------
  const groups: { key: string; head: ReactNode; items: Todo[] }[] = (() => {
    switch (groupBy) {
      case 'status':
        return statuses.map((s) => ({
          key: `s${s.id}`,
          head: <StatusLabel name={s.name} color={s.color} />,
          items: shown.filter((t) => t.status_id === s.id)
        }))
      case 'priority':
        return [...levels, null].map((l) => {
          const meta = l ?? levelOf({ priority_label: null, priority_name: null, priority_color: null })
          return {
            key: `p${l?.id ?? 'none'}`,
            head: (
              <>
                <span className="pbadge" style={{ ['--p' as string]: meta.color }}>
                  {meta.label}
                </span>
                {meta.name && <span className="group-name">{meta.name}</span>}
              </>
            ),
            items: shown.filter((t) => (l ? t.priority === l.id : !t.priority_label))
          }
        })
      case 'project':
        return [...projects, null].map((p) => ({
          key: `j${p?.id ?? 'none'}`,
          head: p ? <ProjectTag name={p.name} color={p.color} /> : <span className="group-name">未分组</span>,
          items: shown.filter((t) => t.project_id === (p?.id ?? null))
        }))
      default:
        return [{ key: 'all', head: null, items: shown }]
    }
  })().filter((g) => g.items.length)

  const toggleGroup = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const rowProps = (t: Todo) => ({
    t,
    statuses,
    showProject: typeof scope !== 'number' && groupBy !== 'project',
    onOpen: () => setOpenId(t.id),
    onToggle: () => toggle(t),
    onStatus: (s: number) => patchStatus(t, s),
    onPin: () => togglePin(t)
  })

  return (
    <section className="view todo-page">
      <div className="stat-row">
        {cards.map((c) => (
          <button
            key={c.key}
            className={`stat ${c.tone ?? ''} ${filter === c.key ? 'on' : ''}`}
            style={c.color ? { ['--tone' as string]: c.color } : undefined}
            onClick={() => setFilter(c.key)}
          >
            <span className="stat-value">{c.value}</span>
            <span className="stat-label">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="todo-toolbar">
        <div className="segmented small view-switch">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            <Icon name="list" size={14} /> 列表
          </button>
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
            <Icon name="board" size={14} /> 看板
          </button>
          <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>
            <Icon name="calendar" size={14} /> 日历
          </button>
        </div>
        {view === 'list' && (
          <label className="group-by">
            分组
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="status">按状态</option>
              <option value="priority">按优先级</option>
              <option value="project">按项目</option>
              <option value="none">不分组</option>
            </select>
          </label>
        )}
        <span className="spacer" />
        {filter === 'done' && stats.done > 0 && (
          <button className="btn ghost sm" onClick={clearDone}>
            <Icon name="trash" size={13} /> 清理已完成
          </button>
        )}
        <button className="btn ghost sm" onClick={() => setManaging('status')}>
          <Icon name="sliders" size={13} /> 状态
        </button>
        <button className="btn ghost sm" onClick={() => setManaging('priority')}>
          <Icon name="sliders" size={13} /> 优先级
        </button>
      </div>

      <div className="quick-add">
        <Icon name="plus" size={16} className="qa-icon" />
        <input
          ref={inputRef}
          value={title}
          placeholder="添加待办，回车保存（Ctrl + N 聚焦）"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
        />
        <PriorityPicker levels={levels} value={priority} onChange={setPicked} />
        {typeof scope !== 'number' && (
          <select value={pid ?? ''} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : null)} title="所属项目">
            <option value="">未分组</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="截止日期" />
        <button className="btn primary" onClick={() => add()} disabled={!title.trim()}>
          添加
        </button>
      </div>

      {view === 'calendar' ? (
        <CalendarView
          todos={shown}
          onOpen={(t) => setOpenId(t.id)}
          onMove={async (t, date) => {
            await window.api.patchTodo(t.id, { due_date: date })
            onChanged()
          }}
          onPickDay={(date) => {
            setDue(date)
            inputRef.current?.focus()
          }}
        />
      ) : view === 'board' ? (
        <Board todos={shown} statuses={statuses} rowProps={rowProps} onDropStatus={patchStatus} onAdd={(s, text) => add(s, text)} />
      ) : (
        <div className="scroll">
          {shown.length === 0 ? (
            <Empty
              icon={<Icon name="check" size={28} />}
              title={
                keyword
                  ? `没有找到与「${keyword}」相关的待办`
                  : filter === 'done'
                    ? '还没有已完成的待办'
                    : filter === 'open'
                      ? '没有待办事项，轻松一下 ☕'
                      : '这里没有待办'
              }
            />
          ) : (
            groups.map((g) => (
              <div className="todo-group" key={g.key}>
                {g.head && (
                  <button className="group-head" onClick={() => toggleGroup(g.key)}>
                    <Icon name={collapsed.has(g.key) ? 'subtask' : 'down'} size={13} className="group-caret" />
                    {g.head}
                    <span className="group-count">{g.items.length}</span>
                  </button>
                )}
                {!collapsed.has(g.key) && (
                  <ul className="todo-list">
                    {g.items.map((t) => (
                      <TaskRow key={t.id} {...rowProps(t)} />
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {openId != null && (
        <TaskDrawer
          todoId={openId}
          statuses={statuses}
          levels={levels}
          projects={projects}
          version={version}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      )}
      {managing === 'priority' && (
        <PriorityModal
          levels={levels}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null)
            onChanged()
          }}
        />
      )}
      {managing === 'status' && (
        <StatusModal
          statuses={statuses}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

// ---------- 列表行 ----------

interface RowProps {
  t: Todo
  statuses: TodoStatus[]
  showProject: boolean
  onOpen: () => void
  onToggle: () => void
  onStatus: (statusId: number) => void
  onPin: () => void
}

function TaskMeta({ t }: { t: Todo }) {
  return (
    <>
      <SubtaskProgress t={t} />
      {t.repeat && (
        <span className="meta-icon" title={`重复：${REPEAT_LABEL[t.repeat]}`}>
          <Icon name="repeat" size={12} />
        </span>
      )}
      {t.comment_count > 0 && (
        <span className="meta-icon" title={`${t.comment_count} 条进展记录`}>
          <Icon name="message" size={12} />
          {t.comment_count}
        </span>
      )}
      {t.attachment_count > 0 && (
        <span className="meta-icon" title={`${t.attachment_count} 个附件`}>
          <Icon name="paperclip" size={12} />
          {t.attachment_count}
        </span>
      )}
      {splitTags(t.tags).map((tag) => (
        <span className="tag-chip" key={tag}>
          #{tag}
        </span>
      ))}
    </>
  )
}

function TaskRow({ t, statuses, showProject, onOpen, onToggle, onStatus, onPin }: RowProps) {
  const due = dueInfo(t)
  return (
    <li className={`todo task-row ${t.done ? 'done' : ''}`} onClick={onOpen}>
      <button
        className={`check ${t.done ? 'on' : ''}`}
        style={{ borderColor: t.done ? undefined : (t.priority_color ?? undefined) }}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        title={t.done ? '标记为未完成' : '标记为完成'}
      >
        {t.done && <Icon name="tick" size={12} />}
      </button>
      <div className="todo-main">
        <div className="todo-title">
          {t.parent_title && <span className="parent-crumb">{t.parent_title} /</span>}
          {t.title}
        </div>
        <div className="todo-meta">
          <TaskMeta t={t} />
          {t.notes && <span className="todo-notes">{t.notes.split('\n')[0]}</span>}
        </div>
      </div>
      <div className="row-cols">
        {!t.done && (
          <button
            className={`pin-btn ${t.pinned ? 'on' : ''}`}
            title={t.pinned ? '从桌面移除' : '添加到桌面'}
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
          >
            <Icon name="pin" size={13} />
            {t.pinned ? '已在桌面' : '到桌面'}
          </button>
        )}
        <span className="col-status">
          <StatusPicker t={t} statuses={statuses} onChange={onStatus} />
        </span>
        <span className="col-prio">
          <PriorityBadge t={t} />
        </span>
        <span className={`col-due due ${due?.cls ?? ''}`}>
          {due && (
            <>
              <Icon name="calendar" size={12} /> {due.text}
            </>
          )}
        </span>
        {showProject && (
          <span className="col-proj">
            <ProjectTag name={t.project_name} color={t.project_color} />
          </span>
        )}
      </div>
    </li>
  )
}

// ---------- 看板 ----------

function Board({
  todos,
  statuses,
  rowProps,
  onDropStatus,
  onAdd
}: {
  todos: Todo[]
  statuses: TodoStatus[]
  rowProps: (t: Todo) => RowProps
  onDropStatus: (t: Todo, statusId: number) => void
  onAdd: (statusId: number, text: string) => void
}) {
  const [over, setOver] = useState<number | null>(null)
  const [adding, setAdding] = useState<number | null>(null)
  const [text, setText] = useState('')
  const byId = new Map(todos.map((t) => [t.id, t]))

  return (
    <div className="board">
      {statuses.map((s) => {
        const items = todos.filter((t) => t.status_id === s.id)
        return (
          <div
            key={s.id}
            className={`board-col ${over === s.id ? 'over' : ''}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/x-todo')) return
              e.preventDefault()
              setOver(s.id)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
            }}
            onDrop={(e) => {
              setOver(null)
              const t = byId.get(Number(e.dataTransfer.getData('text/x-todo')))
              if (t && t.status_id !== s.id) onDropStatus(t, s.id)
            }}
          >
            <div className="board-head" style={{ ['--s' as string]: s.color }}>
              <i />
              <span>{s.name}</span>
              <em>{items.length}</em>
            </div>
            <div className="board-cards">
              {items.map((t) => (
                <BoardCard key={t.id} {...rowProps(t)} />
              ))}
              {adding === s.id ? (
                <input
                  autoFocus
                  className="board-add-input"
                  value={text}
                  placeholder="输入后回车"
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => {
                    setAdding(null)
                    setText('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) {
                      onAdd(s.id, text)
                      setText('')
                    }
                    if (e.key === 'Escape') setAdding(null)
                  }}
                />
              ) : (
                <button className="board-add" onClick={() => setAdding(s.id)}>
                  <Icon name="plus" size={13} /> 添加任务
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BoardCard({ t, showProject, onOpen }: RowProps) {
  const due = dueInfo(t)
  return (
    <div
      className={`board-card ${t.done ? 'done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-todo', String(t.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
    >
      <div className="bc-top">
        <PriorityBadge t={t} />
        {t.pinned && (
          <span className="meta-icon pinned" title="已在桌面">
            <Icon name="pin" size={12} />
          </span>
        )}
      </div>
      <div className="bc-title">{t.title}</div>
      <div className="todo-meta">
        {due && (
          <span className={`due ${due.cls}`}>
            <Icon name="calendar" size={12} /> {due.text}
          </span>
        )}
        {showProject && <ProjectTag name={t.project_name} color={t.project_color} />}
        <TaskMeta t={t} />
      </div>
    </div>
  )
}

// ---------- 日历 ----------

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function CalendarView({
  todos,
  onOpen,
  onMove,
  onPickDay
}: {
  todos: Todo[]
  onOpen: (t: Todo) => void
  onMove: (t: Todo, date: string) => void
  onPickDay: (date: string) => void
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [over, setOver] = useState<string | null>(null)
  const d0 = today()

  // 以周一为一周的开始，固定显示 6 周
  const start = new Date(month)
  start.setDate(1 - ((month.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })

  const byDate = new Map<string, Todo[]>()
  for (const t of todos) {
    if (!t.due_date) continue
    byDate.set(t.due_date, [...(byDate.get(t.due_date) ?? []), t])
  }
  const byId = new Map(todos.map((t) => [t.id, t]))
  const unscheduled = todos.filter((t) => !t.due_date && !t.done).length

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} title="上个月">
          <Icon name="back" size={15} />
        </button>
        <h3>
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </h3>
        <button className="icon-btn flip" onClick={() => shift(1)} title="下个月">
          <Icon name="back" size={15} />
        </button>
        <button
          className="btn sm"
          onClick={() => {
            const d = new Date()
            setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
          }}
        >
          今天
        </button>
        <span className="spacer" />
        {unscheduled > 0 && <span className="muted cal-note">{unscheduled} 项未设置截止日期（在列表中查看）</span>}
        <span className="muted cal-note">拖动任务可改期，点击日期可在该日添加</span>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal-wd ${i >= 5 ? 'weekend' : ''}`}>
            周{w}
          </div>
        ))}
        {days.map((d) => {
          const key = d.toLocaleDateString('sv')
          const items = byDate.get(key) ?? []
          const cls = [
            'cal-cell',
            d.getMonth() !== month.getMonth() && 'other',
            key === d0 && 'today',
            (d.getDay() === 0 || d.getDay() === 6) && 'weekend',
            over === key && 'over'
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={key}
              className={cls}
              onClick={() => onPickDay(key)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/x-todo')) return
                e.preventDefault()
                setOver(key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
              }}
              onDrop={(e) => {
                setOver(null)
                const t = byId.get(Number(e.dataTransfer.getData('text/x-todo')))
                if (t && t.due_date !== key) onMove(t, key)
              }}
            >
              <div className="cal-day">
                <span>{d.getDate()}</span>
                {items.length > 0 && <em>{items.length}</em>}
              </div>
              <div className="cal-items">
                {items.map((t) => (
                  <div
                    key={t.id}
                    className={`cal-task ${t.done ? 'done' : ''}`}
                    style={{ ['--p' as string]: t.priority_color ?? 'var(--muted)' }}
                    draggable
                    title={`${t.priority_label ?? ''} ${t.title}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/x-todo', String(t.id))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(t)
                    }}
                  >
                    {t.title}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
