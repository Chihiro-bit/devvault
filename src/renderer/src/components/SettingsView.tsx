import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { AppInfo, AppPrefs, CloudState, LockState, ServerInfo, SyncStatus } from '../../../shared/types'
import { OFFICIAL_SERVER_URL } from '../constants'
import { Icon } from './Icon'
import { confirmDialog, errText, toast } from './ui'

const IDLE_PRESETS = [
  { s: 30, label: '30 秒' },
  { s: 60, label: '1 分钟' },
  { s: 300, label: '5 分钟' },
  { s: 600, label: '10 分钟' },
  { s: 1800, label: '30 分钟' }
]

/** 云端功能，登录后才可使用 */
const CLOUD_FEATURES = [
  { title: '多设备同步', desc: '账号密码、待办在多台电脑间自动同步（附件暂不同步）', ready: true },
  { title: '团队共享', desc: '与同事共享项目的测试账号和环境信息', ready: false },
  { title: '云端备份', desc: '定期加密备份到服务器，随时恢复', ready: false }
]

interface Props {
  info: AppInfo | null
  lock: LockState
  cloud: CloudState | null
  prefs: AppPrefs | null
  onExport: () => void
  onImport: () => void
}

export function SettingsView({ info, lock, cloud, prefs, onExport, onImport }: Props) {
  return (
    <section className="view">
      <div className="scroll settings">
        <CloudSection cloud={cloud} />
        <SecuritySection lock={lock} />
        {prefs && <QuickSection prefs={prefs} />}
        {prefs && <NotifySection prefs={prefs} />}

        <Section icon="download" title="数据" desc="所有数据保存在本机 SQLite 数据库中">
          <Row label="数据库位置" hint={info?.dbPath}>
            <span className={`status-pill ${info?.encrypted ? 'ok' : 'warn'}`}>
              <Icon name="lock" size={12} />
              {info?.encrypted ? '密码已使用系统加密' : '系统加密不可用'}
            </span>
          </Row>
          <Row label="备份与恢复" hint="导出文件中的密码为明文，请妥善保管；导入为追加合并">
            <div className="row-actions">
              <button className="btn" onClick={onExport}>
                <Icon name="download" size={14} /> 导出
              </button>
              <button className="btn" onClick={onImport}>
                <Icon name="upload" size={14} /> 导入
              </button>
            </div>
          </Row>
        </Section>

        <div className="about">DevVault {info?.version}</div>
      </div>
    </section>
  )
}

function Section({ icon, title, desc, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-card">
      <div className="set-head">
        <span className="set-icon">
          <Icon name={icon} size={16} />
        </span>
        <div>
          <h3>{title}</h3>
          {desc && <p>{desc}</p>}
        </div>
      </div>
      <div className="set-body">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <small title={typeof hint === 'string' ? hint : undefined}>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}

// ---------- 账号与云端 ----------

function syncText(s: SyncStatus): string {
  if (s.syncing) return '正在同步…'
  if (s.error) return `同步失败：${s.error}`
  const pending = s.pending ? ` · ${s.pending} 项修改待上传` : ''
  if (!s.lastSyncAt) return `尚未同步${pending}`
  const t = new Date(s.lastSyncAt)
  const min = Math.floor((Date.now() - t.getTime()) / 60_000)
  const when = min < 1 ? '刚刚' : min < 60 ? `${min} 分钟前` : t.toLocaleString('zh-CN', { hour12: false }).slice(0, -3)
  return `上次同步：${when}${pending}`
}

type CloudMode = 'login' | 'register'

function CloudSection({ cloud }: { cloud: CloudState | null }) {
  const [mode, setMode] = useState<CloudMode>('login')
  const [server, setServer] = useState('')
  const [info, setInfo] = useState<{ url: string; info: ServerInfo } | null>(null)
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cloud?.serverUrl) setServer((s) => s || cloud.serverUrl)
  }, [cloud?.serverUrl])

  const checkServer = async () => {
    setBusy(true)
    try {
      const i = await window.api.serverInfo(server)
      setInfo({ url: server, info: i })
      toast(`已连接「${i.name}」${i.allowRegistration ? '' : '，该服务器未开放注册'}`)
    } catch (err) {
      setInfo(null)
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'register') {
      if (password.length < 8) return toast('主密码至少 8 位', 'err')
      if (password !== confirm) return toast('两次输入的主密码不一致', 'err')
    }
    setBusy(true)
    try {
      const s =
        mode === 'login'
          ? await window.api.login(server, username, password)
          : await window.api.register({ serverUrl: server, username, password, name })
      setPassword('')
      setConfirm('')
      toast(mode === 'login' ? `登录成功，欢迎 ${s.user?.name}` : '注册成功，本机数据将开始同步')
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    const ok = await confirmDialog('退出后停止同步，本机数据不受影响；重新登录同一账号会继续同步。', {
      title: '退出登录',
      okText: '退出',
      danger: false
    })
    if (!ok) return
    await window.api.logout()
    toast('已退出登录')
  }

  const loggedIn = !!cloud?.loggedIn
  const serverInfo = info?.url === server ? info.info : null
  const canSubmit = !busy && !!server.trim() && !!username.trim() && !!password && (mode === 'login' || !!confirm)

  return (
    <Section
      icon="cloud"
      title="账号与云同步"
      desc={
        loggedIn
          ? '账号密码与待办在本机加密后同步，服务器只保存密文'
          : '当前为本地模式：所有功能均可离线使用。登录后可在多台电脑间同步，服务器可使用统一提供的，也可自行部署'
      }
    >
      {loggedIn && cloud?.user ? (
        <>
          <div className="account">
            <span className="avatar lg">{cloud.user.name.slice(0, 1).toUpperCase()}</span>
            <div className="account-info">
              <div className="account-name">{cloud.user.name}</div>
              <small>
                {cloud.user.username}
                {cloud.user.email ? ` · ${cloud.user.email}` : ''} · {cloud.serverUrl}
              </small>
            </div>
            <button className="btn" onClick={logout}>
              <Icon name="logout" size={14} /> 退出登录
            </button>
          </div>
          <SyncRow cloud={cloud} />
          <MasterPasswordRow />
        </>
      ) : (
        <form className="login-form" onSubmit={submit}>
          <div className="segmented small full">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
              登录
            </button>
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
              注册
            </button>
          </div>
          <label className="field full">
            <span>服务器地址</span>
            <div className="input-with-btn">
              <input
                className="mono"
                value={server}
                placeholder={OFFICIAL_SERVER_URL || 'https://devvault.your-company.com'}
                onChange={(e) => setServer(e.target.value)}
              />
              {OFFICIAL_SERVER_URL && server !== OFFICIAL_SERVER_URL && (
                <button type="button" className="btn ghost" onClick={() => setServer(OFFICIAL_SERVER_URL)}>
                  使用官方服务器
                </button>
              )}
              <button type="button" className="btn" disabled={busy || !server.trim()} onClick={checkServer}>
                测试连接
              </button>
            </div>
            {serverInfo && (
              <small className="field-hint">
                {serverInfo.name} · v{serverInfo.version} · {serverInfo.allowRegistration ? '开放注册' : '未开放注册'}
              </small>
            )}
          </label>
          <label className="field">
            <span>账号</span>
            <input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          </label>
          {mode === 'register' ? (
            <label className="field">
              <span>显示名称（可选）</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>主密码</span>
              <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {mode === 'register' && (
            <>
              <label className="field">
                <span>主密码（至少 8 位）</span>
                <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label className="field">
                <span>确认主密码</span>
                <input type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
              </label>
            </>
          )}
          <div className="login-foot">
            {mode === 'register' ? (
              <small className="pwd-tip">主密码用于加密你的数据，服务器无法查看也无法找回；忘记后云端数据将无法解密</small>
            ) : (
              <small>主密码不会发送到服务器；未登录不影响本地功能</small>
            )}
            <button className="btn primary" disabled={!canSubmit}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并同步'}
            </button>
          </div>
        </form>
      )}

      <div className="features">
        {CLOUD_FEATURES.map((f) => (
          <div className={`feature ${loggedIn ? '' : 'locked'}`} key={f.title}>
            <div className="feature-title">
              {f.title}
              <span className="tag">{!loggedIn ? '登录后可用' : f.ready ? '已启用' : '开发中'}</span>
            </div>
            <small>{f.desc}</small>
          </div>
        ))}
      </div>
    </Section>
  )
}

function SyncRow({ cloud }: { cloud: CloudState }) {
  const s = cloud.sync
  const syncNow = async () => {
    try {
      const r = await window.api.syncNow()
      if (r.sync.error) toast(r.sync.error, 'err')
      else toast('同步完成')
    } catch (err) {
      toast(errText(err), 'err')
    }
  }
  return (
    <Row label="云同步" hint={<span className={s.error ? 'text-danger' : undefined}>{syncText(s)}</span>}>
      <div className="row-actions">
        <span className="status-pill ok">
          <Icon name="shield" size={12} /> 端到端加密
        </span>
        <button className="btn" disabled={s.syncing} onClick={syncNow}>
          <Icon name="refresh" size={14} /> {s.syncing ? '同步中…' : '立即同步'}
        </button>
      </div>
    </Row>
  )
}

function MasterPasswordRow() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (v: boolean) => {
    setOpen(v)
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return toast('主密码至少 8 位', 'err')
    if (next !== confirm) return toast('两次输入的主密码不一致', 'err')
    setBusy(true)
    try {
      await window.api.changeCloudPassword(current, next)
      toast('主密码已修改，其他设备需重新登录')
      toggle(false)
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Row label="主密码" hint="修改后其他设备需要用新密码重新登录，已同步的数据无需重新上传">
        <button className="btn" onClick={() => toggle(!open)}>
          <Icon name="key" size={14} /> 修改
        </button>
      </Row>
      {open && (
        <form className="pwd-form" onSubmit={submit}>
          <input autoFocus type="password" placeholder="当前主密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input type="password" placeholder="新主密码（至少 8 位）" value={next} onChange={(e) => setNext(e.target.value)} />
          <input type="password" placeholder="再次输入新主密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button className="btn primary" disabled={busy || !current || !next}>
            {busy ? '请稍候…' : '保存'}
          </button>
          <button type="button" className="btn ghost" onClick={() => toggle(false)}>
            取消
          </button>
          <small className="pwd-tip">主密码无法找回，请牢记</small>
        </form>
      )}
    </>
  )
}

// ---------- 安全 ----------

type PwdMode = null | 'set' | 'change' | 'remove'

function SecuritySection({ lock }: { lock: LockState }) {
  const [mode, setMode] = useState<PwdMode>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [custom, setCustom] = useState(String(lock.idleSeconds))

  useEffect(() => setCustom(String(lock.idleSeconds)), [lock.idleSeconds])

  const openForm = (m: PwdMode) => {
    setMode(m)
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  const configure = async (opts: Partial<{ enabled: boolean; idleSeconds: number }>) => {
    try {
      await window.api.configureLock({ enabled: lock.enabled, idleSeconds: lock.idleSeconds, ...opts })
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const commitCustom = () => {
    const n = Number(custom)
    if (!Number.isFinite(n) || n < 10) {
      toast('无操作时长至少 10 秒', 'err')
      setCustom(String(lock.idleSeconds))
      return
    }
    if (n !== lock.idleSeconds) configure({ idleSeconds: n })
  }

  const submitPwd = async (e: FormEvent) => {
    e.preventDefault()
    if (mode !== 'remove') {
      if (next.length < 4) return toast('锁屏密码至少 4 位', 'err')
      if (next !== confirm) return toast('两次输入的密码不一致', 'err')
    }
    try {
      await window.api.setLockPassword(lock.hasPassword ? current : null, mode === 'remove' ? null : next)
      toast(mode === 'set' ? '锁屏密码已设置，可开启自动锁定' : mode === 'remove' ? '已移除锁屏密码' : '锁屏密码已修改')
      openForm(null)
    } catch (err) {
      toast(errText(err), 'err')
    }
  }

  return (
    <Section icon="lock" title="安全" desc="一段时间不操作后自动锁定，需输入锁屏密码才能继续使用">
      <Row label="锁屏密码" hint={lock.hasPassword ? '已设置' : '开启自动锁定前需先设置'}>
        <div className="row-actions">
          {lock.hasPassword ? (
            <>
              <button className="btn" onClick={() => openForm('change')}>
                修改密码
              </button>
              <button className="btn ghost" onClick={() => openForm('remove')}>
                移除
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => openForm('set')}>
              设置密码
            </button>
          )}
        </div>
      </Row>

      {mode && (
        <form className="pwd-form" onSubmit={submitPwd}>
          {lock.hasPassword && (
            <input autoFocus type="password" placeholder="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          {mode !== 'remove' && (
            <>
              <input
                autoFocus={!lock.hasPassword}
                type="password"
                placeholder="新密码（至少 4 位）"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <input type="password" placeholder="再次输入新密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </>
          )}
          <button className={`btn ${mode === 'remove' ? 'danger' : 'primary'}`}>{mode === 'remove' ? '确认移除' : '保存'}</button>
          <button type="button" className="btn ghost" onClick={() => openForm(null)}>
            取消
          </button>
          {mode !== 'remove' && <small className="pwd-tip">锁屏密码无法找回，请牢记</small>}
        </form>
      )}

      <Row label="自动锁定" hint={lock.hasPassword ? '启动应用时同样需要解锁' : '请先设置锁屏密码'}>
        <Switch on={lock.enabled} disabled={!lock.hasPassword} onChange={(enabled) => configure({ enabled })} />
      </Row>

      <Row label="无操作时长" hint="在本应用中无鼠标、键盘操作超过该时长即锁定">
        <div className={`idle-picker ${lock.enabled ? '' : 'disabled'}`}>
          <div className="segmented small">
            {IDLE_PRESETS.map((p) => (
              <button key={p.s} className={lock.idleSeconds === p.s ? 'on' : ''} onClick={() => configure({ idleSeconds: p.s })}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="idle-custom">
            <input
              type="number"
              min={10}
              max={86400}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => e.key === 'Enter' && commitCustom()}
            />
            秒
          </label>
        </div>
      </Row>

      <Row label="立即锁定" hint="快捷键 Ctrl + L">
        <button className="btn" disabled={!lock.hasPassword} onClick={() => window.api.lockNow()}>
          <Icon name="lock" size={14} /> 锁定
        </button>
      </Row>
    </Section>
  )
}

// ---------- 快速搜索与后台运行 ----------

async function savePrefs(patch: Partial<AppPrefs>): Promise<AppPrefs | null> {
  try {
    return await window.api.setPrefs(patch)
  } catch (e) {
    toast(errText(e), 'err')
    return null
  }
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  '`': '`',
  '-': '-',
  '=': '=',
  ',': ',',
  '.': '.',
  '/': '/',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '\\': '\\'
}

/** 把按键事件转换为 Electron Accelerator，如 Ctrl+Alt+Space；仅修饰键或无修饰键（F 键除外）时返回 null */
function toAccelerator(e: KeyboardEvent): string | null {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  let key = KEY_NAMES[e.key] ?? ''
  if (!key) {
    if (/^F\d{1,2}$/.test(e.key)) key = e.key
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  }
  if (!key) return null
  if (!mods.length && !/^F\d/.test(key)) return null
  return [...mods, key].join('+')
}

function HotkeyInput({ value, ok, enabled, onChange }: { value: string; ok: boolean; enabled: boolean; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  return (
    <div className="hotkey">
      <button
        type="button"
        className={`hotkey-box ${recording ? 'rec' : ''}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          if (e.key === 'Escape') return setRecording(false)
          const acc = toAccelerator(e)
          if (acc) {
            setRecording(false)
            onChange(acc)
          }
        }}
      >
        {recording ? '请按下新的快捷键…' : value.split('+').map((k) => <kbd key={k}>{k}</kbd>)}
      </button>
      {enabled && !recording && (
        <span className={`hotkey-state ${ok ? 'ok' : 'bad'}`}>{ok ? '已生效' : '被其他程序占用，请换一个'}</span>
      )}
    </div>
  )
}

function QuickSection({ prefs }: { prefs: AppPrefs }) {
  return (
    <Section icon="search" title="快速搜索与后台运行" desc="在任何程序中按快捷键唤出搜索框，回车即可复制密码">
      <Row label="全局快速搜索" hint="↵ 复制密码 · Shift ↵ 账号 · Alt ↵ 验证码/动态码 · Ctrl ↵ 打开地址">
        <Switch on={prefs.quickEnabled} onChange={(quickEnabled) => savePrefs({ quickEnabled })} />
      </Row>
      <Row label="快捷键" hint="点击后按下新的组合键">
        <HotkeyInput
          value={prefs.quickHotkey}
          ok={prefs.quickHotkeyOk}
          enabled={prefs.quickEnabled}
          onChange={async (quickHotkey) => {
            const r = await savePrefs({ quickHotkey })
            if (r && r.quickEnabled && !r.quickHotkeyOk) toast(`「${quickHotkey}」已被其他程序占用`, 'err')
          }}
        />
      </Row>
      <Row label="关闭窗口时最小化到托盘" hint="关闭后仍可接收提醒、使用快速搜索；关闭此项则关闭窗口即退出（桌面任务条一并关闭）">
        <Switch on={prefs.closeToTray} onChange={(closeToTray) => savePrefs({ closeToTray })} />
      </Row>
      <Row label="开机自动启动" hint={prefs.canAutoLaunch ? '登录 Windows 后自动在后台运行' : '仅安装版可用（开发模式下不可设置）'}>
        <Switch on={prefs.openAtLogin} disabled={!prefs.canAutoLaunch} onChange={(openAtLogin) => savePrefs({ openAtLogin })} />
      </Row>
    </Section>
  )
}

function NotifySection({ prefs }: { prefs: AppPrefs }) {
  const [days, setDays] = useState(String(prefs.expiryDays))
  useEffect(() => setDays(String(prefs.expiryDays)), [prefs.expiryDays])

  const commitDays = () => {
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      toast('提前天数需在 1~90 之间', 'err')
      setDays(String(prefs.expiryDays))
    } else if (n !== prefs.expiryDays) savePrefs({ expiryDays: n })
  }

  return (
    <Section icon="calendar" title="提醒" desc="通过 Windows 通知提醒待办和即将过期的账号">
      <Row label="系统通知" hint="待办的单独提醒时间在任务详情中设置">
        <div className="row-actions">
          <button
            className="btn ghost sm"
            onClick={() => window.api.testNotify().catch((e) => toast(errText(e), 'err'))}
          >
            发送测试通知
          </button>
          <Switch on={prefs.notifyEnabled} onChange={(notifyEnabled) => savePrefs({ notifyEnabled })} />
        </div>
      </Row>
      <Row label="每日摘要" hint="每天该时间汇总今天到期、已逾期的待办和即将过期的账号（错过时间会在启动后补发）">
        <input
          className="time-input"
          type="time"
          value={prefs.digestTime}
          disabled={!prefs.notifyEnabled}
          onChange={(e) => e.target.value && savePrefs({ digestTime: e.target.value })}
        />
      </Row>
      <Row label="账号过期提醒" hint="在账号的有效期到期前多少天开始提醒">
        <label className={`idle-custom ${prefs.notifyEnabled ? '' : 'disabled'}`}>
          提前
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={commitDays}
            onKeyDown={(e) => e.key === 'Enter' && commitDays()}
          />
          天
        </label>
      </Row>
    </Section>
  )
}
