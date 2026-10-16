import { app } from 'electron'
import type { AppPrefs } from '../shared/types'
import { getSetting, setSetting } from './settings'

type Stored = Omit<AppPrefs, 'quickHotkeyOk' | 'openAtLogin' | 'canAutoLaunch'>

const DEFAULTS: Stored = {
  quickEnabled: true,
  quickHotkey: 'Ctrl+Alt+Space',
  closeToTray: true,
  notifyEnabled: true,
  digestTime: '09:30',
  expiryDays: 7
}

let hotkeyOk = false

export function setHotkeyOk(ok: boolean): void {
  hotkeyOk = ok
}

function read<K extends keyof Stored>(key: K): Stored[K] {
  const raw = getSetting(`pref.${key}`)
  if (raw === null) return DEFAULTS[key]
  try {
    const v = JSON.parse(raw)
    return typeof v === typeof DEFAULTS[key] ? v : DEFAULTS[key]
  } catch {
    return DEFAULTS[key]
  }
}

export function getPrefs(): AppPrefs {
  const stored = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, read(k as keyof Stored)])) as Stored
  return {
    ...stored,
    quickHotkeyOk: hotkeyOk,
    openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canAutoLaunch: app.isPackaged
  }
}

export function setPrefs(patch: Partial<AppPrefs>): AppPrefs {
  if (patch.digestTime !== undefined && !/^\d{2}:\d{2}$/.test(patch.digestTime)) throw new Error('提醒时间格式不正确')
  if (patch.expiryDays !== undefined && !(patch.expiryDays >= 1 && patch.expiryDays <= 90))
    throw new Error('提前提醒天数需在 1~90 之间')
  if (patch.quickHotkey !== undefined && !patch.quickHotkey.trim()) throw new Error('快捷键不能为空')

  for (const key of Object.keys(DEFAULTS) as (keyof Stored)[]) {
    if (patch[key] !== undefined) setSetting(`pref.${key}`, JSON.stringify(patch[key]))
  }
  // 开机自启仅在安装版中设置，避免开发时把 electron.exe 注册为启动项
  if (patch.openAtLogin !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch.openAtLogin })
  return getPrefs()
}
