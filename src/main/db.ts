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

/**
 * 参与云同步的表及其同步类型、需要同步的列。
 * 只有这些列的修改会标记为待同步；桌面任务条位置、提醒是否已发送等属于本机状态，不同步。
 * 附件文件体积较大，暂不同步。
 */
export const SYNC_TABLES = [
  { table: 'priorities', kind: 'priority', cols: ['label', 'name', 'color', 'sort_order', 'is_default'] },
  { table: 'statuses', kind: 'status', cols: ['name', 'color', 'kind', 'sort_order'] },
  { table: 'projects', kind: 'project', cols: ['name', 'color', 'description', 'sort_order'] },
  {
    table: 'entries',
    kind: 'entry',
    cols: ['project_id', 'category', 'title', 'env', 'url', 'username', 'password', 'verify_code', 'totp', 'expires_at',
      'notes', 'tags', 'extra', 'favorite']
  },
  {
    table: 'todos',
    kind: 'todo',
    cols: ['project_id', 'parent_id', 'title', 'notes', 'priority', 'status_id', 'done', 'done_at', 'start_date',
      'due_date', 'remind_at', 'tags', 'repeat']
  },
  { table: 'todo_comments', kind: 'comment', cols: ['content'] }
] as const

export type SyncKind = (typeof SYNC_TABLES)[number]['kind']

/** 当前时间（毫秒时间戳） */
export const NOW_MS = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

/** sync_apply 表中有行时表示正在写入云端拉取的数据，此时触发器不再标记待同步 */
const NOT_APPLYING = `NOT EXISTS (SELECT 1 FROM sync_apply)`

// v7：云同步。每条记录分配全局唯一的 uid，用触发器记录本地修改（sync_dirty）和删除（sync_tombstones）
const SCHEMA_V7 = [
  `CREATE TABLE IF NOT EXISTS sync_apply (x INTEGER);`,
  `CREATE TABLE IF NOT EXISTS sync_tombstones (
    kind  TEXT NOT NULL,
    uid   TEXT NOT NULL,
    rev   INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL,
    PRIMARY KEY (kind, uid)
  );`,
  ...SYNC_TABLES.map(
    ({ table, kind, cols }) => `
    ALTER TABLE ${table} ADD COLUMN uid        TEXT;
    ALTER TABLE ${table} ADD COLUMN sync_rev   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN sync_mtime INTEGER NOT NULL DEFAULT 0;
    UPDATE ${table} SET uid = lower(hex(randomblob(16))), sync_dirty = 1, sync_mtime = ${NOW_MS};
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_uid ON ${table}(uid);

    CREATE TRIGGER trg_${table}_sync_ins AFTER INSERT ON ${table} WHEN ${NOT_APPLYING}
    BEGIN
      UPDATE ${table} SET uid = COALESCE(uid, lower(hex(randomblob(16)))), sync_dirty = 1, sync_mtime = ${NOW_MS}
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER trg_${table}_sync_upd AFTER UPDATE OF ${cols.join(', ')} ON ${table} WHEN ${NOT_APPLYING}
    BEGIN
      UPDATE ${table} SET sync_dirty = 1, sync_mtime = ${NOW_MS} WHERE id = NEW.id;
    END;

    -- 已同步过的记录，或已绑定云端账号后的删除，都需要通知服务端
    CREATE TRIGGER trg_${table}_sync_del AFTER DELETE ON ${table}
    WHEN OLD.uid IS NOT NULL AND ${NOT_APPLYING}
      AND (OLD.sync_rev > 0 OR EXISTS (SELECT 1 FROM settings WHERE key = 'sync.account'))
    BEGIN
      INSERT OR REPLACE INTO sync_tombstones (kind, uid, rev, mtime) VALUES ('${kind}', OLD.uid, OLD.sync_rev, ${NOW_MS});
    END;`
  ),
  // 内置的默认优先级和状态在每台设备上 id 相同，使用固定 uid，避免同步后出现重复的 P0~P3。
  // 修改时间记为 1：多台设备都未修改过时，以最先同步的设备为准
  ...(['priority', 'status'] as const).map((kind) => {
    const table = kind === 'priority' ? 'priorities' : 'statuses'
    return `
    UPDATE ${table} SET uid = '${kind}-' || id, sync_mtime = 1 WHERE id BETWEEN 1 AND 4;
    INSERT INTO sync_tombstones (kind, uid, rev, mtime)
      SELECT '${kind}', '${kind}-' || n, 0, 1 FROM (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4)
      WHERE n NOT IN (SELECT id FROM ${table});`
  })
].join('\n')

/** 按 user_version 顺序执行迁移，后续版本在数组末尾追加即可 */
const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7]

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
