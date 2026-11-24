/**
 * 账号云同步（PG 账本）：连接配置化 + 自管账号体系。
 * 原则（对应 v2.1 设计 m10402/m10409/m10413）：
 * - 纯 SQL、标准 pg 驱动，不绑任何厂家专有 API —— 换厂家 = 改配置 + 全量重推。
 * - 账号自管（mozhi_users/mozhi_sessions + scrypt 口令哈希），不用平台 Auth/RLS；
 *   业务表一律带 user_id，应用层按用户过滤。
 * - 连接口令与会话令牌落本机加密文件（safeStorage / DPAPI），绝不进快照、不进 git。
 * - local-first：本模块只做「云端对账」，本地 SQLite 永远是唯一读路径（读通道在 M-B）。
 */
import { app, safeStorage } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { getSetting, setSetting } from './db'
import { logEvent } from './logger'

const CFG_KEY = 'pg_sync'
const SESSION_KEY = 'pg_session'
const SECRET_FILE = 'pg-secret.bin'
const SESSION_TTL_DAYS = 30
const NAME_MAX = 24

export interface PgConfig {
  enabled: boolean
  host: string
  port: number
  database: string
  user: string
}

interface PgSecrets {
  password: string
  sessionToken: string
}

export interface PgConfigView {
  enabled: boolean
  host: string
  port: number
  database: string
  user: string
  secretStored: boolean
  session: { userId: string; name: string } | null
}

/* ---------------- 本机加密的秘密（不随库漫游） ---------------- */

function secretFilePath(): string {
  return join(app.getPath('userData'), SECRET_FILE)
}

function loadSecrets(): PgSecrets {
  try {
    const raw = readFileSync(secretFilePath(), 'utf-8').trim()
    if (!raw) return { password: '', sessionToken: '' }
    let json = ''
    if (raw.startsWith('enc:')) {
      if (!safeStorage.isEncryptionAvailable()) return { password: '', sessionToken: '' }
      json = safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
    } else if (raw.startsWith('raw:')) {
      json = raw.slice(4)
    } else {
      return { password: '', sessionToken: '' }
    }
    const parsed = JSON.parse(json) as Partial<PgSecrets>
    return { password: parsed.password ?? '', sessionToken: parsed.sessionToken ?? '' }
  } catch {
    return { password: '', sessionToken: '' }
  }
}

function saveSecrets(next: Partial<PgSecrets>): void {
  const cur = loadSecrets()
  const merged = { password: next.password ?? cur.password, sessionToken: next.sessionToken ?? cur.sessionToken }
  const json = JSON.stringify(merged)
  mkdirSync(app.getPath('userData'), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json)
    writeFileSync(secretFilePath(), 'enc:' + Buffer.from(enc).toString('base64'), 'utf-8')
  } else {
    writeFileSync(secretFilePath(), 'raw:' + json, 'utf-8')
  }
}

/* ---------------- 连接配置（随库漫游的非敏感部分） ---------------- */

function readConfig(): PgConfig {
  try {
    const raw = getSetting(CFG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PgConfig>
      return {
        enabled: parsed.enabled ?? false,
        host: parsed.host ?? '',
        port: Number(parsed.port) > 0 ? Number(parsed.port) : 5432,
        database: parsed.database ?? '',
        user: parsed.user ?? ''
      }
    }
  } catch {
    /* 坏配置当默认 */
  }
  return { enabled: false, host: '', port: 5432, database: '', user: '' }
}

function configComplete(cfg: PgConfig): boolean {
  return Boolean(cfg.host && cfg.database && cfg.user)
}

export function getPgConfigView(): PgConfigView {
  const cfg = readConfig()
  const sess = getSessionView()
  return { ...cfg, secretStored: loadSecrets().password !== '', session: sess }
}

export function savePgConfig(patch: {
  enabled?: boolean
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}): PgConfigView {
  const cur = readConfig()
  const next: PgConfig = {
    enabled: patch.enabled ?? cur.enabled,
    host: (patch.host ?? cur.host).trim(),
    port: patch.port != null && Number(patch.port) > 0 ? Number(patch.port) : cur.port,
    database: (patch.database ?? cur.database).trim(),
    user: (patch.user ?? cur.user).trim()
  }
  setSetting(CFG_KEY, JSON.stringify(next))
  if (patch.password !== undefined) saveSecrets({ password: patch.password })
  if (next.host !== cur.host || next.port !== cur.port || next.database !== cur.database || next.user !== cur.user) {
    invalidatePool()
  }
  logEvent('pg', 'info', '连接配置已保存')
  return getPgConfigView()
}

/* ---------------- 连接池 ---------------- */

let pool: pg.Pool | null = null
let poolSig = ''

function invalidatePool(): void {
  poolSig = ''
  if (pool) {
    const p = pool
    pool = null
    p.end().catch(() => {})
  }
}

function getPool(): pg.Pool {
  const cfg = readConfig()
  if (!configComplete(cfg)) throw new Error('请先填写数据库连接配置（主机/数据库/用户）')
  const password = loadSecrets().password
  if (!password) throw new Error('请先填写数据库口令')
  const sig = `${cfg.host}:${cfg.port}/${cfg.database}?u=${cfg.user}`
  if (!pool || poolSig !== sig) {
    if (pool) {
      const old = pool
      pool = null
      old.end().catch(() => {})
    }
    pool = new pg.Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000
    })
    poolSig = sig
  }
  return pool
}

export async function testPgConnection(): Promise<string> {
  const r = await getPool().query('select version() as v')
  await ensureSchema()
  const v = String(r.rows[0]?.v ?? '')
  logEvent('pg', 'info', '连接测试成功')
  return `已连接 · ${v.slice(0, 48)}… · 账本表就绪`
}

/* ---------------- 云端 schema（版本化，幂等） ---------------- */

export async function ensureSchema(): Promise<void> {
  const p = getPool()
  await p.query(`CREATE TABLE IF NOT EXISTS mozhi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  await p.query(
    `CREATE TABLE IF NOT EXISTS mozhi_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pwd_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )`
  )
  await p.query(
    `CREATE TABLE IF NOT EXISTS mozhi_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES mozhi_users(id) ON DELETE CASCADE,
      device TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`
  )
  await p.query(`CREATE INDEX IF NOT EXISTS mozhi_sessions_user ON mozhi_sessions(user_id)`)
  await p.query(
    `INSERT INTO mozhi_meta(key, value) VALUES ('schema_version','1') ON CONFLICT (key) DO NOTHING`
  )
}

/* ---------------- 账号：注册 / 登录 / 会话 ---------------- */

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

async function issueSession(userId: string, device: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)
  await getPool().query(
    `INSERT INTO mozhi_sessions(token_hash, user_id, device, expires_at) VALUES ($1,$2,$3,$4)`,
    [sha256(token), userId, device, expires.toISOString()]
  )
  return token
}

function getSessionView(): { userId: string; name: string } | null {
  try {
    const raw = getSetting(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: string; name?: string }
    if (!parsed.userId || !parsed.name) return null
    if (!loadSecrets().sessionToken) return null
    return { userId: parsed.userId, name: parsed.name }
  } catch {
    return null
  }
}

export async function registerPgAccount(
  name: string,
  password: string
): Promise<{ ok: true; view: PgConfigView } | { ok: false; error: string }> {
  const n = name.trim()
  if (!n) return { ok: false, error: '请填写账号名' }
  if (n.length > NAME_MAX) return { ok: false, error: `账号名最长 ${NAME_MAX} 字` }
  if (n === '游客') return { ok: false, error: '账号名不可用' }
  if (!password || password.length < 4) return { ok: false, error: '口令至少 4 位' }
  try {
    await ensureSchema()
    const dup = await getPool().query(`SELECT 1 FROM mozhi_users WHERE name = $1`, [n])
    if (dup.rowCount && dup.rowCount > 0) return { ok: false, error: '该账号名已被注册' }
    const id = randomBytes(10).toString('hex')
    const salt = randomBytes(16).toString('hex')
    const pwdHash = hashPassword(password, salt)
    await getPool().query(
      `INSERT INTO mozhi_users(id, name, pwd_hash, salt, last_login_at) VALUES ($1,$2,$3,$4, now())`,
      [id, n, pwdHash, salt]
    )
    const token = await issueSession(id, 'desktop')
    saveSecrets({ sessionToken: token })
    setSetting(SESSION_KEY, JSON.stringify({ userId: id, name: n }))
    logEvent('pg', 'info', `云端账号「${n}」注册成功`)
    return { ok: true, view: getPgConfigView() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logEvent('pg', 'error', `注册失败：${msg}`)
    return { ok: false, error: msg }
  }
}

export async function loginPgAccount(
  name: string,
  password: string
): Promise<{ ok: true; view: PgConfigView } | { ok: false; error: string }> {
  const n = name.trim()
  if (!n || !password) return { ok: false, error: '请填写账号名与口令' }
  try {
    await ensureSchema()
    const r = await getPool().query(`SELECT id, pwd_hash, salt FROM mozhi_users WHERE name = $1`, [n])
    const row = r.rows[0] as { id: string; pwd_hash: string; salt: string } | undefined
    if (!row || !verifyPassword(password, row.salt, row.pwd_hash)) {
      return { ok: false, error: '账号或口令不正确' }
    }
    await getPool().query(`UPDATE mozhi_users SET last_login_at = now() WHERE id = $1`, [row.id])
    const token = await issueSession(row.id, 'desktop')
    saveSecrets({ sessionToken: token })
    setSetting(SESSION_KEY, JSON.stringify({ userId: row.id, name: n }))
    logEvent('pg', 'info', `云端账号「${n}」登录成功`)
    return { ok: true, view: getPgConfigView() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logEvent('pg', 'error', `登录失败：${msg}`)
    return { ok: false, error: msg }
  }
}

/** 校验本机会话令牌是否仍有效（轻量，登录态检查用）。 */
export async function verifyPgSession(): Promise<boolean> {
  const view = getSessionView()
  const token = loadSecrets().sessionToken
  if (!view || !token) return false
  try {
    const r = await getPool().query(
      `SELECT 1 FROM mozhi_sessions s JOIN mozhi_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = $2`,
      [sha256(token), view.userId]
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

export async function logoutPgAccount(): Promise<{ ok: true; view: PgConfigView }> {
  const view = getSessionView()
  const token = loadSecrets().sessionToken
  if (view && token) {
    try {
      await getPool().query(`DELETE FROM mozhi_sessions WHERE token_hash = $1`, [sha256(token)])
    } catch {
      /* 网络失败也照样本地登出 */
    }
  }
  saveSecrets({ sessionToken: '' })
  setSetting(SESSION_KEY, '')
  logEvent('pg', 'info', '云端账号已退出登录')
  return { ok: true, view: getPgConfigView() }
}
