import type { PriorityLevel, Todo, TodoStatus } from '../../../../shared/types'
import { levelOf } from '../../constants'
import { Dropdown } from '../Dropdown'
import { Icon } from '../Icon'

export function PriorityBadge({ t, title }: { t: Pick<Todo, 'priority_label' | 'priority_name' | 'priority_color'>; title?: boolean }) {
  const p = levelOf(t)
  return (
    <span className="pbadge" style={{ ['--p' as string]: p.color }} title={title === false ? undefined : p.name}>
      {p.label}
    </span>
  )
}

export function StatusLabel({ name, color }: { name: string | null; color: string | null }) {
  return (
    <span className="status-pill" style={{ ['--s' as string]: color ?? 'var(--muted)' }}>
      <i />
      {name ?? '未知状态'}
    </span>
  )
}

/** 可点击切换的状态标签 */
export function StatusPicker({
  t,
  statuses,
  onChange
}: {
  t: Pick<Todo, 'status_id' | 'status_name' | 'status_color'>
  statuses: TodoStatus[]
  onChange: (statusId: number) => void
}) {
  return (
    <Dropdown
      value={t.status_id}
      options={statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
      onChange={onChange}
      trigger={<StatusLabel name={t.status_name} color={t.status_color} />}
    />
  )
}

export function SubtaskProgress({ t }: { t: Pick<Todo, 'subtask_total' | 'subtask_done'> }) {
  if (!t.subtask_total) return null
  const all = t.subtask_done === t.subtask_total
  return (
    <span className={`sub-progress ${all ? 'all' : ''}`} title={`子任务 ${t.subtask_done}/${t.subtask_total}`}>
      <Icon name="subtask" size={12} />
      {t.subtask_done}/{t.subtask_total}
    </span>
  )
}

export function PriorityPicker({
  levels,
  value,
  onChange,
  withName
}: {
  levels: PriorityLevel[]
  value: number
  onChange: (id: number) => void
  withName?: boolean
}) {
  return (
    <div className="segmented small prio">
      {levels.map((l) => (
        <button
          key={l.id}
          type="button"
          className={value === l.id ? 'on' : ''}
          style={{ ['--p' as string]: l.color }}
          title={l.name ? `${l.label} · ${l.name}` : l.label}
          onClick={() => onChange(l.id)}
        >
          {withName && l.name ? `${l.label} · ${l.name}` : l.label}
        </button>
      ))}
    </div>
  )
}
