import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import * as repo from './repo'
import { dbPath } from './db'
import { encryptionAvailable } from './crypto'
import { assetPath, broadcast, hideQuickWindow, resizeQuickWindow, resizeWidget, showMainWindow, syncWidgets } from './windows'
import { getPrefs, setPrefs } from './prefs'
import { applyHotkey, updateTrayMenu } from './tray'
import { configureLock, isLocked, lockNow, lockState, reportActivity, setLockPassword, unlock } from './lock'
import { changePassword, cloudOnly, cloudState, login, logout, register, serverInfo } from './cloud'
import { scheduleSync, syncNow } from './sync'
import * as files from './attachments'
import type {
  AppInfo,
  AppPrefs,
  AttachmentOwner,
  EntryInput,
  ListQuery,
  NavTarget,
  PriorityInput,
  PriorityRemoval,
  ProjectInput,
  RegisterInput,
  Scope,
  StatusInput,
  TodoInput,
  TodoPatch
} from '../shared/types'

let clipboardTimer: NodeJS.Timeout | null = null

/**
 * 锁定期间仅放行锁屏本身和桌面任务条需要的接口，其余一律拒绝（默认拒绝）。
 * 新增 IPC 时如需在锁定状态下可用，需显式加入此列表。
 */
const ALLOWED_WHILE_LOCKED = new Set([
  'app:info',
  'lock:state',
  'lock:unlock',
  'lock:activity',
  'todos:get',
  'todos:toggle',
  'todos:pin',
  'todos:pinTop',
  'widget:resize',
  'app:showMain',
  'quick:hide',
  'quick:resize'
])

type Listener = Parameters<typeof ipcMain.handle>[1]

function handle(channel: string, listener: Listener): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (isLocked() && !ALLOWED_WHILE_LOCKED.has(channel)) throw new Error('应用已锁定')
    return listener(e, ...args)
  })
}

/** 包装会修改待办/项目的操作：执行后同步桌面任务条、通知所有窗口刷新，并安排云同步 */
function mutating<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
  return async (_e: unknown, ...args: A): Promise<R> => {
    const result = await fn(...args)
    syncWidgets()
    broadcast('todos:changed')
    updateTrayMenu()
    scheduleSync()
    return result
  }
}

/** 包装只修改账号记录的操作：执行后安排云同步 */
function syncing<A extends unknown[], R>(fn: (...args: A) => R) {
  return (_e: unknown, ...args: A): R => {
    const result = fn(...args)
    scheduleSync()
    return result
  }
}

/** 删除记录后清理不再引用的附件文件（不阻塞调用方） */
const gcLater = () => void files.gcAttachments().catch(() => undefined)

const winOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined

export function registerIpc(): void {
  handle('app:info', (): AppInfo => ({
    dbPath: dbPath(),
    encrypted: encryptionAvailable(),
    version: app.getVersion()
  }))

  handle('projects:list', () => repo.listProjects())
  handle('projects:save', mutating((p: ProjectInput) => repo.saveProject(p)))
  handle('projects:delete', mutating((id: number) => repo.deleteProject(id)))
  handle('stats:get', () => repo.getStats())

  handle('entries:list', (_e, q: ListQuery) => repo.listEntries(q))
  handle('entries:save', syncing((entry: EntryInput) => repo.saveEntry(entry)))
  handle(
    'entries:delete',
    syncing((id: number) => {
      repo.deleteEntry(id)
      gcLater()
    })
  )
  handle('entries:favorite', syncing((id: number) => repo.toggleFavorite(id)))

  handle('todos:list', (_e, q: ListQuery) => repo.listTodos(q))
  handle('todos:get', (_e, id: number) => repo.getTodo(id))
  handle('todos:save', mutating((todo: TodoInput) => repo.saveTodo(todo)))
  handle('todos:toggle', mutating((id: number) => repo.toggleTodo(id)))
  handle(
    'todos:delete',
    mutating((id: number) => {
      repo.deleteTodo(id)
      gcLater()
    })
  )
  handle(
    'todos:clearDone',
    mutating((scope: Scope) => {
      const n = repo.clearDoneTodos(scope)
      gcLater()
      return n
    })
  )
  handle('todos:patch', mutating((id: number, patch: TodoPatch) => repo.patchTodo(id, patch)))
  handle('todos:subtasks', (_e, id: number) => repo.listSubtasks(id))

  handle('statuses:list', () => repo.listStatuses())
  handle(
    'statuses:save',
    mutating((items: StatusInput[], removed: PriorityRemoval[]) => repo.saveStatuses(items, removed))
  )

  handle('comments:list', (_e, todoId: number) => repo.listComments(todoId))
  handle('comments:add', mutating((todoId: number, content: string) => repo.addComment(todoId, content)))
  handle('comments:delete', mutating((id: number) => repo.deleteComment(id)))

  // 附件变动会影响待办上的附件计数，因此同样广播刷新
  handle('attachments:list', (_e, owner: AttachmentOwner) => repo.listAttachments(owner))
  handle('attachments:add', mutating((owner: AttachmentOwner, paths: string[]) => files.addFiles(owner, paths)))
  handle('attachments:pick', async (e, owner: AttachmentOwner) => {
    const r = await files.pickFiles(winOf(e), owner)
    if (r) broadcast('todos:changed')
    return r
  })
  handle('attachments:open', (_e, id: number) => files.openAttachment(id))
  handle('attachments:reveal', (_e, id: number) => files.revealAttachment(id))
  handle('attachments:saveAs', (e, id: number) => files.saveAttachmentAs(winOf(e), id))
  handle('attachments:delete', mutating((id: number) => files.deleteAttachment(id)))
  handle('todos:pin', mutating((id: number, pinned: boolean) => repo.setPinned(id, pinned)))
  handle('todos:pinTop', mutating((id: number, top: boolean) => repo.setPinTop(id, top)))

  handle('priorities:list', () => repo.listPriorities())
  handle(
    'priorities:save',
    mutating((levels: PriorityInput[], removed: PriorityRemoval[]) => repo.savePriorities(levels, removed))
  )

  handle('lock:state', () => lockState())
  handle('lock:unlock', (_e, password: string) => unlock(password))
  handle('lock:activity', () => reportActivity())
  handle('lock:now', () => lockNow())
  handle('lock:setPassword', (_e, current: string | null, next: string | null) => setLockPassword(current, next))
  handle('lock:configure', (_e, opts: { enabled: boolean; idleSeconds: number }) => configureLock(opts))

  handle('cloud:state', () => cloudState())
  handle('cloud:login', (_e, server: string, username: string, password: string) => login(server, username, password))
  handle('cloud:logout', () => logout())
  handle('cloud:register', (_e, input: RegisterInput) => register(input))
  handle('cloud:serverInfo', (_e, server: string) => serverInfo(server))
  handle('cloud:changePassword', cloudOnly((current: string, next: string) => changePassword(current, next)))
  handle(
    'cloud:sync',
    cloudOnly(async () => {
      await syncNow()
      return cloudState()
    })
  )

  handle('app:showMain', (_e, target?: NavTarget | NavTarget['page']) => {
    hideQuickWindow()
    showMainWindow(target)
  })
  handle('quick:hide', () => hideQuickWindow())
  handle('quick:resize', (_e, height: number) => resizeQuickWindow(height))

  handle('prefs:get', () => getPrefs())
  handle('prefs:testNotify', () => {
    if (!Notification.isSupported()) throw new Error('当前系统不支持通知')
    new Notification({ title: 'DevVault 测试通知', body: '通知正常，待办提醒和每日摘要会以这种方式出现。', icon: assetPath('icon.png') }).show()
  })
  handle('prefs:set', (_e, patch: Partial<AppPrefs>) => {
    setPrefs(patch)
    if (patch.quickEnabled !== undefined || patch.quickHotkey !== undefined) applyHotkey()
    updateTrayMenu()
    const prefs = getPrefs()
    broadcast('prefs:changed', prefs)
    return prefs
  })
  handle('widget:resize', (e, width: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) resizeWidget(win, width)
  })

  // 复制敏感内容时可在 N 秒后自动清空剪贴板（仅当剪贴板内容未被替换）
  handle('clipboard:copy', (_e, text: string, clearAfterSec = 0) => {
    clipboard.writeText(text)
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboardTimer = null
    if (clearAfterSec > 0) {
      clipboardTimer = setTimeout(() => {
        if (clipboard.readText() === text) clipboard.clear()
        clipboardTimer = null
      }, clearAfterSec * 1000)
    }
  })

  handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })

  // 备份导出为目录：data.json + attachments/
  handle('data:export', async (e) => {
    const win = winOf(e)
    const opts = { title: '选择备份保存位置', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (canceled || !filePaths[0]) return null
    const stamp = new Date().toLocaleString('sv').replace(/[-: ]/g, '').slice(0, 12)
    const dir = join(filePaths[0], `DevVault备份-${stamp}`)
    await mkdir(dir, { recursive: true })
    const data = repo.exportAll()
    await writeFile(join(dir, 'data.json'), JSON.stringify(data, null, 2), 'utf-8')
    await files.exportFiles((data.attachments ?? []).map((a) => a.file), dir)
    return dir
  })

  // 导入 data.json（兼容旧版单个 JSON 备份），同目录下的 attachments/ 一并导入
  handle('data:import', async (e) => {
    const win = winOf(e)
    const opts = {
      title: '导入备份（选择 data.json）',
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (canceled || !filePaths[0]) return null
    const data = JSON.parse(await readFile(filePaths[0], 'utf-8'))
    const result = repo.importAll(data, files.importFileFrom(dirname(filePaths[0])))
    syncWidgets()
    broadcast('todos:changed')
    scheduleSync()
    return result
  })
}
