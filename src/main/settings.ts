import { getDb } from './db'

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** value 为 null 时删除该项 */
export function setSetting(key: string, value: string | null): void {
  if (value === null) getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key)
  else
    getDb()
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value)
}
