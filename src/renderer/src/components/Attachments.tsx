import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { Attachment, AttachmentOwner } from '../../../shared/types'
import { formatSize } from '../constants'
import { Icon } from './Icon'
import { confirmDialog, errText, toast } from './ui'

/** 待上传的本地文件（新建记录保存前暂存） */
export interface PendingFile {
  path: string
  name: string
}

const ownerKey = (o: AttachmentOwner | null) => (!o ? '' : 'entryId' in o ? `e${o.entryId}` : `t${o.todoId}`)

/**
 * 附件列表：owner 存在时直接读写；owner 为空（记录尚未保存）时暂存到 pending，由上层在保存后上传。
 */
export function AttachmentList({
  owner,
  pending = [],
  onPendingChange,
  onChanged
}: {
  owner: AttachmentOwner | null
  pending?: PendingFile[]
  onPendingChange?: (files: PendingFile[]) => void
  onChanged?: () => void
}) {
  const [items, setItems] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const key = ownerKey(owner)

  const reload = useCallback(() => {
    if (owner) window.api.listAttachments(owner).then(setItems)
    else setItems([])
  }, [key])

  useEffect(reload, [reload])

  const add = async (files: File[]) => {
    const picked = files
      .map((f) => ({ path: window.api.pathForFile(f), name: f.name }))
      .filter((f) => f.path)
    if (!picked.length) return
    if (!owner) {
      onPendingChange?.([...pending, ...picked.filter((p) => !pending.some((x) => x.path === p.path))])
      return
    }
    setBusy(true)
    try {
      setItems(await window.api.addAttachments(owner, picked.map((p) => p.path)))
      toast(`已添加 ${picked.length} 个附件`)
      onChanged?.()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Attachment) => {
    if (!(await confirmDialog(`确定删除附件「${a.name}」吗？文件将从本机数据目录中移除。`, { title: '删除附件', okText: '删除' })))
      return
    await window.api.deleteAttachment(a.id)
    reload()
    onChanged?.()
  }

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errText(e), 'err'))

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    add(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={`attach ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {(items.length > 0 || pending.length > 0) && (
        <ul className="attach-list">
          {items.map((a) => (
            <li key={a.id} className="attach-item">
              <span className="attach-icon">
                <Icon name="file" size={15} />
              </span>
              <button className="attach-name" title="打开" onClick={() => run(() => window.api.openAttachment(a.id))}>
                {a.name}
              </button>
              <span className="attach-size">{formatSize(a.size)}</span>
              <span className="attach-ops">
                <button className="icon-btn sm" title="另存为" onClick={() => run(() => window.api.saveAttachmentAs(a.id))}>
                  <Icon name="download" size={14} />
                </button>
                <button className="icon-btn sm" title="在文件夹中显示" onClick={() => run(() => window.api.revealAttachment(a.id))}>
                  <Icon name="folder" size={14} />
                </button>
                <button className="icon-btn sm danger" title="删除" onClick={() => remove(a)}>
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.path} className="attach-item pending">
              <span className="attach-icon">
                <Icon name="file" size={15} />
              </span>
              <span className="attach-name" title={p.path}>
                {p.name}
              </span>
              <span className="attach-size">保存后上传</span>
              <span className="attach-ops">
                <button
                  className="icon-btn sm danger"
                  title="移除"
                  onClick={() => onPendingChange?.(pending.filter((x) => x.path !== p.path))}
                >
                  <Icon name="x" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button className="attach-drop" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Icon name="paperclip" size={14} />
        {busy ? '正在添加…' : '添加附件，或将文件拖到这里'}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}
