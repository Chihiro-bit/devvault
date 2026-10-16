import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

// ---------- Toast ----------

interface ToastItem {
  id: number
  text: string
  kind: 'ok' | 'err'
}

let pushToast: ((t: ToastItem) => void) | null = null
let toastSeq = 0

export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  pushToast?.({ id: ++toastSeq, text, kind })
}

export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // ipcRenderer.invoke 抛出的错误带有 "Error invoking remote method 'x': Error: " 前缀
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    pushToast = (t) => {
      setItems((s) => [...s.slice(-3), t])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 2400)
    }
    return () => {
      pushToast = null
    }
  }, [])
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'ok' ? 'tick' : 'x'} size={14} />
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------- Confirm ----------

interface ConfirmReq {
  title: string
  message: string
  okText: string
  danger: boolean
  resolve: (ok: boolean) => void
}

let pushConfirm: ((r: ConfirmReq) => void) | null = null

export function confirmDialog(
  message: string,
  opts: { title?: string; okText?: string; danger?: boolean } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(false)
    pushConfirm({
      title: opts.title ?? '确认操作',
      message,
      okText: opts.okText ?? '确定',
      danger: opts.danger ?? true,
      resolve
    })
  })
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null)
  useEffect(() => {
    pushConfirm = setReq
    return () => {
      pushConfirm = null
    }
  }, [])
  if (!req) return null
  const close = (ok: boolean) => {
    req.resolve(ok)
    setReq(null)
  }
  return (
    <Modal
      title={req.title}
      width={420}
      maskClosable
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            取消
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>
            {req.okText}
          </button>
        </>
      }
    >
      <p className="confirm-msg">{req.message}</p>
    </Modal>
  )
}

// ---------- Modal ----------

export function Modal({
  title,
  children,
  footer,
  onClose,
  width = 600,
  maskClosable = false
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
  maskClosable?: boolean
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const selfRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 仅关闭最上层的弹窗
      const masks = document.querySelectorAll('.modal-mask')
      if (masks[masks.length - 1] === selfRef.current) {
        e.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={selfRef}
      className="modal-mask"
      onMouseDown={(e) => {
        if (maskClosable && e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- 复制 ----------

export async function copyText(text: string, label: string, secret = false) {
  await window.api.copy(text, secret ? 30 : 0)
  toast(secret ? `已复制${label}，30 秒后自动清除` : `已复制${label}`)
}

export function CopyButton({ text, label, secret }: { text: string; label: string; secret?: boolean }) {
  return (
    <button className="icon-btn sm" title={`复制${label}`} onClick={() => copyText(text, label, secret)}>
      <Icon name="copy" size={14} />
    </button>
  )
}

export function ProjectTag({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null
  return (
    <span className="proj-tag">
      <i style={{ background: color ?? 'var(--muted)' }} />
      {name}
    </span>
  )
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  )
}
