import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

const NOW = `(datetime('now','localtime'))`

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b6cff',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'account',
  title       TEXT NOT NULL,
  env         TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  password    TEXT NOT NULL DEFAULT '',
  verify_code TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  extra       TEXT NOT NULL DEFAULT '[]',
  favorite    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);

CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  priority    INTEGER NOT NULL DEFAULT 1,
  due_date    TEXT NOT NULL DEFAULT '',
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id);
`

// v2：优先级改为 P0~P3（旧：2 高 / 1 中 / 0 低 → P1 / P2 / P3），新增桌面任务条字段
const SCHEMA_V2 = `
ALTER TABLE todos ADD COLUMN pinned  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE todos ADD COLUMN pin_top INTEGER NOT NULL DEFAULT 1;
ALTER TABLE todos ADD COLUMN pin_x   INTEGER;
ALTER TABLE todos ADD COLUMN pin_y   INTEGER;
UPDATE todos SET priority = CASE priority WHEN 2 THEN 1 WHEN 1 THEN 2 ELSE 3 END;
`

// v3：优先级改为用户自定义等级表，todos.priority 存等级 id（原 0~3 对应 P0~P3）
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS priorities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#3b6cff',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);
INSERT INTO priorities (id, label, name, color, sort_order, is_default) VALUES
  (1, 'P0', '紧急', '#e5484d', 0, 0),
  (2, 'P1', '高',   '#f76b15', 1, 0),
  (3, 'P2', '中',   '#3b6cff', 2, 1),
  (4, 'P3', '低',   '#8a919e', 3, 0);
UPDATE todos SET priority = priority + 1;
`

// v4：通用键值设置（锁屏、云端登录等）
const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// v5：待办增强（自定义状态、子任务、开始日期、标签、重复、进展记录）与附件
const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS statuses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8a919e',
  kind       TEXT NOT NULL DEFAULT 'todo',
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO statuses (id, name, color, kind, sort_order) VALUES
  (1, '待开始', '#8a919e', 'todo',   0),
  (2, '进行中', '#3b6cff', 'active', 1),
  (3, '待验证', '#e3a008', 'active', 2),
  (4, '已完成', '#16a37b', 'done',   3);

ALTER TABLE todos ADD COLUMN status_id  INTEGER;
ALTER TABLE todos ADD COLUMN parent_id  INTEGER REFERENCES todos(id) ON DELETE CASCADE;
ALTER TABLE todos ADD COLUMN start_date TEXT NOT NULL DEFAULT '';
ALTER TABLE todos ADD COLUMN tags       TEXT NOT NULL DEFAULT '';
ALTER TABLE todos ADD COLUMN repeat     TEXT NOT NULL DEFAULT '';
UPDATE todos SET status_id = CASE WHEN done = 1 THEN 4 ELSE 1 END;
CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);

CREATE TABLE IF NOT EXISTS todo_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id    INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_comments_todo ON todo_comments(todo_id);

-- 附件文件保存在 userData/attachments 目录，表中只存元数据
CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  todo_id    INTEGER REFERENCES todos(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  stored     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_attach_entry ON attachments(entry_id);
CREATE INDEX IF NOT EXISTS idx_attach_todo ON attachments(todo_id);
`

// v6：TOTP 动态码、账号有效期、待办提醒
const SCHEMA_V6 = `
ALTER TABLE entries ADD COLUMN totp       TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
ALTER TABLE todos   ADD COLUMN remind_at  TEXT NOT NULL DEFAULT '';
ALTER TABLE todos   ADD COLUMN reminded   INTEGER NOT NULL DEFAULT 0;
`

/** 按 user_version 顺序执行迁移，后续版本在数组末尾追加即可 */
const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6]

export function dbPath(): string {
  return join(app.getPath('userData'), 'devvault.db')
}

export function initDb(): Database.Database {
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db!.exec(MIGRATIONS[v])
      db!.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
