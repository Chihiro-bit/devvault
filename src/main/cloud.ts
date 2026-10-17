/**
 * 云端（服务端）客户端，接口约定见 docs/server-api.md。
 * 服务器地址由用户填写：可使用统一提供的服务器，也可自行部署服务端（独立项目 dev-vault-server）。
 * 本地功能不依赖这里；需要服务端的功能请用 cloudOnly() 包装 IPC，或调用 cloudRequest()。
 */
import { hostname } from 'os'
import type { CloudState, CloudUser, RegisterInput, ServerInfo, SyncStatus } from '../shared/types'
import { decrypt, encrypt } from './crypto'
import { deriveKeys, newKdfParams, newVaultKey, unwrapVaultKey, wrapVaultKey, type KdfParams } from './e2ee'
import { getSetting, setSetting } from './settings'
import { broadcast } from './windows'

const KEY = {
  server: 'cloud.serverUrl',
  token: 'cloud.token',
  user: 'cloud.user',
  vaultKey: 'cloud.vaultKey'
}

/** 客户端支持的服务端接口版本 */
const API_VERSION = 1
const TIMEOUT_MS = 15_000

let syncStatus: SyncStatus = { syncing: false, lastSyncAt: null, error: null, pending: 0 }

type SessionListener = (loggedIn: boolean) => void
const sessionListeners: SessionListener[] = []

/** 登录 / 退出时回调（同步模块据此启动或停止） */
export function onSessionChange(cb: SessionListener): void {
  sessionListeners.push(cb)
}

function readUser(): CloudUser | null {
  try {
    return JSON.parse(getSetting(KEY.user) ?? 'null') as CloudUser | null
  } catch {
    return null
  }
}

const token = () => decrypt(getSetting(KEY.token))

/** 当前登录账号的数据密钥；未登录返回 null */
export function vaultKey(): Buffer | null {
  const k = decrypt(getSetting(KEY.vaultKey))
  return k ? Buffer.from(k, 'base64') : null
}

export function cloudState(): CloudState {
  const user = readUser()
  return {
    serverUrl: getSetting(KEY.server) ?? '',
    user,
    loggedIn: !!user && !!token() && !!vaultKey(),
    sync: syncStatus
  }
}

function emit(): void {
  broadcast('cloud:changed', cloudState())
}

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch }
  emit()
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await send(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

/** 连接测试：读取服务器信息并检查接口版本 */
export async function serverInfo(serverUrl: string): Promise<ServerInfo> {
  const base = normalizeUrl(serverUrl)
  const res = await send(`${base}/api/server/info`, { method: 'GET' })
  if (!res.ok) throw new Error(res.status === 404 ? '该地址不是 DevVault 服务器' : await readError(res))
  const info = (await res.json().catch(() => null)) as ServerInfo | null
  if (!info || typeof info.apiVersion !== 'number') throw new Error('该地址不是 DevVault 服务器')
  if (info.apiVersion > API_VERSION) throw new Error('服务器版本较新，请升级客户端')
  if (info.apiVersion < API_VERSION) throw new Error('服务器版本过旧，请联系管理员升级')
  return info
}

interface LoginResponse {
  token: string
  user: { id: string; name: string; username: string; email?: string }
  kdf: KdfParams
  encryptedVaultKey: string
}

function saveSession(base: string, data: LoginResponse, vault: Buffer): CloudState {
  if (typeof data?.token !== 'string' || !data.user?.id) throw new Error('服务器返回的数据格式不正确')
  const user: CloudUser = {
    id: String(data.user.id),
    name: data.user.name || data.user.username,
    username: data.user.username,
    email: data.user.email
  }
  setSetting(KEY.server, base)
  setSetting(KEY.token, encrypt(data.token))
  setSetting(KEY.vaultKey, encrypt(vault.toString('base64')))
  setSetting(KEY.user, JSON.stringify(user))
  emit()
  for (const cb of sessionListeners) cb(true)
  return cloudState()
}

const device = () => `DevVault · ${hostname()}`.slice(0, 128)

function checkInput(username: string, password: string): string {
  const u = username.trim()
  if (!u || !password) throw new Error('请输入账号和密码')
  return u
}

export async function login(serverUrl: string, username: string, password: string): Promise<CloudState> {
  const base = normalizeUrl(serverUrl)
  const u = checkInput(username, password)
  await serverInfo(base)

  const { kdf } = await postJson<{ kdf: KdfParams }>(`${base}/api/auth/prelogin`, { username: u })
  const keys = await deriveKeys(password, kdf)
  const data = await postJson<LoginResponse>(`${base}/api/auth/login`, { username: u, authKey: keys.authKey, device: device() })
  return saveSession(base, data, unwrapVaultKey(data.encryptedVaultKey, keys.wrapKey))
}

export async function register(input: RegisterInput): Promise<CloudState> {
  const base = normalizeUrl(input.serverUrl)
  const u = checkInput(input.username, input.password)
  if (input.password.length < 8) throw new Error('主密码至少 8 位')
  const info = await serverInfo(base)
  if (!info.allowRegistration) throw new Error('该服务器未开放注册，请联系管理员')

  const kdf = newKdfParams()
  const keys = await deriveKeys(input.password, kdf)
  const vault = newVaultKey()
  const data = await postJson<LoginResponse>(`${base}/api/auth/register`, {
    username: u,
    name: input.name?.trim() ?? '',
    email: input.email?.trim() || null,
    kdf,
    authKey: keys.authKey,
    encryptedVaultKey: wrapVaultKey(vault, keys.wrapKey),
    device: device()
  })
  return saveSession(base, data, vault)
}

function clearSession(): void {
  setSetting(KEY.token, null)
  setSetting(KEY.user, null)
  setSetting(KEY.vaultKey, null)
  syncStatus = { syncing: false, lastSyncAt: null, error: null, pending: 0 }
  emit()
  for (const cb of sessionListeners) cb(false)
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

/** 修改主密码：用新密码重新包裹数据密钥，其他设备需重新登录 */
export async function changePassword(current: string, next: string): Promise<void> {
  const { serverUrl, user } = cloudState()
  const vault = vaultKey()
  if (!user || !vault) throw new Error('该功能需要登录后使用')
  if (next.length < 8) throw new Error('主密码至少 8 位')

  const { kdf } = await postJson<{ kdf: KdfParams }>(`${serverUrl}/api/auth/prelogin`, { username: user.username })
  const currentKeys = await deriveKeys(current, kdf)
  const nextKdf = newKdfParams()
  const nextKeys = await deriveKeys(next, nextKdf)
  await cloudRequest<void>('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({
      currentAuthKey: currentKeys.authKey,
      kdf: nextKdf,
      authKey: nextKeys.authKey,
      encryptedVaultKey: wrapVaultKey(vault, nextKeys.wrapKey)
    })
  })
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
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** 包装仅登录后可用的 IPC 处理函数 */
export function cloudOnly<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
  return async (_e: unknown, ...args: A): Promise<R> => {
    if (!cloudState().loggedIn) throw new Error('该功能需要登录后使用')
    return fn(...args)
  }
}
