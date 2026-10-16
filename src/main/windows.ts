import { app, BrowserWindow, Notification, screen, shell } from 'electron'
import { join } from 'path'
import * as repo from './repo'
import { getPrefs } from './prefs'
import type { NavTarget } from '../shared/types'

const preload = join(__dirname, '../preload/index.js')
const devUrl = process.env['ELECTRON_RENDERER_URL']

/** 图标等静态资源：安装版在 resources/assets，开发时在项目 resources/ */
export const assetPath = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, 'assets', name) : join(__dirname, '../../resources', name)

function loadPage(win: BrowserWindow, page: 'index' | 'widget' | 'quick', query: Record<string, string> = {}) {
  if (devUrl) {
    const qs = new URLSearchParams(query).toString()
    win.loadURL(`${devUrl}/${page}.html${qs ? '?' + qs : ''}`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}.html`), { query })
  }
}

// ---------- 主窗口 ----------

let mainWin: BrowserWindow | null = null
let quitting = false
let trayHintShown = false

export type Page = NavTarget['page']

/** 由托盘「退出」等真正退出时调用，之后关闭主窗口不再隐藏到托盘 */
export function setQuitting(): void {
  quitting = true
}

/** 显示主窗口（不存在则创建），可指定跳转目标 */
export function showMainWindow(target?: NavTarget | Page): void {
  const nav = typeof target === 'string' ? { page: target } : target
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    if (nav) mainWin.webContents.send('app:navigate', nav)
    return
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'DevVault',
    icon: assetPath('icon.png'),
    backgroundColor: '#f5f6f8',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  mainWin = win

  win.once('ready-to-show', () => win.show())
  if (nav) win.webContents.once('did-finish-load', () => win.webContents.send('app:navigate', nav))

  // 关闭时默认隐藏到托盘，继续接收提醒、响应快速搜索
  win.on('close', (e) => {
    if (quitting || !getPrefs().closeToTray) return
    e.preventDefault()
    win.hide()
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true
      new Notification({
        title: 'DevVault 仍在后台运行',
        body: '可从任务栏托盘图标重新打开；如需退出，请右键托盘图标选择「退出」。',
        icon: assetPath('icon.png')
      }).show()
    }
  })
  win.on('closed', () => {
    mainWin = null
    // 未开启「关闭到托盘」时，关闭主窗口即退出应用
    if (!quitting && !getPrefs().closeToTray) app.quit()
  })

  // 外部链接一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  loadPage(win, 'index')
}

// ---------- 快速搜索窗口 ----------

const QUICK_W = 680
const QUICK_MAX_H = 520
let quickWin: BrowserWindow | null = null

/** 预先创建隐藏的快速搜索窗口，按下快捷键时可立即弹出 */
export function ensureQuickWindow(): BrowserWindow {
  if (quickWin && !quickWin.isDestroyed()) return quickWin
  const win = new BrowserWindow({
    width: QUICK_W,
    height: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'DevVault 快速搜索',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  quickWin = win
  win.on('blur', () => win.hide())
  win.on('closed', () => {
    quickWin = null
  })
  loadPage(win, 'quick')
  return win
}

export function toggleQuickWindow(): void {
  const win = ensureQuickWindow()
  if (win.isVisible()) return hideQuickWindow()
  // 出现在鼠标所在屏幕的上方三分之一处
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  win.setPosition(Math.round(area.x + (area.width - QUICK_W) / 2), Math.round(area.y + area.height * 0.16))
  win.show()
  win.focus()
  win.webContents.send('quick:shown')
}

export function hideQuickWindow(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) quickWin.hide()
}

export function resizeQuickWindow(height: number): void {
  if (!quickWin || quickWin.isDestroyed()) return
  const h = Math.round(Math.min(QUICK_MAX_H, Math.max(80, height)))
  const [x, y] = quickWin.getPosition()
  quickWin.setBounds({ x, y, width: QUICK_W, height: h })
}

// ---------- 桌面任务条 ----------

/** 窗口尺寸包含四周 10px 透明边距，用于绘制阴影 */
const WIDGET_W = 360
const WIDGET_H = 84
const WIDGET_MIN_W = 300
const WIDGET_MAX_W = 540
const widgets = new Map<number, BrowserWindow>()

function onSomeScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return x >= a.x - WIDGET_W / 2 && x <= a.x + a.width - WIDGET_W / 2 && y >= a.y - 10 && y <= a.y + a.height - 40
  })
}

/** 新任务条默认排在主屏右上角，依次向下 */
function nextDefaultPos(): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea
  const x = a.x + a.width - WIDGET_W - 12
  const taken = new Set([...widgets.values()].map((w) => w.getPosition()[1]))
  let y = a.y + 12
  while (taken.has(y) && y < a.y + a.height - WIDGET_H) y += WIDGET_H - 16
  return { x, y }
}

function openWidget(pin: repo.PinState): void {
  let { pin_x: x, pin_y: y } = pin
  if (x == null || y == null || !onSomeScreen(x, y)) {
    ;({ x, y } = nextDefaultPos())
    repo.setPinPos(pin.id, x, y)
  }

  const win = new BrowserWindow({
    x,
    y,
    width: WIDGET_W,
    height: WIDGET_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: pin.pin_top,
    show: false,
    title: 'DevVault 任务条',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  widgets.set(pin.id, win)

  win.once('ready-to-show', () => win.showInactive())
  win.on('moved', () => {
    const [nx, ny] = win.getPosition()
    repo.setPinPos(pin.id, nx, ny)
  })
  win.on('closed', () => widgets.delete(pin.id))

  loadPage(win, 'widget', { id: String(pin.id) })
}

/** 任务条按内容自适应宽度；贴近屏幕右缘时保持右边缘不动 */
export function resizeWidget(win: BrowserWindow, width: number): void {
  const w = Math.round(Math.min(WIDGET_MAX_W, Math.max(WIDGET_MIN_W, width)))
  const { x, y, width: oldW } = win.getBounds()
  if (w === oldW) return
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const anchorRight = x + oldW >= area.x + area.width - 60
  win.setBounds({ x: anchorRight ? x + oldW - w : x, y, width: w, height: WIDGET_H })
}

/** 让桌面任务条与数据库中的钉选状态保持一致：多关少开、同步置顶 */
export function syncWidgets(): void {
  const pinned = new Map(repo.listPinned().map((p) => [p.id, p]))
  for (const [id, win] of widgets) {
    if (!pinned.has(id)) win.close()
  }
  for (const [id, pin] of pinned) {
    const win = widgets.get(id)
    if (!win) openWidget(pin)
    else if (win.isAlwaysOnTop() !== pin.pin_top) win.setAlwaysOnTop(pin.pin_top)
  }
}

/** 通知所有窗口数据有变动 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}
