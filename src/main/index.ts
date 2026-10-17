import { app } from 'electron'
import { closeDb, initDb } from './db'
import { registerIpc } from './ipc'
import { globalShortcut } from 'electron'
import { setQuitting, showMainWindow, syncWidgets } from './windows'
import { applyHotkey, createTray } from './tray'
import { startReminders } from './reminders'
import { initLock } from './lock'
import { gcAttachments } from './attachments'
import { initSync } from './sync'

// 日期选择器等原生控件使用中文格式
app.commandLine.appendSwitch('lang', 'zh-CN')
// Windows 通知需要 AppUserModelID 才能正确显示应用名称
app.setAppUserModelId('com.devvault.app')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    initDb()
    initLock()
    registerIpc()
    showMainWindow()
    syncWidgets()
    createTray()
    applyHotkey()
    startReminders()
    initSync()
    gcAttachments().catch(() => undefined)
    app.on('activate', () => showMainWindow())
  })

  // 应用常驻托盘：所有窗口关闭也不退出，需通过托盘菜单「退出」
  app.on('window-all-closed', () => undefined)
  app.on('before-quit', () => setQuitting())

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    closeDb()
  })
}
