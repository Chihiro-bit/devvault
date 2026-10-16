import { useEffect, useRef, useState } from 'react'
import type { EntryInput, ExtraField, Project } from '../../../shared/types'
import { CATEGORIES, CAT_MAP, ENVS, addDays, generatePassword, today } from '../constants'
import { formatCode, useTotp } from '../totp'
import { AttachmentList, type PendingFile } from './Attachments'
import { Icon } from './Icon'
import { Modal, errText, toast } from './ui'

export function EntryModal({
  initial,
  projects,
  onClose,
  onSaved,
  onAttachmentsChanged
}: {
  initial: EntryInput
  projects: Project[]
  onClose: () => void
  onSaved: () => void
  onAttachmentsChanged: () => void
}) {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [f, setF] = useState<EntryInput>(initial)
  const [showPwd, setShowPwd] = useState(!initial.id)
  const cat = CAT_MAP[f.category]
  const showCode = cat.showCode || !!f.verify_code

  const set = <K extends keyof EntryInput>(k: K, v: EntryInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const setExtra = (i: number, patch: Partial<ExtraField>) =>
    setF((s) => ({ ...s, extra: s.extra.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const addExtra = (key = '', secret = false) =>
    setF((s) => ({ ...s, extra: [...s.extra, { key, value: '', secret }] }))
  const removeExtra = (i: number) => setF((s) => ({ ...s, extra: s.extra.filter((_, j) => j !== i) }))

  const save = async () => {
    const title = f.title.trim() || f.username.trim() || f.url.trim()
    if (!title) return toast('请至少填写名称、账号或地址', 'err')
    try {
      const id = await window.api.saveEntry({ ...f, title })
      if (pending.length) await window.api.addAttachments({ entryId: id }, pending.map((p) => p.path))
      toast(f.id ? '已更新' : '已添加')
      onSaved()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  // Ctrl+S / Ctrl+Enter 保存
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const unusedPresets = cat.presets.filter((p) => !f.extra.some((x) => x.key === p.key))

  return (
    <Modal
      title={f.id ? '编辑记录' : '新建记录'}
      width={680}
      onClose={onClose}
      footer={
        <>
          <span className="foot-hint">Ctrl + S 保存</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field full">
          <span>类型</span>
          <div className="segmented">
            {CATEGORIES.map((c) => (
              <button key={c.key} className={f.category === c.key ? 'on' : ''} onClick={() => set('category', c.key)}>
                <Icon name={c.icon} size={14} /> {c.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>名称</span>
          <input
            autoFocus
            value={f.title}
            placeholder={`例如：${cat.key === 'account' ? '管理员测试号' : cat.key === 'vpn' ? '公司 VPN' : cat.label + ' 账号'}`}
            onChange={(e) => set('title', e.target.value)}
          />
        </label>
        <label className="field">
          <span>所属项目</span>
          <select
            value={f.project_id ?? ''}
            onChange={(e) => set('project_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">未分组</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>环境</span>
          <div className="segmented small">
            <button className={!f.env ? 'on' : ''} onClick={() => set('env', '')}>
              无
            </button>
            {ENVS.map((env) => (
              <button key={env} className={f.env === env ? 'on' : ''} onClick={() => set('env', env)}>
                {env}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>标签</span>
          <input value={f.tags} placeholder="多个用逗号或空格分隔" onChange={(e) => set('tags', e.target.value)} />
        </label>

        <label className="field full">
          <span>{cat.urlLabel}</span>
          <input
            className="mono"
            value={f.url}
            placeholder={cat.urlPlaceholder}
            onChange={(e) => set('url', e.target.value)}
          />
        </label>

        <label className="field">
          <span>{cat.userLabel}</span>
          <input className="mono" value={f.username} onChange={(e) => set('username', e.target.value)} />
        </label>
        <div className="field">
          <span>{cat.pwdLabel}</span>
          <div className="input-group">
            <input
              className="mono"
              type={showPwd ? 'text' : 'password'}
              value={f.password}
              onChange={(e) => set('password', e.target.value)}
            />
            <button className="icon-btn" title={showPwd ? '隐藏' : '显示'} onClick={() => setShowPwd(!showPwd)}>
              <Icon name={showPwd ? 'eyeOff' : 'eye'} size={14} />
            </button>
            <button
              className="icon-btn"
              title="生成随机密码"
              onClick={() => {
                set('password', generatePassword())
                setShowPwd(true)
              }}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>

        {showCode && (
          <label className="field">
            <span>{cat.codeLabel}</span>
            <input
              className="mono code-input"
              value={f.verify_code}
              placeholder="如 123456、888888"
              onChange={(e) => set('verify_code', e.target.value)}
            />
          </label>
        )}

        <TotpInput value={f.totp} onChange={(v) => set('totp', v)} />

        <div className="field">
          <span>有效期</span>
          <div className="expiry-input">
            <input type="date" value={f.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
            {[
              { label: '30 天', days: 30 },
              { label: '90 天', days: 90 },
              { label: '1 年', days: 365 }
            ].map((p) => (
              <button key={p.days} type="button" className="chip" onClick={() => set('expires_at', addDays(today(), p.days))}>
                {p.label}
              </button>
            ))}
            {f.expires_at && (
              <button type="button" className="icon-btn sm" title="清除（长期有效）" onClick={() => set('expires_at', '')}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="field full">
          <span>附加字段</span>
          {f.extra.length > 0 && (
            <div className="extras">
              {f.extra.map((x, i) => (
                <div className="extra-row" key={i}>
                  <input
                    className="extra-key"
                    value={x.key}
                    placeholder="字段名"
                    onChange={(e) => setExtra(i, { key: e.target.value })}
                  />
                  <input
                    className="mono"
                    type={x.secret && !showPwd ? 'password' : 'text'}
                    value={x.value}
                    placeholder="值"
                    onChange={(e) => setExtra(i, { value: e.target.value })}
                  />
                  <button
                    className={`icon-btn ${x.secret ? 'on' : ''}`}
                    title={x.secret ? '敏感字段（加密存储、默认隐藏）' : '设为敏感字段'}
                    onClick={() => setExtra(i, { secret: !x.secret })}
                  >
                    <Icon name="lock" size={14} />
                  </button>
                  <button className="icon-btn danger" title="移除" onClick={() => removeExtra(i)}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="chips">
            <button className="chip add" onClick={() => addExtra()}>
              <Icon name="plus" size={12} /> 自定义字段
            </button>
            {unusedPresets.map((p) => (
              <button key={p.key} className="chip" onClick={() => addExtra(p.key, !!p.secret)}>
                + {p.key}
              </button>
            ))}
          </div>
        </div>

        <div className="field full">
          <span>附件</span>
          <AttachmentList
            owner={f.id ? { entryId: f.id } : null}
            pending={pending}
            onPendingChange={setPending}
            onChanged={onAttachmentsChanged}
          />
        </div>

        <label className="field full">
          <span>备注说明</span>
          <textarea
            rows={3}
            value={f.notes}
            placeholder="用途、权限说明、注意事项等"
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </Modal>
  )
}

/** TOTP 密钥输入：粘贴后实时显示当前动态码以便核对 */
function TotpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { code, remaining, valid } = useTotp(value)
  const [show, setShow] = useState(!value)
  return (
    <div className="field">
      <span>TOTP 动态码密钥</span>
      <div className="input-group">
        <input
          className="mono"
          type={show ? 'text' : 'password'}
          value={value}
          placeholder="粘贴 base32 密钥或 otpauth:// 链接"
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="icon-btn" title={show ? '隐藏' : '显示'} onClick={() => setShow(!show)}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={14} />
        </button>
      </div>
      {value.trim() && (
        <small className={`totp-preview ${valid ? '' : 'bad'}`}>
          {valid ? (
            <>
              当前动态码 <b className="mono">{formatCode(code)}</b> · {remaining} 秒后刷新，请与身份验证器核对
            </>
          ) : (
            '无法识别的密钥，请检查是否完整'
          )}
        </small>
      )}
    </div>
  )
}
