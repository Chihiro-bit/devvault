export type Category = 'account' | 'git' | 'vpn' | 'server' | 'database' | 'other'

/** 'all' 全部项目, 'none' 未分组, number 指定项目 */
export type Scope = 'all' | 'none' | number

export interface Project {
  id: number
  name: string
  color: string
  description: string
  created_at: string
  entry_count: number
  todo_count: number
}

export interface ProjectInput {
  id?: number
  name: string
  color: string
  description: string
}

export interface ExtraField {
  key: string
  value: string
  secret: boolean
}

export interface Entry {
  id: number
  project_id: number | null
  project_name: string | null
  project_color: string | null
  category: Category
  title: string
  env: string
  url: string
  username: string
  password: string
  verify_code: string
  /** TOTP 密钥：base32 字符串或 otpauth:// 链接，加密存储 */
  totp: string
  /** 有效期（YYYY-MM-DD），空表示长期有效 */
  expires_at: string
  notes: string
  tags: string
  extra: ExtraField[]
  favorite: boolean
  attachments: Attachment[]
  created_at: string
  updated_at: string
}

export type EntryInput = Omit<Entry, 'id' | 'project_name' | 'project_color' | 'attachments' | 'created_at' | 'updated_at'> & {
  id?: number
}

/** 用户自定义的优先级，sort_order 越小越优先 */
export interface PriorityLevel {
  id: number
  label: string
  name: string
  color: string
  sort_order: number
  is_default: boolean
  /** 使用该等级的未完成待办数 */
  todo_count: number
}

export interface PriorityInput {
  id?: number
  label: string
  name: string
  color: string
  is_default: boolean
}

/** 删除等级时，其下待办迁移到的等级；null 表示迁移到默认等级 */
export interface PriorityRemoval {
  id: number
  moveTo: number | null
}

/** 状态分类：未开始 / 进行中 / 已完成，决定待办是否算作完成 */
export type StatusKind = 'todo' | 'active' | 'done'

export interface TodoStatus {
  id: number
  name: string
  color: string
  kind: StatusKind
  sort_order: number
  todo_count: number
}

export interface StatusInput {
  id?: number
  name: string
  color: string
  kind: StatusKind
}

/** '' 不重复 */
export type Repeat = '' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface Todo {
  id: number
  project_id: number | null
  project_name: string | null
  project_color: string | null
  parent_id: number | null
  parent_title: string | null
  title: string
  /** 描述 */
  notes: string
  /** 优先级等级 id */
  priority: number
  priority_label: string | null
  priority_name: string | null
  priority_color: string | null
  status_id: number
  status_name: string | null
  status_color: string | null
  status_kind: StatusKind
  start_date: string
  due_date: string
  /** 提醒时间（YYYY-MM-DDTHH:mm），空表示不提醒 */
  remind_at: string
  tags: string
  repeat: Repeat
  subtask_total: number
  subtask_done: number
  comment_count: number
  attachment_count: number
  done: boolean
  done_at: string | null
  /** 是否已钉到桌面 */
  pinned: boolean
  /** 桌面任务条是否置顶 */
  pin_top: boolean
  created_at: string
  updated_at: string
}

export interface TodoInput {
  id?: number
  project_id: number | null
  parent_id?: number | null
  title: string
  notes: string
  priority: number
  /** 不传则使用第一个「未开始」状态 */
  status_id?: number
  start_date?: string
  due_date: string
  remind_at?: string
  tags?: string
  repeat?: Repeat
}

/** 详情面板中逐字段修改 */
export type TodoPatch = Partial<
  Pick<
    Todo,
    'title' | 'notes' | 'priority' | 'status_id' | 'project_id' | 'start_date' | 'due_date' | 'remind_at' | 'tags' | 'repeat'
  >
>

export interface TodoComment {
  id: number
  todo_id: number
  content: string
  created_at: string
}

export interface Attachment {
  id: number
  name: string
  size: number
  created_at: string
}

export type AttachmentOwner = { entryId: number } | { todoId: number }

export interface ListQuery {
  scope: Scope
  keyword?: string
}

export interface Stats {
  entries: number
  todos: number
  noneEntries: number
  noneTodos: number
}

export interface AppInfo {
  dbPath: string
  encrypted: boolean
  version: string
}

export interface ImportResult {
  projects: number
  entries: number
  todos: number
}

export interface LockState {
  /** 是否开启无操作自动锁定 */
  enabled: boolean
  /** 无操作多少秒后锁定 */
  idleSeconds: number
  hasPassword: boolean
  locked: boolean
}

export interface UnlockResult {
  ok: boolean
  message?: string
  /** 连续输错被临时禁止时，剩余等待秒数 */
  retryAfter?: number
}

export interface CloudUser {
  id: string
  name: string
  /** 登录名 */
  username: string
  email?: string
}

export interface SyncStatus {
  syncing: boolean
  /** 最近一次成功同步的时间（ISO 字符串） */
  lastSyncAt: string | null
  /** 最近一次同步失败的原因，成功后清空 */
  error: string | null
  /** 本机尚未上传的修改数 */
  pending: number
}

export interface CloudState {
  serverUrl: string
  user: CloudUser | null
  loggedIn: boolean
  sync: SyncStatus
}

export interface ServerInfo {
  name: string
  version: string
  apiVersion: number
  allowRegistration: boolean
}

export interface RegisterInput {
  serverUrl: string
  username: string
  password: string
  name?: string
  email?: string
}

/** 应用偏好（托盘、快速搜索、提醒） */
export interface AppPrefs {
  quickEnabled: boolean
  /** Electron Accelerator 格式，如 Ctrl+Alt+Space */
  quickHotkey: string
  /** 快捷键是否注册成功（可能被其他程序占用） */
  quickHotkeyOk: boolean
  closeToTray: boolean
  openAtLogin: boolean
  /** 开机自启仅在安装版中可用 */
  canAutoLaunch: boolean
  notifyEnabled: boolean
  /** 每日摘要时间 HH:mm */
  digestTime: string
  /** 账号提前多少天提醒过期 */
  expiryDays: number
}

/** 从托盘、通知等处打开主窗口时的跳转目标 */
export interface NavTarget {
  page: 'entries' | 'todos'
  todoId?: number
  entryFilter?: 'expiring'
}
