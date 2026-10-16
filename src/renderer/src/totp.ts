/**
 * TOTP（RFC 6238）动态码。支持直接粘贴 base32 密钥或 otpauth://totp/... 链接。
 */
import { useEffect, useMemo, useState } from 'react'

export interface TotpConfig {
  secret: Uint8Array<ArrayBuffer>
  digits: number
  period: number
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512'
  issuer?: string
  account?: string
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Uint8Array<ArrayBuffer> | null {
  const s = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (!s || /[^A-Z2-7]/.test(s)) return null
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function parseTotp(input: string): TotpConfig | null {
  const s = input.trim()
  if (!s) return null
  let secret = s
  let digits = 6
  let period = 30
  let algorithm: TotpConfig['algorithm'] = 'SHA-1'
  let issuer: string | undefined
  let account: string | undefined

  if (/^otpauth:/i.test(s)) {
    let u: URL
    try {
      u = new URL(s)
    } catch {
      return null
    }
    if (u.hostname.toLowerCase() !== 'totp') return null
    secret = u.searchParams.get('secret') ?? ''
    digits = Number(u.searchParams.get('digits')) || 6
    period = Number(u.searchParams.get('period')) || 30
    const alg = (u.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
    algorithm = alg === 'SHA256' ? 'SHA-256' : alg === 'SHA512' ? 'SHA-512' : 'SHA-1'
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    const [a, b] = label.includes(':') ? label.split(':') : [undefined, label]
    issuer = u.searchParams.get('issuer') ?? a
    account = b || undefined
  }

  const bytes = base32Decode(secret)
  if (!bytes || bytes.length < 5 || digits < 6 || digits > 8 || period < 5) return null
  return { secret: bytes, digits, period, algorithm, issuer, account }
}

export async function totpCode(cfg: TotpConfig, now = Date.now()): Promise<string> {
  const counter = Math.floor(now / 1000 / cfg.period)
  const msg = new ArrayBuffer(8)
  const view = new DataView(msg)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  const key = await crypto.subtle.importKey('raw', cfg.secret, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = sig[sig.length - 1] & 0x0f
  const bin = ((sig[o] & 0x7f) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0')
}

/** 本周期剩余秒数 */
export const totpRemaining = (cfg: TotpConfig, now = Date.now()) => cfg.period - (Math.floor(now / 1000) % cfg.period)

/** 每秒刷新的动态码；secret 无效时 code 为空 */
export function useTotp(secret: string): { code: string; remaining: number; period: number; valid: boolean } {
  const cfg = useMemo(() => parseTotp(secret), [secret])
  const [state, setState] = useState({ code: '', remaining: 0 })

  useEffect(() => {
    if (!cfg) {
      setState({ code: '', remaining: 0 })
      return
    }
    let alive = true
    let lastCounter = -1
    const update = async () => {
      const now = Date.now()
      const counter = Math.floor(now / 1000 / cfg.period)
      const remaining = totpRemaining(cfg, now)
      if (counter !== lastCounter) {
        lastCounter = counter
        const code = await totpCode(cfg, now)
        if (alive) setState({ code, remaining })
      } else if (alive) setState((s) => ({ ...s, remaining }))
    }
    update()
    const t = setInterval(update, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [cfg])

  return { ...state, period: cfg?.period ?? 30, valid: !!cfg }
}

/** 123456 → 123 456，便于阅读 */
export const formatCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code)
