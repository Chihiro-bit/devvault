/**
 * 附件文件管理。文件以原始文件名保存在 userData/attachments/<随机目录>/ 下，
 * 打开或在资源管理器中查看时保持原名；数据库只存元数据（见 repo.ts）。
 */
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { copyFile, mkdir, readdir, rm, stat } from 'fs/promises'
import { basename, join } from 'path'
import * as repo from './repo'
import type { Attachment, AttachmentOwner } from '../shared/types'

const MAX_SIZE = 2 * 1024 ** 3

export const attachmentsDir = () => join(app.getPath('userData'), 'attachments')
const storedPath = (stored: string) => join(attachmentsDir(), stored)

function newSlot(name: string): string {
  const dir = randomBytes(8).toString('hex')
  mkdirSync(join(attachmentsDir(), dir), { recursive: true })
  return `${dir}/${name}`
}

export async function addFiles(owner: AttachmentOwner, paths: string[]): Promise<Attachment[]> {
  for (const src of paths) {
    const st = await stat(src)
    if (!st.isFile()) throw new Error(`「${basename(src)}」不是文件，暂不支持添加文件夹`)
    if (st.size > MAX_SIZE) throw new Error(`「${basename(src)}」超过 2GB，无法添加`)
    const stored = newSlot(basename(src))
    await copyFile(src, storedPath(stored))
    try {
      repo.insertAttachment(owner, basename(src), st.size, stored)
    } catch (e) {
      await rm(join(attachmentsDir(), stored.split('/')[0]), { recursive: true, force: true })
      throw e
    }
  }
  return repo.listAttachments(owner)
}

export async function pickFiles(win: BrowserWindow | undefined, owner: AttachmentOwner): Promise<Attachment[] | null> {
  const opts = { title: '添加附件', properties: ['openFile' as const, 'multiSelections' as const] }
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (canceled || !filePaths.length) return null
  return addFiles(owner, filePaths)
}

function locate(id: number): { name: string; path: string } {
  const a = repo.getAttachment(id)
  if (!a) throw new Error('附件不存在')
  const path = storedPath(a.stored)
  if (!existsSync(path)) throw new Error('附件文件已丢失')
  return { name: a.name, path }
}

export async function openAttachment(id: number): Promise<void> {
  const err = await shell.openPath(locate(id).path)
  if (err) throw new Error(`无法打开：${err}`)
}

export function revealAttachment(id: number): void {
  shell.showItemInFolder(locate(id).path)
}

export async function saveAttachmentAs(win: BrowserWindow | undefined, id: number): Promise<string | null> {
  const { name, path } = locate(id)
  const opts = { title: '另存为', defaultPath: name }
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (canceled || !filePath) return null
  await copyFile(path, filePath)
  return filePath
}

export async function deleteAttachment(id: number): Promise<void> {
  const a = repo.getAttachment(id)
  if (!a) return
  repo.deleteAttachmentRow(id)
  await rm(join(attachmentsDir(), a.stored.split('/')[0]), { recursive: true, force: true })
}

/** 删除不再被任何记录引用的附件目录（记录被删除后由外键级联删掉了元数据） */
export async function gcAttachments(): Promise<void> {
  const dir = attachmentsDir()
  if (!existsSync(dir)) return
  const used = new Set([...repo.storedFileNames()].map((s) => s.split('/')[0]))
  for (const slot of await readdir(dir)) {
    if (!used.has(slot)) await rm(join(dir, slot), { recursive: true, force: true })
  }
}

// ---------- 备份 ----------

/** 导出时把附件复制到备份目录的 attachments/ 下，保持相同的相对路径 */
export async function exportFiles(stored: string[], backupDir: string): Promise<void> {
  for (const s of stored) {
    const src = storedPath(s)
    if (!existsSync(src)) continue
    const dest = join(backupDir, 'attachments', s)
    await mkdir(join(dest, '..'), { recursive: true })
    await copyFile(src, dest)
  }
}

/** 导入时（同步，在数据库事务中调用）复制备份中的附件文件，返回新的存储路径 */
export function importFileFrom(backupDir: string) {
  return (file: string): string | null => {
    const src = join(backupDir, 'attachments', file)
    if (!existsSync(src) || !statSync(src).isFile()) return null
    const stored = newSlot(basename(file))
    copyFileSync(src, storedPath(stored))
    return stored
  }
}
