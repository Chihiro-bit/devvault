import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LockState } from '../../shared/types'
import App from './App'
import { Icon } from './components/Icon'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const

/** 应用入口：锁定时只渲染锁屏，主界面整体卸载，已显示的密码等内容不会残留在页面中 */
export default function Root() {
  const [lock, setLock] = useState<LockState | null>(null)

  useEffect(() => {
    window.api.lockState().then(setLock)
    return window.api.onLockChanged(setLock)
  }, [])

  // 向主进程上报操作，用于无操作自动锁定计时（节流 1 秒）
  useEffect(() => {
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      window.api.reportActivity()
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, ping, { capture: true, passive: true }))
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, ping, { capture: true }))
  }, [])

  // Ctrl + L 立即锁定
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && lock?.hasPassword && !lock.locked) {
        e.preventDefault()
        window.api.lockNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lock])

  if (!lock) return null
  return lock.locked ? <LockScreen /> : <App lock={lock} />
}

function LockScreen() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait <= 0) {
      inputRef.current?.focus()
      return
    }
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || busy || wait > 0) return
    setBusy(true)
    const r = await window.api.unlock(password)
    setBusy(false)
    if (r.ok) return
    setPassword('')
    setError(r.message ?? '密码错误')
    if (r.retryAfter) setWait(r.retryAfter)
    inputRef.current?.focus()
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-logo">
          <Icon name="lock" size={22} />
        </div>
        <h2>DevVault 已锁定</h2>
        <p>输入锁屏密码以继续</p>
        <div className={`lock-input ${error ? 'err' : ''}`}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            disabled={wait > 0}
            placeholder={wait > 0 ? `请 ${wait} 秒后再试` : '锁屏密码'}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
          />
          <button type="submit" className="btn primary" disabled={!password || busy || wait > 0}>
            解锁
          </button>
        </div>
        <div className="lock-error">{wait > 0 ? `尝试次数过多，请 ${wait} 秒后再试` : error}</div>
      </form>
    </div>
  )
}
