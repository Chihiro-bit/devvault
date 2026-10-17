/**
 * 端到端加密：账号密码和待办在本机加密后才上传，服务端只保存密文。
 *
 *   主密码 ──scrypt(salt)──► masterKey ─┬─HKDF("auth")─► authKey   发给服务端用于登录（服务端再哈希保存）
 *                                       └─HKDF("wrap")─► wrapKey   在本机包裹 / 解开数据密钥
 *   vaultKey：注册时随机生成的 256 位数据密钥，用 wrapKey 加密后存放在服务端，
 *             每条同步记录用 vaultKey 做 AES-256-GCM 加密，AAD 绑定记录类型与 id，防止密文被挪用到其他记录。
 *
 * 修改主密码只需重新包裹 vaultKey，已上传的数据不必重新加密。
 * 服务端无法解密数据，也无法帮用户找回主密码。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from 'crypto'

export interface KdfParams {
  type: 'scrypt'
  n: number
  r: number
  p: number
  /** base64 */
  salt: string
}

/** N=2^17、r=8 约需 128MB 内存，在普通电脑上耗时 0.3~1 秒 */
export function newKdfParams(): KdfParams {
  return { type: 'scrypt', n: 1 << 17, r: 8, p: 1, salt: randomBytes(16).toString('base64') }
}

export interface DerivedKeys {
  /** base64，提交给服务端 */
  authKey: string
  wrapKey: Buffer
}

const VERSION = 'v1.'
const VAULT_KEY_AAD = 'devvault/vault-key'

export async function deriveKeys(password: string, kdf: KdfParams): Promise<DerivedKeys> {
  if (kdf.type !== 'scrypt') throw new Error(`不支持的密钥派生算法：${kdf.type}`)
  // 服务端可调整参数，但客户端仍设上限，防止被恶意服务器用超大参数拖垮
  if (kdf.n > 1 << 20 || kdf.r > 32 || kdf.p > 16) throw new Error('服务器返回的密钥参数异常')
  const master = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      Buffer.from(kdf.salt, 'base64'),
      32,
      { N: kdf.n, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.n * kdf.r + 32 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  )
  const hkdf = (info: string) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
  const keys = { authKey: hkdf('devvault/auth/v1').toString('base64'), wrapKey: hkdf('devvault/wrap/v1') }
  master.fill(0)
  return keys
}

function seal(key: Buffer, plain: Buffer, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return VERSION + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  if (!sealed.startsWith(VERSION)) throw new Error('不支持的密文版本')
  const raw = Buffer.from(sealed.slice(VERSION.length), 'base64')
  if (raw.length < 28) throw new Error('密文已损坏')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()])
}

export const newVaultKey = (): Buffer => randomBytes(32)

export const wrapVaultKey = (vaultKey: Buffer, wrapKey: Buffer): string => seal(wrapKey, vaultKey, VAULT_KEY_AAD)

export function unwrapVaultKey(wrapped: string, wrapKey: Buffer): Buffer {
  try {
    const key = open(wrapKey, wrapped, VAULT_KEY_AAD)
    if (key.length !== 32) throw new Error()
    return key
  } catch {
    throw new Error('无法解开数据密钥，请确认密码正确')
  }
}

const recordAad = (kind: string, id: string) => `devvault/record/${kind}/${id}`

export function encryptRecord(vaultKey: Buffer, kind: string, id: string, data: unknown): string {
  return seal(vaultKey, Buffer.from(JSON.stringify(data), 'utf-8'), recordAad(kind, id))
}

export function decryptRecord<T>(vaultKey: Buffer, kind: string, id: string, payload: string): T {
  return JSON.parse(open(vaultKey, payload, recordAad(kind, id)).toString('utf-8')) as T
}
