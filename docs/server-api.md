# DevVault 服务端接口约定

客户端已实现登录相关调用（`src/main/cloud.ts`），服务端按本文实现即可接入。
所有请求和响应均为 JSON，编码 UTF-8。除登录外，接口均需携带请求头：

```
Authorization: Bearer <token>
```

任意接口返回 **401** 时，客户端会自动清除本地登录状态并提示「登录已过期」。
错误响应建议统一为 `{ "message": "错误说明" }`，客户端会直接展示 `message`。

## 登录

`POST /api/auth/login`

请求：

```json
{ "username": "zhangsan", "password": "******" }
```

成功 `200`：

```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "u_123", "name": "张三", "email": "zhangsan@company.com" }
}
```

- `token`：必填，字符串。客户端使用 Windows DPAPI 加密后保存在本地数据库
- `user.id`：必填；`user.name` 缺省时显示登录账号；`email` 可选

失败：`401 { "message": "账号或密码错误" }`

## 注销

`POST /api/auth/logout`（需 Bearer）

客户端会先清除本地登录状态再尽力调用此接口，失败不影响退出，返回 `204` 即可。

## 后续接口

需要登录的功能（多设备同步、团队共享、云端备份）尚未定义。在客户端接入时：

- 主进程调用 `cloudRequest<T>(path, init)`，自动附带 token 并处理 401
- IPC 处理函数用 `cloudOnly(fn)` 包装，未登录时直接拒绝

> 安全建议：服务端务必使用 HTTPS；token 设置合理有效期；登录接口做频率限制。
