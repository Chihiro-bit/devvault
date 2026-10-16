import type { Category, EntryInput, Repeat, Scope, StatusKind, Todo } from '../../shared/types'
import type { IconName } from './components/Icon'

export interface CategoryMeta {
  key: Category
  label: string
  icon: IconName
  urlLabel: string
  userLabel: string
  pwdLabel: string
  codeLabel: string
  /** 是否在表单中默认展示验证码字段 */
  showCode: boolean
  urlPlaceholder: string
  /** 常用的附加字段，点击即可快速添加 */
  presets: { key: string; secret?: boolean }[]
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'account',
    label: '测试账号',
    icon: 'user',
    urlLabel: '登录地址',
    userLabel: '账号',
    pwdLabel: '密码',
    codeLabel: '固定验证码',
    showCode: true,
    urlPlaceholder: 'https://test.example.com/login',
    presets: [{ key: '手机号' }, { key: '角色' }, { key: '租户 / 组织' }, { key: '支付密码', secret: true }]
  },
  {
    key: 'git',
    label: 'Git',
    icon: 'git',
    urlLabel: '平台 / 仓库地址',
    userLabel: '用户名',
    pwdLabel: '密码 / Token',
    codeLabel: '验证码',
    showCode: false,
    urlPlaceholder: 'https://gitlab.company.com',
    presets: [{ key: 'SSH 地址' }, { key: 'Access Token', secret: true }, { key: '邮箱' }]
  },
  {
    key: 'vpn',
    label: 'VPN',
    icon: 'shield',
    urlLabel: '服务器地址',
    userLabel: '用户名',
    pwdLabel: '密码',
    codeLabel: '动态码 / 验证码',
    showCode: true,
    urlPlaceholder: 'vpn.company.com:443',
    presets: [{ key: '协议' }, { key: '共享密钥', secret: true }, { key: '客户端下载' }]
  },
  {
    key: 'server',
    label: '服务器',
    icon: 'server',
    urlLabel: '主机 / IP',
    userLabel: '用户名',
    pwdLabel: '密码',
    codeLabel: '验证码',
    showCode: false,
    urlPlaceholder: '192.168.1.100',
    presets: [{ key: '端口' }, { key: '密钥路径' }, { key: '跳板机' }]
  },
  {
    key: 'database',
    label: '数据库',
    icon: 'database',
    urlLabel: '连接地址',
    userLabel: '用户名',
    pwdLabel: '密码',
    codeLabel: '验证码',
    showCode: false,
    urlPlaceholder: 'mysql://10.0.0.8:3306',
    presets: [{ key: '端口' }, { key: '库名' }, { key: '类型' }]
  },
  {
    key: 'other',
    label: '其他',
    icon: 'key',
    urlLabel: '地址',
    userLabel: '账号',
    pwdLabel: '密码',
    codeLabel: '验证码',
    showCode: true,
    urlPlaceholder: 'https://',
    presets: [{ key: '说明' }, { key: '密钥', secret: true }]
  }
]

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<Category, CategoryMeta>

export const ENVS = ['开发', '测试', '预发', '生产']

export const ENV_CLASS: Record<string, string> = { 开发: 'dev', 测试: 'test', 预发: 'pre', 生产: 'prod' }

/** 新建优先级时依次取用的颜色 */
export const LEVEL_COLORS = ['#e5484d', '#f76b15', '#e3a008', '#16a37b', '#0ea5c6', '#3b6cff', '#9b5cf6', '#8a919e']

export const MAX_LEVELS = 8

export const STATUS_KINDS: { value: StatusKind; label: string }[] = [
  { value: 'todo', label: '未开始' },
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' }
]

export const REPEATS: { value: Repeat; label: string }[] = [
  { value: '', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '每个工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' }
]

export const REPEAT_LABEL = Object.fromEntries(REPEATS.map((r) => [r.value, r.label])) as Record<Repeat, string>

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export const splitTags = (tags: string) => (tags ? tags.split(',').filter(Boolean) : [])

/** 待办的优先级展示信息；等级被删除等异常情况下显示为「未定级」 */
export function levelOf(t: Pick<Todo, 'priority_label' | 'priority_name' | 'priority_color'>) {
  return {
    label: t.priority_label ?? '—',
    name: t.priority_name ?? '未定级',
    color: t.priority_color ?? '#8a919e'
  }
}

export const PROJECT_COLORS = ['#3b6cff', '#16a37b', '#f59e0b', '#e5484d', '#9b5cf6', '#0ea5c6', '#e1488f', '#64748b']

export function emptyEntry(scope: Scope, category: Category = 'account'): EntryInput {
  return {
    project_id: typeof scope === 'number' ? scope : null,
    category,
    title: '',
    env: '',
    url: '',
    username: '',
    password: '',
    verify_code: '',
    totp: '',
    expires_at: '',
    notes: '',
    tags: '',
    extra: [],
    favorite: false
  }
}

export const isHttpUrl = (s: string) => /^https?:\/\//i.test(s)

export const today = () => new Date().toLocaleDateString('sv')

/** 截止日期的展示文案与状态（逾期 / 今天到期） */
export function dueInfo(t: Pick<Todo, 'due_date' | 'done'>): { text: string; cls: string } | null {
  if (!t.due_date) return null
  const d = today()
  if (t.done) return { text: t.due_date, cls: '' }
  if (t.due_date < d) return { text: `逾期 ${t.due_date.slice(5)}`, cls: 'overdue' }
  if (t.due_date === d) return { text: '今天到期', cls: 'today' }
  return { text: t.due_date.slice(0, 4) === d.slice(0, 4) ? t.due_date.slice(5) : t.due_date, cls: '' }
}

export function generatePassword(len = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*_-'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

const DAY = 86400000

/** 距离某天还有几天（今天为 0，过去为负数） */
export function daysUntil(date: string, from = today()): number {
  return Math.round((Date.parse(`${date}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / DAY)
}

/** 账号有效期的展示：已过期 / N 天内过期 / 长期 */
export function expiryInfo(expires: string, warnDays: number): { text: string; cls: 'expired' | 'soon' | 'ok' } | null {
  if (!expires) return null
  const n = daysUntil(expires)
  if (n < 0) return { text: `已过期 ${-n} 天`, cls: 'expired' }
  if (n === 0) return { text: '今天过期', cls: 'expired' }
  if (n <= warnDays) return { text: `${n} 天后过期`, cls: 'soon' }
  return { text: `有效期至 ${expires}`, cls: 'ok' }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv')
}
