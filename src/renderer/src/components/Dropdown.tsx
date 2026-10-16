import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface DropdownOption<T> {
  value: T
  label: ReactNode
  color?: string
}

/** 轻量下拉菜单：点击外部或按 Esc 关闭 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  trigger,
  align = 'left'
}: {
  value: T
  options: DropdownOption<T>[]
  onChange: (v: T) => void
  trigger: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="dropdown" ref={ref} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={`dropdown-menu ${align}`}>
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`dropdown-item ${o.value === value ? 'on' : ''}`}
              onClick={() => {
                setOpen(false)
                if (o.value !== value) onChange(o.value)
              }}
            >
              {o.color && <i className="dot" style={{ background: o.color }} />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
