import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import type { LockState, UnlockResult } from '../shared/types'
import { getSetting, setSetting } from './settings'
import { broadcast } from './windows'

const KEY = {
  enabled: 'lock.enabled',
  idle: 'lock.idleSeconds',
  hash: 'lock.passwordHash'
}

export const IDLE_MIN = 10
export const IDLE_MAX = 86400
const DEFAULT_IDLE = 300
const MAX_FAILURES = 5
const BLOCK_SECONDS = 30

let locked = false
let lastActivity = Date.now()
let failures = 0
let blockedUntil = 0

// ---------- 密码 ----------

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPassword(password: string): boolean {
  const stored = getSetting(KEY.hash)
  if (!stored) return false
  const [, saltB64, hashB64] = stored.split('$')
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

const hasPassword = () => !!getSetting(KEY.hash)

// ---------- 状态 ----------

export function lockState(): LockState {
  const idle = Number(getSetting(KEY.idle))
  return {
    enabled: getSetting(KEY.enabled) === '1' && hasPassword(),
    idleSeconds: Number.isFinite(idle) && idle >= IDLE_MIN ? idle : DEFAULT_IDLE,
    hasPassword: hasPassword(),
    locked
  }
}

export const isLocked = () => locked

const listeners = new Set<() => void>()

/** 主进程内订阅锁定状态变化（如托盘菜单） */
export function onLockChange(cb: () => void): void {
  listeners.add(cb)
}

function emit(): void {
  broadcast('lock:changed', lockState())
  listeners.forEach((cb) => cb())
}

/** 启动时若已开启自动锁定则直接进入锁定状态，并开始计时 */
export function initLock(): void {
  if (lockState().enabled) locked = true
  setInterval(() => {
    const s = lockState()
    if (!locked && s.enabled && Date.now() - lastActivity >= s.idleSeconds * 1000) lockNow()
  }, 1000)
}

export function reportActivity(): void {
  lastActivity = Date.now()
}

export function lockNow(): void {
  if (!hasPassword()) throw new Error('请先在设置中设置锁屏密码')
  if (locked) return
  locked = true
  emit()
}

export function unlock(password: string): UnlockResult {
  const now = Date.now()
  if (now < blockedUntil) {
    return { ok: false, retryAfter: Math.ceil((blockedUntil - now) / 1000), message: '尝试次数过多，请稍后再试' }
  }
  if (verifyPassword(password)) {
    locked = false
    failures = 0
    lastActivity = now
    emit()
    return { ok: true }
  }
  failures++
  if (failures >= MAX_FAILURES) {
    failures = 0
    blockedUntil = now + BLOCK_SECONDS * 1000
    return { ok: false, retryAfter: BLOCK_SECONDS, message: `密码错误次数过多，请 ${BLOCK_SECONDS} 秒后再试` }
  }
  return { ok: false, message: `密码错误，还可尝试 ${MAX_FAILURES - failures} 次` }
}

// ---------- 配置 ----------

/**
 * 设置 / 修改 / 移除锁屏密码。已有密码时必须提供正确的当前密码；
 * next 为 null 表示移除密码（同时关闭自动锁定）。
 */
export function setLockPassword(current: string | null, next: string | null): LockState {
  if (hasPassword() && !verifyPassword(current ?? '')) throw new Error('当前密码不正确')
  if (next === null) {
    setSetting(KEY.hash, null)
    setSetting(KEY.enabled, null)
  } else {
    if (next.length < 4) throw new Error('锁屏密码至少 4 位')
    setSetting(KEY.hash, hashPassword(next))
  }
  emit()
  return lockState()
}

export function configureLock(opts: { enabled: boolean; idleSeconds: number }): LockState {
  if (opts.enabled && !hasPassword()) throw new Error('请先设置锁屏密码')
  const idle = Math.round(Math.min(IDLE_MAX, Math.max(IDLE_MIN, Number(opts.idleSeconds) || DEFAULT_IDLE)))
  setSetting(KEY.enabled, opts.enabled ? '1' : '0')
  setSetting(KEY.idle, String(idle))
  lastActivity = Date.now()
  emit()
  return lockState()
}
