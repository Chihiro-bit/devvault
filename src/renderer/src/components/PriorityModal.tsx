import { useState } from 'react'
import type { PriorityLevel, PriorityRemoval } from '../../../shared/types'
import { LEVEL_COLORS, MAX_LEVELS } from '../constants'
import { Icon } from './Icon'
import { Modal, errText, toast } from './ui'

interface Row {
  key: string
  id?: number
  label: string
  name: string
  color: string
  is_default: boolean
  todo_count: number
}

interface Removed extends PriorityRemoval {
  label: string
  count: number
}

let keySeq = 0
const toRow = (l: PriorityLevel): Row => ({ ...l, key: `k${++keySeq}` })

export function PriorityModal({
  levels,
  onClose,
  onSaved
}: {
  levels: PriorityLevel[]
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => levels.map(toRow))
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

  const setDefault = (key: string) => setRows((rs) => rs.map((r) => ({ ...r, is_default: r.key === key })))

  const add = () => {
    const used = new Set(rows.map((r) => r.color))
    const color = LEVEL_COLORS.find((c) => !used.has(c)) ?? LEVEL_COLORS[rows.length % LEVEL_COLORS.length]
    // 若沿用 Pn 命名，自动续上编号
    const nums = rows.map((r) => /^P(\d+)$/i.exec(r.label)?.[1]).filter(Boolean).map(Number)
    const label = nums.length === rows.length && nums.length ? `P${Math.max(...nums) + 1}` : ''
    setRows((rs) => [...rs, { key: `k${++keySeq}`, label, name: '', color, is_default: false, todo_count: 0 }])
  }

  const remove = (row: Row) => {
    const idx = rows.findIndex((r) => r.key === row.key)
    const rest = rows.filter((r) => r.key !== row.key)
    if (row.is_default && rest.length) {
      const i = Math.min(idx, rest.length - 1)
      rest[i] = { ...rest[i], is_default: true }
    }
    setRows(rest)
    if (row.id) {
      // 其下待办默认并入相邻的下一级（若删的是最后一级则并入上一级），避免被意外升级
      const below = rows.slice(idx + 1).find((r) => r.id)
      const above = rows.slice(0, idx).reverse().find((r) => r.id)
      const target = (below ?? above)?.id ?? null
      setRemoved((rm) => [...rm, { id: row.id!, moveTo: target, label: row.label, count: row.todo_count }])
    }
  }

  const save = async () => {
    try {
      await window.api.savePriorities(
        rows.map(({ id, label, name, color, is_default }) => ({ id, label, name, color, is_default })),
        removed.map(({ id, moveTo }) => ({ id, moveTo }))
      )
      toast('优先级已更新')
      onSaved()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const savedRows = rows.filter((r) => r.id)
  const affected = removed.filter((r) => r.count > 0)

  return (
    <Modal
      title="自定义优先级"
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="foot-hint">越靠上越优先，可用箭头调整顺序</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="level-head">
        <span>预览</span>
        <span>颜色</span>
        <span>标签</span>
        <span>说明</span>
        <span className="c">默认</span>
        <span />
      </div>
      <div className="level-list">
        {rows.map((r, i) => (
          <div className="level-row" key={r.key}>
            <span className="pbadge" style={{ ['--p' as string]: r.color }}>
              {r.label || '—'}
            </span>
            <label className="color-dot" style={{ background: r.color }} title="选择颜色">
              <input type="color" value={r.color} onChange={(e) => patch(r.key, { color: e.target.value })} />
            </label>
            <input
              className="level-label"
              value={r.label}
              maxLength={6}
              placeholder="如 P0"
              onChange={(e) => patch(r.key, { label: e.target.value })}
            />
            <input
              className="level-name"
              value={r.name}
              maxLength={12}
              placeholder="如 紧急、本周必须完成"
              onChange={(e) => patch(r.key, { name: e.target.value })}
            />
            <span className="c">
              <input
                type="radio"
                name="default-level"
                checked={r.is_default}
                onChange={() => setDefault(r.key)}
                title="新建待办时默认使用"
              />
            </span>
            <span className="level-ops">
              <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} title="上移">
                <Icon name="up" size={14} />
              </button>
              <button className="icon-btn sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} title="下移">
                <Icon name="down" size={14} />
              </button>
              <button
                className="icon-btn sm danger"
                disabled={rows.length <= 1}
                onClick={() => remove(r)}
                title={r.todo_count ? `删除（有 ${r.todo_count} 条进行中的待办）` : '删除'}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {rows.length < MAX_LEVELS && (
        <button className="chip add level-add" onClick={add}>
          <Icon name="plus" size={12} /> 添加等级
        </button>
      )}

      {affected.length > 0 && (
        <div className="level-moves">
          {affected.map((r) => (
            <div className="level-move" key={r.id}>
              <span>
                已删除「{r.label}」，其下 {r.count} 条进行中的待办改为
              </span>
              <select
                value={r.moveTo ?? ''}
                onChange={(e) =>
                  setRemoved((rm) =>
                    rm.map((x) => (x.id === r.id ? { ...x, moveTo: e.target.value ? Number(e.target.value) : null } : x))
                  )
                }
              >
                <option value="">默认等级</option>
                {savedRows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.name ? ` · ${s.name}` : ''}
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
