/**
 * 本地账号体系：注册账号 + 游客双轨。
 *
 * - 注册表 accounts.json 永远放在默认 userData 基座（defaultDataDir()），不随账号目录移动。
 * - 每个注册账号独立数据目录：自定义 dataDir 或 基座/accounts/<id>/，内含 mozhi.db、covers、logs。
 * - 口令为「本地应用锁」（scrypt 哈希校验，≥4 位必填），不做磁盘加密——UI 文案如实说明。
 * - 游客：非持久身份（不进注册表），使用 基座/accounts/guest/ 演示沙盒库（首开播种演示书）；
 *   仅可浏览与阅读，云同步/添加小说/更新全部等大部分功能受限并引导注册。
 * - MOZHI_DATA_DIR 环境变量存在时完全绕过账号体系（自动化测试用）。
 */
import { app, safeStorage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { defaultDataDir } from './bootstrap'
import { setSeedPolicy, closeDb } from './db'

const REGISTRY_NAME = 'accounts.json'
const DB_NAME = 'mozhi.db'

export interface AccountRecord {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string
  /** 自定义数据目录（空 = 基座/accounts/<id>/） */
  dataDir: string | null
  /** 本地口令（scrypt 哈希，base64）；无则可直接进入 */
  passwordHash: string | null
  salt: string | null
  /** 新建账号尚未初始化过库（首次打开时跳过演示种子） */
  fresh: boolean
}

interface Registry {
  version: 1
  activeId: string | null
  accounts: AccountRecord[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function registryPath(): string {
  return join(defaultDataDir(), REGISTRY_NAME)
}

function readRegistry(): Registry {
  try {
    let text = readFileSync(registryPath(), 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) /* 剥 BOM（PowerShell 写入习惯） */
    const parsed = JSON.parse(text) as Registry
    if (Array.isArray(parsed.accounts)) return parsed
  } catch {
    /* 首次或损坏 → 空注册表（不再自动创建「主账号」） */
  }
  const fresh: Registry = { version: 1, activeId: null, accounts: [] }
  saveRegistry(fresh)
  return fresh
}

function saveRegistry(reg: Registry): void {
  mkdirSync(defaultDataDir(), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf-8')
}

let registry: Registry | null = null

function reg(): Registry {
  if (!registry) registry = readRegistry()
  return registry
}

export interface AccountSummary {
  id: string
  name: string
  hasPassword: boolean
  lastUsedAt: string
  active: boolean
}

export function listAccounts(): AccountSummary[] {
  const r = reg()
  return r.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    hasPassword: !!a.passwordHash,
    lastUsedAt: a.lastUsedAt,
    active: a.id === r.activeId
  }))
}

export function hasEnvOverride(): boolean {
  return !!process.env['MOZHI_DATA_DIR']?.trim()
}

export function getActiveAccount(): AccountRecord | null {
  const r = reg()
  if (!r.activeId) return null
  return r.accounts.find((a) => a.id === r.activeId) ?? null
}

/** 启动期判定：env 直通 / 自动进入（无口令，或本机留有「记住我」凭据）/ 登录页 */
export function startupSession():
  | { mode: 'env' }
  | { mode: 'login' }
  | { mode: 'auto'; account: AccountRecord; rememberedPassword: string | null } {
  if (hasEnvOverride()) return { mode: 'env' }
  const active = getActiveAccount()
  if (!active) return { mode: 'login' }
  if (!active.passwordHash) return { mode: 'auto', account: active, rememberedPassword: null }
  const remembered = readRemember(active.id)
  if (remembered !== null) return { mode: 'auto', account: active, rememberedPassword: remembered }
  return { mode: 'login' }
}

/* ---------- 「记住我」：本机留一份可撤销的自动登录凭据 ----------
   文件放基座/accounts/<id>.remember（不进账号数据目录，不随自定义目录/快照走）；
   safeStorage（Windows DPAPI）可用则加密，否则明文并尽力而为。退出登录即删除。 */

function rememberPath(id: string): string {
  return join(defaultDataDir(), 'accounts', `${id}.remember`)
}

export function writeRemember(id: string, password: string): void {
  try {
    mkdirSync(join(defaultDataDir(), 'accounts'), { recursive: true })
    let body: string
    if (safeStorage.isEncryptionAvailable()) {
      body = 'enc:' + safeStorage.encryptString(password).toString('base64')
    } else {
      body = 'raw:' + password
    }
    writeFileSync(rememberPath(id), body, 'utf-8')
  } catch {
    /* 记不住就退化为每次输口令 */
  }
}

export function clearRemember(id: string): void {
  try {
    rmSync(rememberPath(id), { force: true })
  } catch {
    /* 删不掉就算了（文件本身无害） */
  }
}

/** 读出记住的口令；无法解密（换机器/系统变更）时删除文件并返回 null */
export function readRemember(id: string): string | null {
  try {
    const raw = readFileSync(rememberPath(id), 'utf-8')
    if (raw.startsWith('enc:')) {
      const buf = Buffer.from(raw.slice(4), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (raw.startsWith('raw:')) return raw.slice(4)
  } catch {
    /* 无文件或解密失败 */
  }
  clearRemember(id)
  return null
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('base64')
}

export function verifyPassword(account: AccountRecord, password: string): boolean {
  if (!account.passwordHash || !account.salt) return true
  const expect = Buffer.from(account.passwordHash, 'base64')
  const got = Buffer.from(hashPassword(password, account.salt), 'base64')
  return expect.length === got.length && timingSafeEqual(expect, got)
}

export function accountDir(account: AccountRecord): string {
  if (account.dataDir) return account.dataDir
  return join(defaultDataDir(), 'accounts', account.id)
}

/** 登录（或自动进入）：解析目录、迁移旧库、重定向 userData。返回失败原因或 null。 */
export function activateAccount(id: string, password: string): string | null {
  const r = reg()
  const account = r.accounts.find((a) => a.id === id)
  if (!account) return '账号不存在'
  if (account.passwordHash && !verifyPassword(account, password)) return '口令不正确'

  const dir = accountDir(account)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    /* 自定义目录且尚无库：把基座库搬过去（沿用 bootstrap 迁移语义） */
    if (account.dataDir && !existsSync(join(dir, DB_NAME))) {
      const base = defaultDataDir()
      for (const suffix of ['', '-wal', '-shm']) {
        const src = join(base, DB_NAME + suffix)
        if (existsSync(src)) {
          try {
            copyFileSync(src, join(dir, DB_NAME + suffix))
          } catch {
            /* 拷不动就让 db 全新建 */
          }
        }
      }
    }
    /* 全新账号空库：跳过演示种子 */
    if (account.fresh && !existsSync(join(dir, DB_NAME))) setSeedPolicy('none')
  } catch {
    return '数据目录不可用：' + dir
  }

  /* 关键：重定向前先关掉旧库连接，否则 db.ts 缓存句柄仍指向上一账号的文件 */
  closeDb()
  app.setPath('userData', dir)
  account.lastUsedAt = nowIso()
  account.fresh = false
  r.activeId = account.id
  saveRegistry(r)
  return null
}

/** 退出登录：清 activeId、userData 回基座（登录页期间不碰任何账号库）。 */
export function deactivateAccount(): void {
  const r = reg()
  r.activeId = null
  saveRegistry(r)
  guestActive = false
  closeDb()
  app.setPath('userData', defaultDataDir())
}

/* ---------- 游客模式：非持久身份，基座/accounts/guest/ 演示沙盒 ---------- */

let guestActive = false

export function isGuestActive(): boolean {
  return guestActive
}

/** 以游客身份进入：演示沙盒库（首开播种演示书），不写注册表、不持久（重启回登录页）。 */
export function activateGuest(): string | null {
  const dir = join(defaultDataDir(), 'accounts', 'guest')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    /* 沙盒无库时播种演示书（与首次安装体验一致） */
    if (!existsSync(join(dir, DB_NAME))) setSeedPolicy('demo')
  } catch {
    return '游客目录不可用：' + dir
  }
  closeDb()
  app.setPath('userData', dir)
  const r = reg()
  r.activeId = null
  saveRegistry(r)
  guestActive = true
  return null
}

/** 新建账号并登录：全新空库（跳过演示种子）。返回错误或 null。 */
export function createAndActivate(name: string, password: string): string | null {
  const r = reg()
  const trimmed = name.trim()
  if (!trimmed) return '请填写账号名称'
  if (trimmed.length > 24) return '账号名称过长（≤24 字）'
  if (trimmed === '游客') return '该名字保留给游客模式'
  if (r.accounts.some((a) => a.name === trimmed)) return '已有同名账号'
  if (!password || password.length < 4) return '口令至少 4 位'

  const id = randomBytes(6).toString('hex')
  const salt = randomBytes(16).toString('hex')
  const account: AccountRecord = {
    id,
    name: trimmed,
    createdAt: nowIso(),
    lastUsedAt: nowIso(),
    dataDir: null,
    passwordHash: hashPassword(password, salt),
    salt,
    fresh: true
  }
  r.accounts.push(account)
  const err = activateAccount(id, password)
  if (err) {
    r.accounts = r.accounts.filter((a) => a.id !== id)
    saveRegistry(r)
    return err
  }
  return null
}

/** 设置当前账号的自定义数据目录（设置页「数据与缓存目录」改写这里，替代旧 mozhi.config.json）。 */
export function setAccountDataDir(dir: string | null): string | null {
  const r = reg()
  const account = getActiveAccount()
  if (!account) return '未登录'
  const base = defaultDataDir()
  account.dataDir = dir && dir !== base ? dir : null
  saveRegistry(r)
  return null
}

export function getAccountDataDir(): string | null {
  return getActiveAccount()?.dataDir ?? null
}
