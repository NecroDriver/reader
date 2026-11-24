import * as Crypto from 'expo-crypto'
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'

/**
 * 移动端账号体系：与桌面端同一套语义（本地账号 + 口令 + 记住我），
 * 存放在独立的 cloud-config.db（不随书库快照走、不被云端恢复覆盖）。
 * 每个账号对应一份独立书库文件 mozhi-<id>.db，实现账号级数据隔离；
 * 首次升级时把既有的 mozhi.db 挂到自动创建的「主账号」名下，老数据不丢。
 */

export interface AccountRec {
  id: string
  name: string
  /** 该账号使用的书库文件名（不含路径）。主账号沿用 'mozhi.db' */
  dbName: string
  /** 空串 = 无口令账号（游客语义，直接进入） */
  pwdHash: string
  salt: string
  createdAt: number
  lastUsedAt: number
}

const ROUNDS = 2000

export function hasPwd(a: AccountRec): boolean {
  return a.pwdHash !== ''
}

/** 迭代加盐 SHA-256（expo-crypto 无 pbkdf2，此为移动端折中方案） */
async function hashPassword(pwd: string, salt: string): Promise<string> {
  let h = `${salt}:${pwd}`
  for (let i = 0; i < ROUNDS; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, h)
  }
  return h
}

function randomId(): string {
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`
}

async function accountsDb(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('cloud-config.db')
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      db_name TEXT NOT NULL,
      pwd_hash TEXT NOT NULL DEFAULT '',
      salt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
  `)
  return db
}

/**
 * 首次运行迁移：没有任何账号时，把既有书库文件 mozhi.db
 * 挂到自动创建的「主账号」名下（不设口令 = 游客语义）。
 */
export async function migrateFromLegacy(): Promise<void> {
  const db = await accountsDb()
  try {
    const n = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM accounts')
    if ((n?.c ?? 0) === 0) {
      const now = Date.now()
      await db.runAsync(
        'INSERT INTO accounts (id, name, db_name, pwd_hash, salt, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['legacy-main', '主账号', 'mozhi.db', '', '', now, now]
      )
    }
  } finally {
    await db.closeAsync()
  }
}

interface AccountRow {
  id: string
  name: string
  db_name: string
  pwd_hash: string
  salt: string
  created_at: number
  last_used_at: number
}

function toRec(r: AccountRow): AccountRec {
  return {
    id: r.id,
    name: r.name,
    dbName: r.db_name,
    pwdHash: r.pwd_hash,
    salt: r.salt,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at
  }
}

export async function listAccounts(): Promise<AccountRec[]> {
  const db = await accountsDb()
  try {
    const rows = await db.getAllAsync<AccountRow>(
      'SELECT id, name, db_name, pwd_hash, salt, created_at, last_used_at FROM accounts ORDER BY last_used_at DESC'
    )
    return rows.map(toRec)
  } finally {
    await db.closeAsync()
  }
}

async function cfgGet(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cfg WHERE key = ?', key)
  return row?.value ?? null
}

async function cfgSet(db: SQLiteDatabase, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.runAsync('DELETE FROM cfg WHERE key = ?', key)
  } else {
    await db.runAsync('INSERT OR REPLACE INTO cfg (key, value) VALUES (?, ?)', key, value)
  }
}

function b64(s: string): string {
  return globalThis.btoa(unescape(encodeURIComponent(s)))
}

function unb64(s: string): string {
  return decodeURIComponent(escape(globalThis.atob(s)))
}

/** 校验口令并进入账号；成功返回该账号（并落 active 与 lastUsedAt） */
export async function loginAccount(id: string, pwd: string, remember: boolean): Promise<{ ok: true; account: AccountRec } | { ok: false; error: string }> {
  const db = await accountsDb()
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const row = await db.getFirstAsync<AccountRow>(
      'SELECT id, name, db_name, pwd_hash, salt, created_at, last_used_at FROM accounts WHERE id = ?',
      id
    )
    if (!row) return { ok: false, error: '账号不存在，请重新进入' }
    const rec = toRec(row)
    if (hasPwd(rec)) {
      if (pwd === '') return { ok: false, error: '请输入口令' }
      const h = await hashPassword(pwd, rec.salt)
      if (h !== rec.pwdHash) return { ok: false, error: '口令不正确' }
    }
    const now = Date.now()
    await db.runAsync('UPDATE accounts SET last_used_at = ? WHERE id = ?', now, id)
    await cfgSet(db, 'active_id', id)
    await cfgSet(db, `remember_${id}`, hasPwd(rec) && remember ? b64(pwd) : null)
    return { ok: true, account: { ...rec, lastUsedAt: now } }
  } finally {
    await db.closeAsync()
  }
}

export async function createAccount(
  name: string,
  pwd: string,
  remember: boolean
): Promise<{ ok: true; account: AccountRec } | { ok: false; error: string }> {
  const n = name.trim()
  if (!n) return { ok: false, error: '请填写账号名' }
  if (n.length > 12) return { ok: false, error: '账号名最多 12 个字' }
  if (pwd !== '' && pwd.length < 4) return { ok: false, error: '口令至少 4 位（留空则为游客账号）' }
  const db = await accountsDb()
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const dup = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM accounts WHERE name = ?', n)
    if ((dup?.c ?? 0) > 0) return { ok: false, error: '已有同名账号' }
    const id = randomId()
    const now = Date.now()
    const salt = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${id}:${now}:${Math.random()}`)
    const h = pwd === '' ? '' : await hashPassword(pwd, salt)
    await db.runAsync(
      'INSERT INTO accounts (id, name, db_name, pwd_hash, salt, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, n, `mozhi-${id}.db`, h, salt, now, now]
    )
    await cfgSet(db, 'active_id', id)
    await cfgSet(db, `remember_${id}`, h !== '' && remember ? b64(pwd) : null)
    return { ok: true, account: { id, name: n, dbName: `mozhi-${id}.db`, pwdHash: h, salt, createdAt: now, lastUsedAt: now } }
  } finally {
    await db.closeAsync()
  }
}

/** 启动会话：active 账号无口令或留有「记住我」凭据时自动进入 */
export async function startupSession(): Promise<{ account: AccountRec; rememberedPwd: string | null } | null> {
  const db = await accountsDb()
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const activeId = await cfgGet(db, 'active_id')
    if (!activeId) return null
    const row = await db.getFirstAsync<AccountRow>(
      'SELECT id, name, db_name, pwd_hash, salt, created_at, last_used_at FROM accounts WHERE id = ?',
      activeId
    )
    if (!row) return null
    const rec = toRec(row)
    if (!hasPwd(rec)) return { account: rec, rememberedPwd: null }
    const rem = await cfgGet(db, `remember_${activeId}`)
    if (!rem) return null
    try {
      return { account: rec, rememberedPwd: unb64(rem) }
    } catch {
      return null
    }
  } finally {
    await db.closeAsync()
  }
}

/** 退出登录：清 active 与「记住我」（账号与书库数据保留） */
export async function logoutAccount(): Promise<void> {
  const db = await accountsDb()
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const activeId = await cfgGet(db, 'active_id')
    await cfgSet(db, 'active_id', null)
    if (activeId) await cfgSet(db, `remember_${activeId}`, null)
  } finally {
    await db.closeAsync()
  }
}

/** 确保书库 schema 存在（新账号的空库首次打开时建表；IF NOT EXISTS 对老库无副作用） */
export async function ensureSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      format TEXT DEFAULT 'TXT',
      cover_idx INTEGER DEFAULT 0,
      progress REAL DEFAULT 0,
      chapter_label TEXT DEFAULT '',
      sort_at REAL,
      created_at TEXT,
      total_chapters INTEGER DEFAULT 0,
      current_chapter INTEGER DEFAULT 0,
      origin_path TEXT DEFAULT '',
      cfi TEXT DEFAULT '',
      cover_path TEXT DEFAULT '',
      download_url TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS chapters (
      book_id INTEGER,
      idx INTEGER,
      title TEXT,
      content TEXT,
      url TEXT DEFAULT '',
      deleted INTEGER DEFAULT 0,
      content_edited INTEGER DEFAULT 0,
      dup INTEGER DEFAULT 0,
      PRIMARY KEY (book_id, idx)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
}
