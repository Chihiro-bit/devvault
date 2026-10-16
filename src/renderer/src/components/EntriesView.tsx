import { useEffect, useMemo, useState } from 'react'
import type { Category, Entry, EntryInput, Project, Scope } from '../../../shared/types'
import { CATEGORIES, CAT_MAP, ENV_CLASS, daysUntil, emptyEntry, expiryInfo, formatSize, isHttpUrl } from '../constants'
import { formatCode, useTotp } from '../totp'
import { EntryModal } from './EntryModal'
import { Icon } from './Icon'
import { CopyButton, Empty, ProjectTag, confirmDialog, copyText, errText, toast } from './ui'

interface Props {
  scope: Scope
  keyword: string
  projects: Project[]
  version: number
  /** 账号提前多少天视为「即将过期」 */
  expiryDays: number
  /** 从通知跳转时要求打开的筛选，n 递增表示新的跳转 */
  nav?: { filter: 'expiring'; n: number }
  onChanged: () => void
}

export function EntriesView({ scope, keyword, projects, version, expiryDays, nav, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [expiringOnly, setExpiringOnly] = useState(false)

  useEffect(() => {
    if (nav?.filter === 'expiring') {
      setExpiringOnly(true)
      setCat('all')
    }
  }, [nav?.n])
  const [editing, setEditing] = useState<EntryInput | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .listEntries({ scope, keyword })
      .then((r) => alive && setEntries(r))
      .catch((e) => toast(errText(e), 'err'))
    return () => {
      alive = false
    }
  }, [scope, keyword, version])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: entries.length }
    for (const e of entries) m[e.category] = (m[e.category] ?? 0) + 1
    return m
  }, [entries])

  const isExpiring = (e: Entry) => !!e.expires_at && daysUntil(e.expires_at) <= expiryDays
  const expiringCount = entries.filter(isExpiring).length
  const shown = entries.filter(
    (e) => (cat === 'all' || e.category === cat) && (!favOnly || e.favorite) && (!expiringOnly || isExpiring(e))
  )
  const favCount = entries.filter((e) => e.favorite).length

  const openNew = () => setEditing(emptyEntry(scope, cat === 'all' ? 'account' : cat))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !document.querySelector('.modal-mask')) {
        e.preventDefault()
        openNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const remove = async (e: Entry) => {
    if (!(await confirmDialog(`确定删除「${e.title}」吗？此操作不可撤销。`, { title: '删除记录', okText: '删除' }))) return
    await window.api.deleteEntry(e.id)
    toast('已删除')
    onChanged()
  }

  const toggleFav = async (e: Entry) => {
    await window.api.toggleFavorite(e.id)
    onChanged()
  }

  const duplicate = (e: Entry) => {
    const { id: _id, project_name: _n, project_color: _c, created_at: _a, updated_at: _u, attachments: _f, ...rest } = e
    setEditing({ ...rest, title: `${e.title} 副本`, favorite: false })
  }

  return (
    <section className="view">
      <div className="toolbar">
        <div className="filters">
          <button className={`filter ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
            全部 <em>{counts.all}</em>
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.key} className={`filter ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
              <Icon name={c.icon} size={13} /> {c.label}
              {counts[c.key] ? <em>{counts[c.key]}</em> : null}
            </button>
          ))}
          <span className="sep" />
          <button className={`filter fav ${favOnly ? 'on' : ''}`} onClick={() => setFavOnly(!favOnly)}>
            <Icon name="star" size={13} /> 收藏 {favCount ? <em>{favCount}</em> : null}
          </button>
          {(expiringCount > 0 || expiringOnly) && (
            <button className={`filter expiring ${expiringOnly ? 'on' : ''}`} onClick={() => setExpiringOnly(!expiringOnly)}>
              <Icon name="calendar" size={13} /> 即将过期 <em>{expiringCount}</em>
            </button>
          )}
        </div>
        <button className="btn primary" onClick={openNew} title="Ctrl + N">
          <Icon name="plus" size={14} /> 新建记录
        </button>
      </div>

      <div className="scroll">
        {shown.length === 0 ? (
          <Empty
            icon={<Icon name="key" size={28} />}
            title={keyword ? `没有找到与「${keyword}」相关的记录` : '这里还没有记录'}
            hint={
              keyword ? (
                '换个关键词试试，支持空格分隔多个关键词'
              ) : (
                <button className="btn primary" onClick={openNew}>
                  <Icon name="plus" size={14} /> 添加测试账号 / Git / VPN 等
                </button>
              )
            }
          />
        ) : (
          <div className="grid">
            {shown.map((e) => (
              <EntryCard
                key={e.id}
                e={e}
                showProject={typeof scope !== 'number'}
                expiryDays={expiryDays}
                onEdit={() => setEditing(e)}
                onDelete={() => remove(e)}
                onDuplicate={() => duplicate(e)}
                onFavorite={() => toggleFav(e)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EntryModal
          initial={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
          onAttachmentsChanged={onChanged}
        />
      )}
    </section>
  )
}

const runSafe = (fn: () => Promise<unknown>) => fn().catch((err) => toast(errText(err), 'err'))

function entryToText(e: Entry): string {
  const c = CAT_MAP[e.category]
  const lines = [`【${e.title}】${e.env ? ` (${e.env})` : ''}`]
  if (e.url) lines.push(`${c.urlLabel}：${e.url}`)
  if (e.username) lines.push(`${c.userLabel}：${e.username}`)
  if (e.password) lines.push(`${c.pwdLabel}：${e.password}`)
  if (e.verify_code) lines.push(`${c.codeLabel}：${e.verify_code}`)
  for (const x of e.extra) lines.push(`${x.key}：${x.value}`)
  if (e.notes) lines.push(`备注：${e.notes}`)
  return lines.join('\n')
}

function EntryCard({
  e,
  showProject,
  expiryDays,
  onEdit,
  onDelete,
  onDuplicate,
  onFavorite
}: {
  e: Entry
  showProject: boolean
  expiryDays: number
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onFavorite: () => void
}) {
  const c = CAT_MAP[e.category]
  const tags = e.tags ? e.tags.split(',') : []

  return (
    <div className="card" onDoubleClick={onEdit}>
      <div className="card-head">
        <span className={`cat-icon c-${e.category}`}>
          <Icon name={c.icon} size={16} />
        </span>
        <div className="card-title">
          <div className="title-line">
            <span className="title" title={e.title}>
              {e.title}
            </span>
            {e.env && <span className={`env env-${ENV_CLASS[e.env] ?? 'dev'}`}>{e.env}</span>}
          </div>
          <div className="sub-line">
            <span>{c.label}</span>
            {showProject && <ProjectTag name={e.project_name} color={e.project_color} />}
            <ExpiryBadge expires={e.expires_at} warnDays={expiryDays} />
          </div>
        </div>
        <div className="card-actions">
          <button className="icon-btn sm" title="复制全部信息" onClick={() => copyText(entryToText(e), '全部信息', !!e.password)}>
            <Icon name="copy" size={14} />
          </button>
          <button className="icon-btn sm" title="复制为新记录" onClick={onDuplicate}>
            <Icon name="clone" size={14} />
          </button>
          <button className="icon-btn sm" title="编辑" onClick={onEdit}>
            <Icon name="edit" size={14} />
          </button>
          <button className="icon-btn sm danger" title="删除" onClick={onDelete}>
            <Icon name="trash" size={14} />
          </button>
        </div>
        <button className={`star ${e.favorite ? 'on' : ''}`} title={e.favorite ? '取消收藏' : '收藏'} onClick={onFavorite}>
          <Icon name="star" size={15} />
        </button>
      </div>

      <div className="kv">
        {e.url && <Field label={c.urlLabel} value={e.url} link={isHttpUrl(e.url)} />}
        {e.username && <Field label={c.userLabel} value={e.username} />}
        {e.password && <Field label={c.pwdLabel} value={e.password} secret />}
        {e.verify_code && <Field label={c.codeLabel} value={e.verify_code} highlight />}
        {e.totp && <TotpField secret={e.totp} />}
        {e.extra.map((x, i) => (
          <Field key={i} label={x.key || '字段'} value={x.value} secret={x.secret} />
        ))}
      </div>

      {e.attachments.length > 0 && (
        <div className="card-files">
          {e.attachments.map((a) => (
            <span className="file-chip" key={a.id} title={`${a.name}（${formatSize(a.size)}）
点击打开`}>
              <button className="file-open" onClick={() => runSafe(() => window.api.openAttachment(a.id))}>
                <Icon name="paperclip" size={12} />
                <span>{a.name}</span>
              </button>
              <button className="file-op" title="在文件夹中显示" onClick={() => runSafe(() => window.api.revealAttachment(a.id))}>
                <Icon name="folder" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {(e.notes || tags.length > 0) && (
        <div className="card-foot">
          {e.notes && (
            <div className="notes" title={e.notes}>
              {e.notes}
            </div>
          )}
          {tags.length > 0 && (
            <div className="tags">
              {tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  secret,
  link,
  highlight
}: {
  label: string
  value: string
  secret?: boolean
  link?: boolean
  highlight?: boolean
}) {
  const [reveal, setReveal] = useState(false)
  const masked = secret && !reveal
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span
        className={`kv-value mono ${highlight ? 'code' : ''} ${masked ? 'masked' : ''}`}
        title="点击复制"
        onClick={() => copyText(value, label, secret)}
      >
        {masked ? '••••••••' : value}
      </span>
      <span className="kv-actions">
        {secret && (
          <button className="icon-btn sm" title={reveal ? '隐藏' : '显示'} onClick={() => setReveal(!reveal)}>
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
        {link && (
          <button className="icon-btn sm" title="在浏览器中打开" onClick={() => window.api.openUrl(value)}>
            <Icon name="external" size={14} />
          </button>
        )}
        <CopyButton text={value} label={label} secret={secret} />
      </span>
    </div>
  )
}

function ExpiryBadge({ expires, warnDays }: { expires: string; warnDays: number }) {
  const info = expiryInfo(expires, warnDays)
  if (!info) return null
  return (
    <span className={`expiry ${info.cls}`} title={`有效期至 ${expires}`}>
      <Icon name="calendar" size={11} />
      {info.cls === 'ok' ? expires : info.text}
    </span>
  )
}

/** 动态码：每秒刷新，环形进度表示剩余时间 */
function TotpField({ secret }: { secret: string }) {
  const { code, remaining, period, valid } = useTotp(secret)
  if (!valid) {
    return (
      <div className="kv-row">
        <span className="kv-label">动态码</span>
        <span className="kv-value muted">密钥无效，请编辑检查</span>
      </div>
    )
  }
  const r = 7
  const len = 2 * Math.PI * r
  const urgent = remaining <= 5
  return (
    <div className="kv-row">
      <span className="kv-label">动态码</span>
      <span className={`kv-value mono totp ${urgent ? 'urgent' : ''}`} title="点击复制" onClick={() => copyText(code, '动态码')}>
        {formatCode(code)}
      </span>
      <svg className={`totp-ring ${urgent ? 'urgent' : ''}`} width="18" height="18" viewBox="0 0 18 18" aria-label={`${remaining} 秒后刷新`}>
        <circle cx="9" cy="9" r={r} className="bg" />
        <circle cx="9" cy="9" r={r} className="fg" strokeDasharray={len} strokeDashoffset={len * (1 - remaining / period)} />
      </svg>
      <span className="totp-sec">{remaining}s</span>
      <span className="kv-actions">
        <CopyButton text={code} label="动态码" />
      </span>
    </div>
  )
}
