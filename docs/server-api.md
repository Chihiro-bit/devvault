# DevVault 服务端接口约定

服务端实现为独立项目 `dev-vault-server`（Kotlin + Ktor + MySQL），客户端实现见 `src/main/cloud.ts`（登录）、`src/main/e2ee.ts`（加密）、`src/main/sync.ts`（同步）。
自行实现兼容的服务端时，按本文实现即可接入。

- 所有请求和响应均为 JSON，编码 UTF-8
- 需要登录的接口携带请求头 `Authorization: Bearer <token>`
- 任意需要登录的接口返回 **401** 时，客户端清除本地登录状态并提示「登录已过期」
- 错误响应统一为 `{ "message": "错误说明" }`，客户端直接展示 `message`

## 端到端加密

服务端**不接触**用户的主密码和任何明文数据。密钥全部在客户端派生：

```
主密码 ──scrypt(N, r, p, salt)──► masterKey (32B)
                                   ├─ HKDF-SHA256(info="devvault/auth/v1") ─► authKey   提交给服务端用于登录
                                   └─ HKDF-SHA256(info="devvault/wrap/v1") ─► wrapKey   只在客户端使用
vaultKey：注册时随机生成的 32 字节数据密钥
encryptedVaultKey = AES-256-GCM(wrapKey, vaultKey, AAD="devvault/vault-key")
payload           = AES-256-GCM(vaultKey, JSON(记录), AAD="devvault/record/<kind>/<id>")
```

- 密文格式：`"v1." + base64(iv[12] ‖ ciphertext ‖ tag[16])`
- 服务端保存 `authKey` 的 PBKDF2 哈希（再加一层，数据库泄露时也不能直接拿来登录），以及原样保存 `encryptedVaultKey`、`kdf` 参数
- `authKey` 与 `wrapKey` 由同一个 masterKey 经不同 HKDF 分支派生，拿到 `authKey` 无法推出 `wrapKey`
- AAD 绑定记录类型和 id，服务端无法把一条记录的密文挪给另一条记录
- 修改主密码只需用新的 wrapKey 重新包裹同一个 vaultKey，已上传的数据不必重新加密
- **忘记主密码无法找回**，服务端也无法解密数据

## 服务器信息

`GET /api/server/info`

```json
{ "name": "DevVault", "version": "1.0.0", "apiVersion": 1, "allowRegistration": true }
```

客户端在登录 / 注册前调用，`apiVersion` 与客户端不一致时提示升级。

## 认证

### 预登录

`POST /api/auth/prelogin` `{ "username": "zhangsan" }`

```json
{ "kdf": { "type": "scrypt", "n": 131072, "r": 8, "p": 1, "salt": "base64..." } }
```

返回该账号注册时使用的密钥派生参数。账号不存在时返回由服务端密钥派生的**稳定的假 salt**，避免借此探测账号是否存在。

### 注册

`POST /api/auth/register`

```json
{
  "username": "zhangsan",
  "name": "张三",
  "email": null,
  "kdf": { "type": "scrypt", "n": 131072, "r": 8, "p": 1, "salt": "base64(16B)" },
  "authKey": "base64(32B)",
  "encryptedVaultKey": "v1....",
  "device": "DevVault · DESKTOP-XXX"
}
```

- `username`：3~64 位字母、数字或 `_ . @ -`，不区分大小写
- `kdf`：仅支持 scrypt，N 为 2^14 ~ 2^20 的 2 的幂，r ≤ 32，p ≤ 16
- 成功返回与登录相同的结构；账号已存在 `409`；服务器关闭注册 `403`

### 登录

`POST /api/auth/login` `{ "username": "zhangsan", "authKey": "base64(32B)", "device": "..." }`

```json
{
  "token": "随机令牌",
  "user": { "id": "1", "name": "张三", "username": "zhangsan", "email": null },
  "kdf": { "type": "scrypt", "n": 131072, "r": 8, "p": 1, "salt": "..." },
  "encryptedVaultKey": "v1...."
}
```

- 失败：`401 { "message": "账号或密码错误" }`
- 同一「账号 + IP」15 分钟内连续失败 5 次后返回 `429`
- 令牌默认 30 天有效，期间有访问自动续期；服务端只保存令牌的 SHA-256

### 当前用户 / 注销 / 修改主密码（需 Bearer）

- `GET /api/auth/me` → `user`
- `POST /api/auth/logout` → `204`，令牌立即失效。客户端先清除本地状态再尽力调用，失败不影响退出
- `POST /api/auth/password` → `204`

  ```json
  { "currentAuthKey": "...", "kdf": { ...新参数 }, "authKey": "...", "encryptedVaultKey": "v1...." }
  ```

  `currentAuthKey` 错误返回 `403`。成功后该账号其他设备上的登录全部失效，当前令牌保留。

## 同步（需 Bearer）

服务端是一个按用户隔离、带版本号的**密文记录仓库**，不理解记录内容：

- 每条记录由 `(kind, id)` 唯一标识。`kind` 为小写类型名（客户端目前使用 `priority` `status` `project` `entry` `todo` `comment`），`id` 为客户端生成的随机字符串（`[A-Za-z0-9_-]{1,64}`）
- 每个用户有一个单调递增的版本号，每写入一条记录就分配一个新的版本号给它
- 删除以墓碑形式保留（`deleted: true`，`payload: null`），以便其他设备得知
- `modifiedAt` 为客户端修改时间（毫秒），服务端只保存不解释，供客户端解决冲突

### 拉取

`GET /api/sync/pull?since=<版本号>&limit=500`

```json
{
  "items": [
    { "kind": "todo", "id": "3f1c...", "revision": 11, "deleted": false, "modifiedAt": 1792207674139, "payload": "v1...." },
    { "kind": "todo", "id": "6617...", "revision": 12, "deleted": true,  "modifiedAt": 1792207675000, "payload": null }
  ],
  "revision": 12,
  "hasMore": false
}
```

返回版本号大于 `since` 的记录，按版本号升序。`hasMore` 为 true 时以返回的 `revision` 作为 `since` 继续拉取；客户端全部拉取完成后保存 `revision` 作为下次的游标。`limit` 最大 1000。

### 推送

`POST /api/sync/push`

```json
{
  "changes": [
    { "kind": "todo", "id": "3f1c...", "baseRevision": 11, "deleted": false, "modifiedAt": 1792207680000, "payload": "v1...." },
    { "kind": "entry", "id": "9a2b...", "baseRevision": 0, "deleted": false, "modifiedAt": 1792207680001, "payload": "v1...." },
    { "kind": "todo", "id": "6617...", "baseRevision": 12, "deleted": true, "modifiedAt": 1792207680002 }
  ]
}
```

```json
{
  "accepted":  [{ "kind": "todo", "id": "3f1c...", "revision": 13 }, { "kind": "entry", "id": "9a2b...", "revision": 14 }],
  "conflicts": [{ "kind": "todo", "id": "6617...", "revision": 15 }],
  "revision": 14
}
```

- 乐观并发：`baseRevision` 等于服务端该记录的当前版本号（新记录为 0）才会写入，否则列入 `conflicts`（`revision` 为服务端当前版本号，记录不存在时为 0）
- 单次最多 500 条，单条 `payload` 不超过 512 KB
- 同一用户的推送在服务端串行执行

### 客户端合并规则

一轮同步 = 拉取 → 合并 → 推送；推送出现冲突时重新拉取再推送，最多 3 轮。

| 本机状态 | 云端为修改 | 云端为删除 |
| --- | --- | --- |
| 无改动 | 采用云端 | 删除本机记录 |
| 有未上传的修改 | 修改时间较晚的一方胜出 | 删除（删除优先） |
| 已在本机删除 | 保留删除，推送覆盖云端 | 两边都已删除 |

本机修改由 SQLite 触发器记录（`src/main/db.ts` v7），只有需要同步的列变化才会标记；桌面任务条位置、提醒是否已发送等属于本机状态，不同步。附件暂不同步。

切换到另一个账号或服务器登录时，本机全部数据会作为新记录上传并与该账号的云端数据合并。

## 新增接口

需要登录的新功能在客户端接入时：

- 主进程调用 `cloudRequest<T>(path, init)`，自动附带 token 并处理 401
- IPC 处理函数用 `cloudOnly(fn)` 包装，未登录时直接拒绝

> 部署建议：对外提供服务时务必使用 HTTPS；服务端已对登录做频率限制，多实例部署时可在网关层另行限流。
