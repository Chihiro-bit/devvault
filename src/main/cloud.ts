/**
 * 云端（服务端）客户端。服务端尚未部署，接口约定见 docs/server-api.md。
 * 本地功能不依赖这里；需要服务端的功能请用 cloudOnly() 包装 IPC，或调用 cloudRequest()。
 */
import type { CloudState, CloudUser } from '../shared/types'
import { decrypt, encrypt } from './crypto'
import { getSetting, setSetting } from './settings'
import { broadcast } from './windows'

const KEY = {
  server: 'cloud.serverUrl',
  token: 'cloud.token',
  user: 'cloud.user'
}

const TIMEOUT_MS = 10_000

function readUser(): CloudUser | null {
  try {
    return JSON.parse(getSetting(KEY.user) ?? 'null') as CloudUser | null
  } catch {
    return null
  }
}

const token = () => decrypt(getSetting(KEY.token))

export function cloudState(): CloudState {
  const user = readUser()
  return { serverUrl: getSetting(KEY.server) ?? '', user, loggedIn: !!user && !!token() }
}

function emit(): void {
  broadcast('cloud:changed', cloudState())
}

function normalizeUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+/i.test(u)) throw new Error('服务器地址需以 http:// 或 https:// 开头')
  return u
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string }
    if (body?.message) return body.message
  } catch {
    /* 非 JSON 响应 */
  }
  return res.status === 401 ? '账号或密码错误' : `请求失败（HTTP ${res.status}）`
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new Error('无法连接服务器，请检查地址或网络')
  }
}

export async function login(serverUrl: string, username: string, password: string): Promise<CloudState> {
  const base = normalizeUrl(serverUrl)
  if (!username.trim() || !password) throw new Error('请输入账号和密码')

  const res = await send(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password })
  })
  if (!res.ok) throw new Error(await readError(res))

  const data = (await res.json().catch(() => null)) as { token?: unknown; user?: Partial<CloudUser> } | null
  if (typeof data?.token !== 'string' || !data.user?.id) throw new Error('服务器返回的数据格式不正确')

  setSetting(KEY.server, base)
  setSetting(KEY.token, encrypt(data.token))
  setSetting(KEY.user, JSON.stringify({ id: String(data.user.id), name: data.user.name ?? username, email: data.user.email }))
  emit()
  return cloudState()
}

function clearSession(): void {
  setSetting(KEY.token, null)
  setSetting(KEY.user, null)
  emit()
}

export async function logout(): Promise<CloudState> {
  const { serverUrl } = cloudState()
  const t = token()
  clearSession()
  // 尽力通知服务端注销，失败不影响本地退出
  if (serverUrl && t) {
    await send(`${serverUrl}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(
      () => undefined
    )
  }
  return cloudState()
}

/** 以当前登录身份调用服务端接口；登录失效（401）时自动退出登录 */
export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { serverUrl, loggedIn } = cloudState()
  if (!loggedIn) throw new Error('该功能需要登录后使用')
  const res = await send(`${serverUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${token()}` }
  })
  if (res.status === 401) {
    clearSession()
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

/** 包装仅登录后可用的 IPC 处理函数 */
export function cloudOnly<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
  return async (_e: unknown, ...args: A): Promise<R> => {
    if (!cloudState().loggedIn) throw new Error('该功能需要登录后使用')
    return fn(...args)
  }
}
