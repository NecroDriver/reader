import * as SQLite from 'expo-sqlite'
import { Platform } from 'react-native'

/**
 * 云同步配置存储在独立的 cloud-config.db（settings 表的值会随快照恢复被覆盖，
 * 而 WebDAV 凭据必须在恢复后仍然可用）。
 */
export interface CloudConfig {
  url: string
  dir: string
  username: string
  password: string
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  url: 'https://dav.jianguoyun.com/dav',
  dir: 'mozhi',
  username: '',
  password: ''
}

const CFG_DB = 'cloud-config.db'
const KEY = 'webdav'

let dbp: Promise<SQLite.SQLiteDatabase> | null = null

function cfgDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbp) {
    dbp = (async () => {
      const db = await SQLite.openDatabaseAsync(CFG_DB)
      await db.runAsync(
        'CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
      )
      return db
    })()
  }
  return dbp
}

export async function loadCloudConfig(): Promise<CloudConfig> {
  try {
    const db = await cfgDb()
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cfg WHERE key = ?', KEY)
    if (row?.value) return { ...DEFAULT_CLOUD_CONFIG, ...(JSON.parse(row.value) as Partial<CloudConfig>) }
  } catch {
    // 读取失败按默认值处理
  }
  return { ...DEFAULT_CLOUD_CONFIG }
}

export async function saveCloudConfig(cfg: CloudConfig): Promise<void> {
  const db = await cfgDb()
  await db.runAsync(
    'INSERT INTO cfg (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    KEY,
    JSON.stringify(cfg)
  )
}

/** 最近一次成功应用的快照描述（用于设置页展示） */
export interface AppliedInfo {
  at: number
  books: number
  chapters: number
}

const KEY_APPLIED = 'last_applied'

export async function loadAppliedInfo(): Promise<AppliedInfo | null> {
  try {
    const db = await cfgDb()
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cfg WHERE key = ?', KEY_APPLIED)
    if (row?.value) return JSON.parse(row.value) as AppliedInfo
  } catch {
    // ignore
  }
  return null
}

export async function saveAppliedInfo(info: AppliedInfo): Promise<void> {
  const db = await cfgDb()
  await db.runAsync(
    'INSERT INTO cfg (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    KEY_APPLIED,
    JSON.stringify(info)
  )
}

/** 通用键值（device_id / progress_uploaded_at 等小状态） */
export async function getCfgValue(key: string): Promise<string | null> {
  try {
    const db = await cfgDb()
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cfg WHERE key = ?', key)
    return row?.value ?? null
  } catch {
    return null
  }
}

export async function setCfgValue(key: string, value: string): Promise<void> {
  const db = await cfgDb()
  await db.runAsync(
    'INSERT INTO cfg (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  )
}

/** Basic 认证头；RN 与 web 都有 btoa（SDK 58 内置） */
export function basicAuth(cfg: CloudConfig): string {
  if (Platform.OS === 'web') {
    return `Basic ${window.btoa(`${cfg.username}:${cfg.password}`)}`
  }
  const g = globalThis as { btoa?: (s: string) => string }
  if (typeof g.btoa === 'function') return `Basic ${g.btoa(`${cfg.username}:${cfg.password}`)}`
  throw new Error('当前环境缺少 base64 编码支持')
}
