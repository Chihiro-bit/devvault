import { safeStorage } from 'electron'

const PREFIX = 'enc:'

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** 使用系统级加密（Windows DPAPI / macOS Keychain）保护敏感字段 */
export function encrypt(plain: string): string {
  if (!plain) return ''
  if (!encryptionAvailable()) return plain
  return PREFIX + safeStorage.encryptString(plain).toString('base64')
}

export function decrypt(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!stored.startsWith(PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}
