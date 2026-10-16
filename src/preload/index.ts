import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AppInfo,
  AppPrefs,
  Attachment,
  AttachmentOwner,
  CloudState,
  LockState,
  UnlockResult,
  Entry,
  EntryInput,
  ImportResult,
  ListQuery,
  NavTarget,
  PriorityInput,
  PriorityLevel,
  PriorityRemoval,
  Project,
  ProjectInput,
  Scope,
  StatusInput,
  Stats,
  Todo,
  TodoComment,
  TodoInput,
  TodoPatch,
  TodoStatus
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  appInfo: () => invoke<AppInfo>('app:info'),

  listProjects: () => invoke<Project[]>('projects:list'),
  saveProject: (p: ProjectInput) => invoke<number>('projects:save', p),
  deleteProject: (id: number) => invoke<void>('projects:delete', id),
  getStats: () => invoke<Stats>('stats:get'),

  listEntries: (q: ListQuery) => invoke<Entry[]>('entries:list', q),
  saveEntry: (e: EntryInput) => invoke<number>('entries:save', e),
  deleteEntry: (id: number) => invoke<void>('entries:delete', id),
  toggleFavorite: (id: number) => invoke<void>('entries:favorite', id),

  listTodos: (q: ListQuery) => invoke<Todo[]>('todos:list', q),
  saveTodo: (t: TodoInput) => invoke<number>('todos:save', t),
  toggleTodo: (id: number) => invoke<void>('todos:toggle', id),
  deleteTodo: (id: number) => invoke<void>('todos:delete', id),
  clearDoneTodos: (scope: Scope) => invoke<number>('todos:clearDone', scope),
  getTodo: (id: number) => invoke<Todo | null>('todos:get', id),
  patchTodo: (id: number, patch: TodoPatch) => invoke<void>('todos:patch', id, patch),
  listSubtasks: (id: number) => invoke<Todo[]>('todos:subtasks', id),

  listStatuses: () => invoke<TodoStatus[]>('statuses:list'),
  saveStatuses: (items: StatusInput[], removed: PriorityRemoval[]) => invoke<void>('statuses:save', items, removed),

  listComments: (todoId: number) => invoke<TodoComment[]>('comments:list', todoId),
  addComment: (todoId: number, content: string) => invoke<number>('comments:add', todoId, content),
  deleteComment: (id: number) => invoke<void>('comments:delete', id),

  listAttachments: (owner: AttachmentOwner) => invoke<Attachment[]>('attachments:list', owner),
  addAttachments: (owner: AttachmentOwner, paths: string[]) => invoke<Attachment[]>('attachments:add', owner, paths),
  pickAttachments: (owner: AttachmentOwner) => invoke<Attachment[] | null>('attachments:pick', owner),
  openAttachment: (id: number) => invoke<void>('attachments:open', id),
  revealAttachment: (id: number) => invoke<void>('attachments:reveal', id),
  saveAttachmentAs: (id: number) => invoke<string | null>('attachments:saveAs', id),
  deleteAttachment: (id: number) => invoke<void>('attachments:delete', id),
  /** 拖入的文件在本地磁盘上的路径（Electron 32+ 不再提供 File.path） */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  pinTodo: (id: number, pinned: boolean) => invoke<void>('todos:pin', id, pinned),
  setPinTop: (id: number, top: boolean) => invoke<void>('todos:pinTop', id, top),

  listPriorities: () => invoke<PriorityLevel[]>('priorities:list'),
  savePriorities: (levels: PriorityInput[], removed: PriorityRemoval[]) =>
    invoke<void>('priorities:save', levels, removed),

  resizeWidget: (width: number) => invoke<void>('widget:resize', width),
  showMain: (target?: NavTarget | NavTarget['page']) => invoke<void>('app:showMain', target),
  hideQuick: () => invoke<void>('quick:hide'),
  resizeQuick: (height: number) => invoke<void>('quick:resize', height),
  onQuickShown: (cb: () => void) => subscribe('quick:shown', cb),

  getPrefs: () => invoke<AppPrefs>('prefs:get'),
  setPrefs: (patch: Partial<AppPrefs>) => invoke<AppPrefs>('prefs:set', patch),
  testNotify: () => invoke<void>('prefs:testNotify'),
  onPrefsChanged: (cb: (p: AppPrefs) => void) => subscribe('prefs:changed', cb),
  /** 待办或项目发生变化（含其他窗口中的操作），返回取消订阅函数 */
  onTodosChanged: (cb: () => void) => subscribe('todos:changed', cb),
  onNavigate: (cb: (target: NavTarget) => void) => subscribe('app:navigate', cb),

  lockState: () => invoke<LockState>('lock:state'),
  unlock: (password: string) => invoke<UnlockResult>('lock:unlock', password),
  reportActivity: () => invoke<void>('lock:activity'),
  lockNow: () => invoke<void>('lock:now'),
  setLockPassword: (current: string | null, next: string | null) =>
    invoke<LockState>('lock:setPassword', current, next),
  configureLock: (opts: { enabled: boolean; idleSeconds: number }) => invoke<LockState>('lock:configure', opts),
  onLockChanged: (cb: (s: LockState) => void) => subscribe('lock:changed', cb),

  cloudState: () => invoke<CloudState>('cloud:state'),
  login: (server: string, username: string, password: string) =>
    invoke<CloudState>('cloud:login', server, username, password),
  logout: () => invoke<CloudState>('cloud:logout'),
  onCloudChanged: (cb: (s: CloudState) => void) => subscribe('cloud:changed', cb),

  copy: (text: string, clearAfterSec = 0) => invoke<void>('clipboard:copy', text, clearAfterSec),
  openUrl: (url: string) => invoke<void>('shell:open', url),
  exportData: () => invoke<string | null>('data:export'),
  importData: () => invoke<ImportResult | null>('data:import')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
