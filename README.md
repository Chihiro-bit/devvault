# DevVault

日常开发助手：集中管理**测试账号 / 固定验证码**、**Git / VPN / 服务器 / 数据库**等凭据，以及**待办事项**，并按项目分类与搜索。

技术栈：Electron 33 + React 19 + TypeScript + SQLite（better-sqlite3），使用 electron-vite 构建。

## 功能

- **项目分组**：侧边栏切换「全部项目 / 未分组 / 具体项目」，账号与待办都按项目归类；删除项目时数据自动移入「未分组」
- **账号凭据**：测试账号、Git、VPN、服务器、数据库、其他六种类型，不同类型字段标签不同
  - 字段：地址、账号、密码、固定验证码、环境（开发/测试/预发/生产）、标签、备注
  - 自定义附加字段（如支付密码、SSH 地址、协议），可标记为敏感字段
  - 点击任意值即复制；敏感内容复制后 30 秒自动清空剪贴板
  - 收藏置顶、复制为新记录、一键复制全部信息（方便发给同事）
  - TOTP 动态码：粘贴 base32 密钥或 otpauth:// 链接，卡片上实时显示 6 位动态码和倒计时
  - 有效期：可设置到期日，卡片显示「N 天后过期 / 已过期」，并有「即将过期」筛选
  - 附件：VPN 客户端、证书、配置文件等可直接存进记录（拖拽或选择文件），支持打开、另存为、在文件夹中显示；可按文件名搜索
- **待办事项**（独立页面）
  - 列表 / 看板 / 日历三种视图；列表可按状态、优先级、项目分组并折叠，看板拖拽改状态，日历拖拽改截止日期
  - 自定义状态（如 待开始 → 进行中 → 提测 → 已完成），每个状态归属「未开始 / 进行中 / 已完成」分类
  - 自定义优先级（默认 P0~P3）：标签、说明、颜色、顺序、默认等级
  - 详情侧栏：描述、开始/截止日期、标签、子任务（带进度）、附件、进展记录（时间线）
  - 提醒：可为任务设置提醒时间，到点弹出 Windows 通知，点击直接打开该任务
  - 重复任务：每天 / 工作日 / 每周 / 每月，完成后自动生成下一次（子任务清单一并复制）
  - 顶部统计卡片快速筛选：进行中、最高优先级、今天到期、已逾期、已完成
- **桌面任务条**：待办点「到桌面」即可钉到桌面，任务条可随意拖动并记住位置，宽度随内容自适应
  - 任务条上可直接完成（带完成动画）、切换始终置顶、跳回主窗口、从桌面移除
  - 关闭主窗口后任务条依然保留；下次启动自动恢复；在主窗口中的修改实时同步到任务条
- **全局快速搜索**：在任何程序中按 `Ctrl + Alt + Space`（可在设置中修改）唤出搜索框；`↵` 复制密码、`Shift ↵` 复制账号、`Alt ↵` 复制验证码/动态码、`Ctrl ↵` 打开地址；应用锁定时可在搜索框内直接解锁
- **托盘与通知**：关闭窗口后驻留托盘（可关闭此行为）；每日定时推送摘要（今天到期 / 已逾期的待办、即将过期的账号）；安装版支持开机自启
- **自动锁定**（可选）：在「设置 → 安全」设置锁屏密码后开启，在本应用中无操作超过设定秒数即锁定，启动时同样需要解锁；`Ctrl + L` 立即锁定
  - 锁定时主界面整体卸载，主进程同时拒绝除锁屏、桌面任务条外的所有数据接口；连续输错 5 次需等待 30 秒
  - 锁屏密码以 scrypt 哈希保存，**无法找回**
- **账号与云端**：「设置 → 账号与云端」可登录服务端（服务端尚在规划，接口约定见 [docs/server-api.md](docs/server-api.md)）；不登录时所有本地功能照常可用，需服务端的功能登录后才可用
- **搜索**：名称、账号、地址、验证码、备注、标签、附加字段、项目名；空格分隔多个关键词
- **安全**：密码和敏感附加字段使用 Electron `safeStorage`（Windows DPAPI）加密后写入 SQLite
- **备份**：导出为文件夹（`data.json` + `attachments/`，密码为明文，注意保管）；导入时选择其中的 `data.json`，为追加合并，同名项目/状态/优先级自动复用；兼容旧版单个 JSON 备份

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl + F` | 聚焦搜索框 |
| `Ctrl + L` | 立即锁定（需已设置锁屏密码） |
| `Ctrl + Alt + Space` | 全局快速搜索（可自定义） |
| `Ctrl + N` | 新建记录 / 聚焦待办输入框 |
| `Ctrl + S` / `Ctrl + Enter` | 弹窗中保存 |
| `Esc` | 关闭弹窗 / 清空搜索 |
| 双击卡片 | 编辑 |

## 开发

```bash
npm install
npm run dev        # 开发模式（热更新）
npm run typecheck  # 类型检查
npm run build      # 构建到 out/
npm start          # 运行构建产物
npm run dist       # 打包 Windows 安装包到 release/
```

### 原生模块说明

`.npmrc` 指定了 `runtime=electron`、`target=33.4.11`，使 `better-sqlite3` 安装时直接下载 Electron 33 的预编译二进制，**无需安装 Visual Studio C++ 工具链**。升级 Electron 版本时请同步修改 `.npmrc` 中的 `target`。

npm 11 会提示这几项为 "Unknown project config"，可忽略（prebuild-install 通过环境变量读取它们）。

如遇 Electron 下载后解压不完整（`node_modules/electron/dist` 下只有 `LICENSES.chromium.html`，新版 Node 与 extract-zip 的兼容问题），手动解压缓存即可：

```powershell
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v33.4.11-win32-x64.zip" | Select-Object -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Set-Content node_modules\electron\path.txt "electron.exe" -NoNewline
```

## 数据位置

数据库文件：`%APPDATA%\DevVault\devvault.db`，附件保存在同目录的 `attachments\` 下（原文件名，未加密）（完整路径见「设置 → 数据」）。

由于密码通过 Windows 当前用户凭据加密，**直接拷贝数据库文件到其他电脑/用户后密码无法解密**；迁移请使用「导出 / 导入」。

## 目录结构

```
src/
  main/        主进程：窗口、SQLite（db.ts 迁移 / repo.ts 数据访问）、IPC、加密
  preload/     通过 contextBridge 暴露类型安全的 window.api
  shared/      主进程与渲染进程共享的类型
  renderer/    React 界面（components/、styles.css）
```
