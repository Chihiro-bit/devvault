import { Notification } from 'electron'
import type { NavTarget } from '../shared/types'
import * as repo from './repo'
import { isLocked } from './lock'
import { getPrefs } from './prefs'
import { getSetting, setSetting } from './settings'
import { assetPath, showMainWindow } from './windows'

const TICK_MS = 30_000
/** 持有通知引用，避免被回收后点击事件失效 */
const alive = new Set<Notification>()

function notify(title: string, body: string, target: NavTarget): void {
  const n = new Notification({ title, body, icon: assetPath('icon.png') })
  alive.add(n)
  n.on('click', () => {
    showMainWindow(target)
    alive.delete(n)
  })
  n.on('close', () => alive.delete(n))
  n.show()
}

const pad = (n: number) => String(n).padStart(2, '0')

function nowParts(d = new Date()) {
  const date = d.toLocaleDateString('sv')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return { date, hm, stamp: `${date}T${hm}` }
}

/** 截取前几项标题，避免通知过长 */
function brief(titles: string[], max = 3): string {
  const head = titles.slice(0, max).map((t) => `「${t}」`).join('、')
  return titles.length > max ? `${head} 等 ${titles.length} 项` : head
}

export function tick(now = new Date()): void {
  const prefs = getPrefs()
  if (!prefs.notifyEnabled || !Notification.isSupported()) return
  const { date, hm, stamp } = nowParts(now)

  // 单条待办提醒
  for (const r of repo.dueReminders(stamp)) {
    repo.markReminded(r.id)
    notify('待办提醒', r.due_date ? `${r.title}（截止 ${r.due_date}）` : r.title, { page: 'todos', todoId: r.id })
  }

  // 每日摘要：每天到点后发送一次（错过时间则在启动后补发）
  if (hm < prefs.digestTime || getSetting('remind.lastDigest') === date) return
  setSetting('remind.lastDigest', date)
  const d = repo.digest(date, prefs.expiryDays)

  if (d.dueToday.length || d.overdue) {
    const parts: string[] = []
    if (d.dueToday.length) parts.push(`今天到期 ${d.dueToday.length} 项：${brief(d.dueToday.map((t) => t.title))}`)
    if (d.overdue) parts.push(`已逾期 ${d.overdue} 项`)
    notify('今日待办', parts.join('\n'), { page: 'todos' })
  }

  if (d.expiring.length) {
    const expired = d.expiring.filter((e) => e.expires_at < date).length
    const soon = d.expiring.length - expired
    const summary = [soon && `${soon} 个账号将在 ${prefs.expiryDays} 天内过期`, expired && `${expired} 个已过期`]
      .filter(Boolean)
      .join('，')
    // 锁定状态下不在通知中显示账号名称
    const body = isLocked() ? summary : `${summary}：${brief(d.expiring.map((e) => e.title))}`
    notify('账号即将过期', body, { page: 'entries', entryFilter: 'expiring' })
  }
}

export function startReminders(): void {
  setTimeout(() => tick(), 5000)
  setInterval(() => tick(), TICK_MS)
}
