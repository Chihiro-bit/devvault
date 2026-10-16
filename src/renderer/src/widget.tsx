import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Todo } from '../../shared/types'
import { dueInfo, levelOf } from './constants'
import { Icon } from './components/Icon'
import './widget.css'

const id = Number(new URLSearchParams(location.search).get('id'))

function TaskStrip() {
  const [t, setT] = useState<Todo | null>(null)
  const [leaving, setLeaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    window.api.getTodo(id).then(setT)
  }, [])

  useEffect(() => {
    load()
    return window.api.onTodosChanged(load)
  }, [load])

  // 根据标题和附加信息的自然宽度调整窗口宽度
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const level = body.querySelector<HTMLElement>('.level')!
    const title = body.querySelector<HTMLElement>('.title')!
    const meta = body.querySelector<HTMLElement>('.meta')
    const need = Math.max(level.offsetWidth + 8 + title.scrollWidth, meta?.scrollWidth ?? 0)
    const desired = window.innerWidth - body.clientWidth + need + 2
    if (Math.abs(desired - window.innerWidth) > 2) window.api.resizeWidget(desired)
  }, [t])

  if (!t) return null

  const p = levelOf(t)
  const due = dueInfo(t)

  const complete = async () => {
    setLeaving(true)
    // 先播放完成动画，再更新数据（主进程会随后关闭本窗口）
    await new Promise((r) => setTimeout(r, 520))
    await window.api.toggleTodo(id)
  }

  return (
    <div className={`strip ${leaving ? 'leaving' : ''}`} style={{ ['--accent' as string]: p.color }}>
      <button className="ring" onClick={complete} title="完成">
        <Icon name="tick" size={11} />
      </button>

      <div className="body" ref={bodyRef}>
        <div className="line">
          <span className="level">{p.label}</span>
          <span className="title">{t.title}</span>
        </div>
        {(due || t.project_name) && (
          <div className="meta">
            {due && <span className={`due ${due.cls}`}>{due.text}</span>}
            {due && t.project_name && <span className="sep">·</span>}
            {t.project_name && (
              <span className="proj">
                <i style={{ background: t.project_color ?? undefined }} />
                {t.project_name}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="tools">
        <button
          className={t.pin_top ? 'on' : ''}
          title={t.pin_top ? '取消置顶' : '始终置顶'}
          onClick={() => window.api.setPinTop(id, !t.pin_top)}
        >
          <Icon name="top" size={13} />
        </button>
        <button title="在主窗口中查看" onClick={() => window.api.showMain('todos')}>
          <Icon name="external" size={13} />
        </button>
        <button title="从桌面移除" onClick={() => window.api.pinTodo(id, false)}>
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TaskStrip />
  </StrictMode>
)
