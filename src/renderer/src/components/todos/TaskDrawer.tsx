import { useEffect, useRef, useState } from 'react'
import type { PriorityLevel, Project, Repeat, Todo, TodoComment, TodoPatch, TodoStatus } from '../../../../shared/types'
import { REPEATS, addDays, dueInfo, today } from '../../constants'
import { AttachmentList } from '../Attachments'
import { Icon } from '../Icon'
import { ProjectTag, confirmDialog, errText, toast } from '../ui'
import { PriorityBadge, PriorityPicker, StatusPicker } from './shared'

interface Props {
  todoId: number
  statuses: TodoStatus[]
  levels: PriorityLevel[]
  projects: Project[]
  version: number
  onClose: () => void
  onChanged: () => void
}

/** 待办详情侧栏：所有字段即改即存；子任务可逐级打开 */
export function TaskDrawer({ todoId, statuses, levels, projects, version, onClose, onChanged }: Props) {
  const [stack, setStack] = useState<number[]>([todoId])
  const id = stack[stack.length - 1]
  const [t, setT] = useState<Todo | null>(null)
  const [subtasks, setSubtasks] = useState<Todo[]>([])
  const [comments, setComments] = useState<TodoComment[]>([])

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [newSub, setNewSub] = useState('')
  const [comment, setComment] = useState('')
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setStack([todoId]), [todoId])

  // 数据刷新（含其他窗口中的修改）；正在编辑的输入框不被覆盖
  useEffect(() => {
    let alive = true
    Promise.all([window.api.getTodo(id), window.api.listSubtasks(id), window.api.listComments(id)]).then(([todo, subs, cs]) => {
      if (!alive) return
      if (!todo) {
        // 当前任务已被删除：退回上一级或关闭
        if (stack.length > 1) setStack((s) => s.slice(0, -1))
        else onClose()
        return
      }
      setT(todo)
      setSubtasks(subs)
      setComments(cs)
      const active = document.activeElement
      if (!(active instanceof HTMLElement && active.dataset.field === 'title')) setTitle(todo.title)
      if (!(active instanceof HTMLElement && active.dataset.field === 'notes')) setNotes(todo.notes)
      if (!(active instanceof HTMLElement && active.dataset.field === 'tags')) setTags(todo.tags.split(',').join(' '))
    })
    return () => {
      alive = false
    }
    // 仅在任务切换或数据版本变化时重新拉取
  }, [id, version])

  // 描述框自适应高度
  useEffect(() => {
    const el = notesRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(88, el.scrollHeight + 2)}px`
  }, [notes, t?.id])

  // Esc 关闭（存在弹窗时交给弹窗处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-mask')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!t) return null

  const patch = async (p: TodoPatch) => {
    try {
      await window.api.patchTodo(t.id, p)
      onChanged()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const commitTitle = () => {
    if (title.trim() && title.trim() !== t.title) patch({ title })
    else setTitle(t.title)
  }
  const commitNotes = () => notes !== t.notes && patch({ notes })
  const commitTags = () => tags !== t.tags.split(',').join(' ') && patch({ tags })

  const addSubtask = async () => {
    if (!newSub.trim()) return
    await window.api.saveTodo({
      parent_id: t.id,
      project_id: t.project_id,
      title: newSub,
      notes: '',
      priority: t.priority,
      due_date: ''
    })
    setNewSub('')
    onChanged()
  }

  const toggle = async (id: number) => {
    await window.api.toggleTodo(id)
    onChanged()
  }

  const remove = async () => {
    const extra = t.subtask_total ? `，其下 ${t.subtask_total} 个子任务也会一并删除` : ''
    if (!(await confirmDialog(`确定删除「${t.title}」吗${extra}？`, { title: '删除待办', okText: '删除' }))) return
    await window.api.deleteTodo(t.id)
    onChanged()
  }

  const sendComment = async () => {
    if (!comment.trim()) return
    await window.api.addComment(t.id, comment)
    setComment('')
    onChanged()
  }

  const removeComment = async (c: TodoComment) => {
    if (!(await confirmDialog('删除这条进展记录？', { title: '删除记录', okText: '删除' }))) return
    await window.api.deleteComment(c.id)
    onChanged()
  }

  const due = dueInfo(t)
  const timeline = [
    ...comments.map((c) => ({ key: `c${c.id}`, at: c.created_at, comment: c })),
    { key: 'created', at: t.created_at, text: '创建了任务' },
    ...(t.done && t.done_at ? [{ key: 'done', at: t.done_at, text: '完成了任务' }] : [])
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="drawer-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          {stack.length > 1 && (
            <button className="icon-btn" title="返回上级任务" onClick={() => setStack((s) => s.slice(0, -1))}>
              <Icon name="back" size={16} />
            </button>
          )}
          <div className="crumbs">
            <ProjectTag name={t.project_name} color={t.project_color} />
            {!t.project_name && <span className="muted">未分组</span>}
            {t.parent_id && (
              <>
                <span className="muted">/</span>
                <button className="crumb-link" onClick={() => setStack((s) => [...s.slice(0, -1), t.parent_id!])}>
                  {t.parent_title}
                </button>
              </>
            )}
          </div>
          {!t.done && (
            <button
              className={`pin-btn always ${t.pinned ? 'on' : ''}`}
              onClick={async () => {
                await window.api.pinTodo(t.id, !t.pinned)
                onChanged()
              }}
            >
              <Icon name="pin" size={13} />
              {t.pinned ? '已在桌面' : '到桌面'}
            </button>
          )}
          <button className="icon-btn danger" title="删除" onClick={remove}>
            <Icon name="trash" size={15} />
          </button>
          <button className="icon-btn" title="关闭 (Esc)" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <div className="drawer-title">
            <button className={`check ${t.done ? 'on' : ''}`} style={{ borderColor: t.done ? undefined : (t.priority_color ?? undefined) }} onClick={() => toggle(t.id)} title={t.done ? '标记为未完成' : '标记为完成'}>
              {t.done && <Icon name="tick" size={12} />}
            </button>
            <input
              data-field="title"
              className={t.done ? 'done' : ''}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>

          <div className="props">
            <span className="prop-label">状态</span>
            <div>
              <StatusPicker t={t} statuses={statuses} onChange={(status_id) => patch({ status_id })} />
            </div>

            <span className="prop-label">优先级</span>
            <PriorityPicker levels={levels} value={t.priority} onChange={(priority) => patch({ priority })} />

            <span className="prop-label">日期</span>
            <div className="date-range">
              <input type="date" value={t.start_date} title="开始日期" onChange={(e) => patch({ start_date: e.target.value })} />
              <span className="muted">→</span>
              <input type="date" value={t.due_date} title="截止日期" onChange={(e) => patch({ due_date: e.target.value })} />
              {due?.cls && <span className={`due ${due.cls}`}>{due.text}</span>}
            </div>

            <span className="prop-label">提醒</span>
            <div className="remind">
              <input
                type="datetime-local"
                value={t.remind_at}
                onChange={(e) => patch({ remind_at: e.target.value })}
              />
              {[
                { label: '今天 18:00', at: `${today()}T18:00` },
                { label: '明天 09:00', at: `${addDays(today(), 1)}T09:00` },
                ...(t.due_date ? [{ label: '截止日 09:00', at: `${t.due_date}T09:00` }] : [])
              ].map((p) => (
                <button key={p.label} type="button" className="chip" onClick={() => patch({ remind_at: p.at })}>
                  {p.label}
                </button>
              ))}
              {t.remind_at && (
                <button type="button" className="icon-btn sm" title="取消提醒" onClick={() => patch({ remind_at: '' })}>
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>

            <span className="prop-label">重复</span>
            <select value={t.repeat} onChange={(e) => patch({ repeat: e.target.value as Repeat })}>
              {REPEATS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                  {r.value && '（完成后自动生成下一次）'}
                </option>
              ))}
            </select>

            {!t.parent_id && (
              <>
                <span className="prop-label">项目</span>
                <select
                  value={t.project_id ?? ''}
                  onChange={(e) => patch({ project_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">未分组</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <span className="prop-label">标签</span>
            <input
              data-field="tags"
              value={tags}
              placeholder="空格或逗号分隔，如 bug 前端 需求"
              onChange={(e) => setTags(e.target.value)}
              onBlur={commitTags}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>

          <section className="d-section">
            <h4>描述</h4>
            <textarea
              ref={notesRef}
              data-field="notes"
              className="notes-input"
              value={notes}
              placeholder="补充背景、复现步骤、相关链接、分支名…"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={commitNotes}
            />
          </section>

          <section className="d-section">
            <h4>
              子任务
              {t.subtask_total > 0 && (
                <span className="sub-count">
                  {t.subtask_done}/{t.subtask_total}
                </span>
              )}
            </h4>
            {t.subtask_total > 0 && (
              <div className="progress">
                <i style={{ width: `${(t.subtask_done / t.subtask_total) * 100}%` }} />
              </div>
            )}
            <ul className="sub-list">
              {subtasks.map((s) => {
                const d = dueInfo(s)
                return (
                  <li key={s.id} className={s.done ? 'done' : ''}>
                    <button className={`check sm ${s.done ? 'on' : ''}`} onClick={() => toggle(s.id)}>
                      {s.done && <Icon name="tick" size={10} />}
                    </button>
                    <button className="sub-title" onClick={() => setStack((st) => [...st, s.id])} title="打开子任务">
                      {s.title}
                    </button>
                    {d && <span className={`due ${d.cls}`}>{d.text}</span>}
                    <PriorityBadge t={s} />
                  </li>
                )
              })}
            </ul>
            <div className="sub-add">
              <Icon name="plus" size={14} />
              <input
                value={newSub}
                placeholder="添加子任务，回车保存"
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addSubtask()}
              />
            </div>
          </section>

          <section className="d-section">
            <h4>附件</h4>
            <AttachmentList owner={{ todoId: t.id }} onChanged={onChanged} />
          </section>

          <section className="d-section">
            <h4>进展记录</h4>
            <ul className="timeline">
              {timeline.map((item) =>
                'comment' in item && item.comment ? (
                  <li key={item.key} className="tl-comment">
                    <div className="tl-meta">
                      <span>{item.at.slice(0, 16)}</span>
                      <button className="icon-btn xs danger" title="删除" onClick={() => removeComment(item.comment!)}>
                        <Icon name="trash" size={11} />
                      </button>
                    </div>
                    <div className="tl-text">{item.comment.content}</div>
                  </li>
                ) : (
                  <li key={item.key} className="tl-event">
                    <i />
                    {'text' in item ? item.text : ''} · {item.at.slice(0, 16)}
                  </li>
                )
              )}
            </ul>
            <div className="comment-box">
              <textarea
                rows={2}
                value={comment}
                placeholder="记录进展、结论或卡点…（Ctrl + Enter 发送）"
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    sendComment()
                  }
                }}
              />
              <button className="btn primary sm" disabled={!comment.trim()} onClick={sendComment}>
                <Icon name="send" size={13} /> 发送
              </button>
            </div>
          </section>

        </div>
      </aside>
    </div>
  )
}
