import * as SQLite from 'expo-sqlite'
import { fetch } from 'expo/fetch'
import { basicAuth, getCfgValue, setCfgValue, type CloudConfig } from './storage'

/**
 * M4 · 手机端进度回传：把阅读进度打包成小 sidecar JSON 上传到 WebDAV，
 * 桌面端「云同步」页手动吸收。移动端不改云端快照本体。
 */
export interface PhoneProgressEntry {
  bookId: number
  title: string
  progress: number
  currentChapter: number
  chapterLabel: string
}

export interface PhoneProgress {
  app: string
  deviceId: string
  generatedAt: string
  entries: PhoneProgressEntry[]
}

export const PHONE_PROGRESS_NAME = 'mozhi-progress-phone.json'

/** 设备标识：桌面端展示「来自哪台手机」用；首次生成后存 cloud-config.db */
export async function getDeviceId(): Promise<string> {
  let id = await getCfgValue('device_id')
  if (!id) {
    id = `phone-${Math.random().toString(36).slice(2, 8)}`
    await setCfgValue('device_id', id)
  }
  return id
}

export function countReadBooks(db: SQLite.SQLiteDatabase): Promise<number> {
  return db
    .getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM books WHERE progress > 0')
    .then((r) => r?.n ?? 0)
}

async function collectProgress(db: SQLite.SQLiteDatabase): Promise<PhoneProgressEntry[]> {
  const rows = await db.getAllAsync<PhoneProgressEntry>(
    `SELECT id AS bookId, title, progress, current_chapter AS currentChapter,
            chapter_label AS chapterLabel
       FROM books WHERE progress > 0 ORDER BY id`
  )
  return rows
}

/** 上传进度 sidecar；返回打包的书数 */
export async function uploadPhoneProgress(
  db: SQLite.SQLiteDatabase,
  cfg: CloudConfig
): Promise<number> {
  const entries = await collectProgress(db)
  const payload: PhoneProgress = {
    app: 'mozhi-mobile',
    deviceId: await getDeviceId(),
    generatedAt: new Date().toISOString(),
    entries
  }
  const base = cfg.url.replace(/\/+$/, '')
  const dir = cfg.dir.replace(/^\/+|\/+$/g, '')
  const seg = dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : ''
  const res = await fetch(`${base}/${seg}${encodeURIComponent(PHONE_PROGRESS_NAME)}`, {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(cfg),
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  })
  if (res.status === 401) throw new Error('账号或应用密码不正确（HTTP 401）')
  if (!res.ok) throw new Error(`上传进度失败（HTTP ${res.status}）`)
  await setCfgValue('progress_uploaded_at', String(Date.now()))
  return entries.length
}

export async function loadProgressUploadedAt(): Promise<number | null> {
  const v = await getCfgValue('progress_uploaded_at')
  const n = v !== null ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
