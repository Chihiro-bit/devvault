import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { createRoot } from 'react-dom/client'
import type { Entry, LockState } from '../../shared/types'
import { CAT_MAP, ENV_CLASS, isHttpUrl } from './constants'
import { Icon } from './components/Icon'
import { parseTotp, totpCode } from './totp'
import './styles.css'
import './quick.css'

type Action = 'password' | 'username' | 'code' | 'url'

const ACTION_LABEL: Record<Action, string> = { password: '密码', username: '账号', code: '验证码', url: '地址' }

/** 简单打分：标题前缀 > 标题包含 > 其他字段包含；多个关键词需全部命中 */
function score(e: Entry, words: string[]): number {
  if (!words.length) return e.favorite ? 2 : 1
  const title = e.title.toLowerCase()
  const rest = [e.username, e.url, e.tags, e.notes, e.project_name ?? '', e.env, CAT_MAP[e.category].label]
    .join(' ')
    .toLowerCase()
  let total = 0
  for (const w of words) {
    if (title.startsWith(w)) total += 30
    else if (title.includes(w)) total += 20
    else if (rest.includes(w)) total += 8
    else return 0
  }
  return total + (e.favorite ? 3 : 0)
}

function QuickSearch() {
  const [lock, setLock] = useState<LockState | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [flash, setFlash] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const load = async () => {
    const s = await window.api.lockState()
    setLock(s)
    if (!s.locked) setEntries(await window.api.listEntries({ scope: 'all' }))
  }

  useEffect(() => {
    load()
    const offShown = window.api.onQuickShown(() => {
      setFlash('')
      setSel(0)
      load()
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    })
    const offLock = window.api.onLockChanged((s) => {
      setLock(s)
      if (!s.locked) load()
      else setEntries([])
    })
    return () => {
      offShown()
      offLock()
    }
  }, [])

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return entries
      .map((e) => ({ e, s: score(e, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.e)
  }, [entries, q])

  useEffect(() => setSel(0), [q])

  // 窗口高度随内容变化（卡片在拿到锁定状态后才渲染，因此依赖 ready）
  const ready = lock !== null
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver(() => window.api.resizeQuick(el.offsetHeight + 24))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.qs-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = async (e: Entry, action: Action) => {
    let value = ''
    let secret = false
    if (action === 'password') {
      value = e.password || e.username
      secret = !!e.password
    } else if (action === 'username') value = e.username
    else if (action === 'url') value = e.url
    else {
      const cfg = parseTotp(e.totp)
      value = cfg ? await totpCode(cfg) : e.verify_code
    }
    if (!value) {
      setFlash(`「${e.title}」没有${ACTION_LABEL[action]}`)
      return
    }
    if (action === 'url' && isHttpUrl(value)) {
      await window.api.openUrl(value)
      window.api.hideQuick()
      return
    }
    await window.api.copy(value, secret ? 30 : 0)
    const what = action === 'password' && !e.password ? '账号' : ACTION_LABEL[action]
    setFlash(`已复制「${e.title}」的${what}${secret ? '，30 秒后自动清除' : ''}`)
    setTimeout(() => window.api.hideQuick(), 450)
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      if (q) setQ('')
      else window.api.hideQuick()
      return
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      const n = results.length
      if (n) setSel((s) => (s + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n)
      return
    }
    if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
      ev.preventDefault()
      const e = results[sel]
      if (!e) return
      run(e, ev.ctrlKey ? 'url' : ev.shiftKey ? 'username' : ev.altKey ? 'code' : 'password')
    }
  }

  if (!lock) return null

  return (
    <div className="qs-wrap">
      <div className="qs-card" ref={cardRef}>
        {lock.locked ? (
          <UnlockBox />
        ) : (
          <>
            <div className="qs-search">
              <Icon name="search" size={18} />
              <input
                ref={inputRef}
                autoFocus
                value={q}
                placeholder="搜索账号、VPN、Git、服务器…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
              />
              <kbd>Esc</kbd>
            </div>
            {results.length > 0 ? (
              <ul className="qs-list" ref={listRef}>
                {results.map((e, i) => {
                  const c = CAT_MAP[e.category]
                  return (
                    <li
                      key={e.id}
                      className={`qs-item ${i === sel ? 'on' : ''}`}
                      onMouseMove={() => i !== sel && setSel(i)}
                      onClick={() => run(e, 'password')}
                    >
                      <span className={`cat-icon sm c-${e.category}`}>
                        <Icon name={c.icon} size={14} />
                      </span>
                      <span className="qs-main">
                        <span className="qs-title">
                          {e.title}
                          {e.env && <span className={`env env-${ENV_CLASS[e.env] ?? 'dev'}`}>{e.env}</span>}
                        </span>
                        <span className="qs-sub">
                          {[e.username, e.project_name, c.label].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {i === sel && <span className="qs-hint">↵ 复制{e.password ? '密码' : '账号'}</span>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="qs-empty">{entries.length ? '没有匹配的记录' : '还没有账号记录'}</div>
            )}
            <div className="qs-foot">
              {flash ? (
                <span className="qs-flash">
                  <Icon name="tick" size={13} /> {flash}
                </span>
              ) : (
                <>
                  <span>
                    <kbd>↵</kbd> 密码
                  </span>
                  <span>
                    <kbd>Shift ↵</kbd> 账号
                  </span>
                  <span>
                    <kbd>Alt ↵</kbd> 验证码 / 动态码
                  </span>
                  <span>
                    <kbd>Ctrl ↵</kbd> 打开地址
                  </span>
                  <span className="spacer" />
                  <button className="qs-link" onClick={() => window.api.showMain('entries')}>
                    打开主窗口
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UnlockBox() {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => window.api.onQuickShown(() => setTimeout(() => ref.current?.focus(), 0)), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pw) return
    const r = await window.api.unlock(pw)
    setPw('')
    if (!r.ok) setErr(r.message ?? '密码错误')
  }

  return (
    <form className="qs-search qs-unlock" onSubmit={submit}>
      <Icon name="lock" size={18} />
      <input
        ref={ref}
        autoFocus
        type="password"
        value={pw}
        placeholder={err || 'DevVault 已锁定，输入锁屏密码解锁'}
        className={err ? 'err' : ''}
        onChange={(e) => {
          setPw(e.target.value)
          setErr('')
        }}
        onKeyDown={(e) => e.key === 'Escape' && window.api.hideQuick()}
      />
      <kbd>↵</kbd>
    </form>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QuickSearch />
  </StrictMode>
)
