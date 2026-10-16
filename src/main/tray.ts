import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import { getStats } from './repo'
import { isLocked, lockNow, lockState, onLockChange } from './lock'
import { getPrefs, setHotkeyOk } from './prefs'
import { assetPath, ensureQuickWindow, setQuitting, showMainWindow, toggleQuickWindow } from './windows'

let tray: Tray | null = null

export function quitApp(): void {
  setQuitting()
  app.quit()
}

/** 按偏好设置（重新）注册全局快速搜索快捷键 */
export function applyHotkey(): void {
  globalShortcut.unregisterAll()
  const { quickEnabled, quickHotkey } = getPrefs()
  let ok = false
  if (quickEnabled) {
    try {
      ok = globalShortcut.register(quickHotkey, toggleQuickWindow)
    } catch {
      ok = false // 快捷键格式无效
    }
    ensureQuickWindow()
  }
  setHotkeyOk(ok)
  updateTrayMenu()
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(assetPath('tray.png')))
  tray.setToolTip('DevVault')
  tray.on('click', () => showMainWindow())
  onLockChange(updateTrayMenu)
  updateTrayMenu()
}

export function updateTrayMenu(): void {
  if (!tray) return
  const prefs = getPrefs()
  const open = getStats().todos
  const { hasPassword } = lockState()
  tray.setToolTip(open ? `DevVault · ${open} 项待办` : 'DevVault')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 DevVault', click: () => showMainWindow() },
      {
        label: prefs.quickEnabled && prefs.quickHotkeyOk ? `快速搜索\t${prefs.quickHotkey}` : '快速搜索',
        click: () => toggleQuickWindow()
      },
      { label: open ? `待办事项（${open}）` : '待办事项', click: () => showMainWindow({ page: 'todos' }) },
      { type: 'separator' },
      { label: '立即锁定', enabled: hasPassword && !isLocked(), click: () => lockNow() },
      { type: 'separator' },
      { label: '退出', click: quitApp }
    ])
  )
}
