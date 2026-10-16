import { useState } from 'react'
import type { PriorityRemoval, StatusKind, TodoStatus } from '../../../../shared/types'
import { LEVEL_COLORS, STATUS_KINDS } from '../../constants'
import { Icon } from '../Icon'
import { Modal, errText, toast } from '../ui'

interface Row {
  key: string
  id?: number
  name: string
  color: string
  kind: StatusKind
  todo_count: number
}

interface Removed extends PriorityRemoval {
  name: string
  count: number
}

const MAX_STATUSES = 10
let keySeq = 0

export function StatusModal({
  statuses,
  onClose,
  onSaved
}: {
  statuses: TodoStatus[]
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => statuses.map((s) => ({ ...s, key: `s${++keySeq}` })))
  const [removed, setRemoved] = useState<Removed[]>([])

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const add = () => {
    const used = new Set(rows.map((r) => r.color))
    const color = LEVEL_COLORS.find((c) => !used.has(c)) ?? LEVEL_COLORS[rows.length % LEVEL_COLORS.length]
    // 新状态默认插在第一个「已完成」状态之前
    const at = rows.findIndex((r) => r.kind === 'done')
    const row: Row = { key: `s${++keySeq}`, name: '', color, kind: 'active', todo_count: 0 }
    setRows((rs) => (at < 0 ? [...rs, row] : [...rs.slice(0, at), row, ...rs.slice(at)]))
  }

  const remove = (row: Row) => {
    setRows((rs) => rs.filter((r) => r.key !== row.key))
    if (!row.id) return
    const target = rows.find((r) => r.id && r.key !== row.key && r.kind === row.kind) ?? rows.find((r) => r.id && r.key !== row.key)
    setRemoved((rm) => [...rm, { id: row.id!, moveTo: target?.id ?? null, name: row.name, count: row.todo_count }])
  }

  const save = async () => {
    try {
      await window.api.saveStatuses(
        rows.map(({ id, name, color, kind }) => ({ id, name, color, kind })),
        removed.map(({ id, moveTo }) => ({ id, moveTo }))
      )
      toast('状态已更新')
      onSaved()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const savedRows = rows.filter((r) => r.id)
  const affected = removed.filter((r) => r.count > 0)

  return (
    <Modal
      title="自定义状态"
      width={600}
      onClose={onClose}
      footer={
        <>
          <span className="foot-hint">顺序即看板列的顺序；「已完成」类状态视为任务完成</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="status-head">
        <span>颜色</span>
        <span>名称</span>
        <span>分类</span>
        <span />
      </div>
      <div className="level-list">
        {rows.map((r, i) => (
          <div className="status-row" key={r.key}>
            <label className="color-dot" style={{ background: r.color }} title="选择颜色">
              <input type="color" value={r.color} onChange={(e) => patch(r.key, { color: e.target.value })} />
            </label>
            <input
              value={r.name}
              maxLength={10}
              placeholder="如 开发中、提测、待上线"
              onChange={(e) => patch(r.key, { name: e.target.value })}
            />
            <div className="segmented small">
              {STATUS_KINDS.map((k) => (
                <button key={k.value} className={r.kind === k.value ? 'on' : ''} onClick={() => patch(r.key, { kind: k.value })}>
                  {k.label}
                </button>
              ))}
            </div>
            <span className="level-ops">
              <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} title="上移">
                <Icon name="up" size={14} />
              </button>
              <button className="icon-btn sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} title="下移">
                <Icon name="down" size={14} />
              </button>
              <button className="icon-btn sm danger" disabled={rows.length <= 2} onClick={() => remove(r)} title="删除">
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {rows.length < MAX_STATUSES && (
        <button className="chip add level-add" onClick={add}>
          <Icon name="plus" size={12} /> 添加状态
        </button>
      )}

      {affected.length > 0 && (
        <div className="level-moves">
          {affected.map((r) => (
            <div className="level-move" key={r.id}>
              <span>已删除「{r.name}」，其下 {r.count} 条待办改为</span>
              <select
                value={r.moveTo ?? ''}
                onChange={(e) =>
                  setRemoved((rm) =>
                    rm.map((x) => (x.id === r.id ? { ...x, moveTo: e.target.value ? Number(e.target.value) : null } : x))
                  )
                }
              >
                {savedRows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
