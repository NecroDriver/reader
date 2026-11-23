import { fetch } from 'expo/fetch'
import JSZip from 'jszip'
import * as SQLite from 'expo-sqlite'
import { basicAuth, type CloudConfig } from './storage'

/** 与桌面端 cloudSync.ts 的 SnapshotManifest 对齐（只取移动端关心的字段） */
export interface RemoteManifest {
  app: string
  createdAt: string
  books: number
  articles: number
  chapters: number
  sources: number
  covers: number
  dbBytes: number
  zipBytes: number
}

function joinUrl(cfg: CloudConfig, name: string): string {
  const base = cfg.url.replace(/\/+$/, '')
  const dir = cfg.dir.replace(/^\/+|\/+$/g, '')
  const seg = dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : ''
  return `${base}/${seg}${encodeURIComponent(name)}`
}

async function davFetch(cfg: CloudConfig, name: string, init: RequestInit = {}): Promise<Response> {
  return fetch(joinUrl(cfg, name), {
    ...init,
    headers: { Authorization: basicAuth(cfg), ...(init.headers as Record<string, string> | undefined) }
  })
}

/** 连接测试：PROPFIND 目录，404 则尝试 MKCOL 创建，再验一次；401 给出明确文案 */
export async function testConnection(cfg: CloudConfig): Promise<string> {
  const notConfigured = !cfg.url || !cfg.username || !cfg.password
  if (notConfigured) throw new Error('请先填写服务器地址、账号与应用密码')
  let res = await davFetch(cfg, '', { method: 'PROPFIND', headers: { Depth: '0' } })
  if (res.status === 404) {
    const mkcol = await davFetch(cfg, '', { method: 'MKCOL' })
    if (!mkcol.ok && mkcol.status !== 405) {
      throw new Error(`创建远程目录失败（HTTP ${mkcol.status}）`)
    }
    res = await davFetch(cfg, '', { method: 'PROPFIND', headers: { Depth: '0' } })
  }
  if (res.status === 401) throw new Error('账号或应用密码不正确（HTTP 401）')
  if (!res.ok) throw new Error(`连接失败（HTTP ${res.status}）`)
  return '连接正常'
}

export async function getRemoteManifest(cfg: CloudConfig): Promise<RemoteManifest | null> {
  const res = await davFetch(cfg, 'manifest.json')
  if (res.status === 404) return null
  if (!res.ok) {
    if (res.status === 401) throw new Error('账号或应用密码不正确（HTTP 401）')
    throw new Error(`读取远端信息失败（HTTP ${res.status}）`)
  }
  const text = await res.text()
  return JSON.parse(text) as RemoteManifest
}

/** 下载快照 zip 并解出 mozhi.db 二进制 */
export async function downloadSnapshotDb(cfg: CloudConfig): Promise<{ bytes: Uint8Array; manifest: RemoteManifest | null }> {
  const res = await davFetch(cfg, 'mozhi-latest.zip')
  if (res.status === 404) throw new Error('云端还没有快照（请先在桌面端上传）')
  if (res.status === 401) throw new Error('账号或应用密码不正确（HTTP 401）')
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
  const buf = await res.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const entry = zip.file('mozhi.db')
  if (!entry) throw new Error('快照内缺少 mozhi.db，请用桌面端 0.2.0+ 重新上传')
  const bytes = await entry.async('uint8array')
  return { bytes, manifest: zip.file('manifest.json') ? JSON.parse(await zip.file('manifest.json')!.async('string')) : null }
}

/**
 * 把快照数据库灌进当前应用库：
 * deserialize 到内存库 → SQLite backup API 页级复制到 provider 正在使用的连接。
 * 无需替换文件、无需重启，全平台（含 web）一致。
 * 返回应用的书数/章数；mobile 主题与排版偏好会在恢复前保留、恢复后写回。
 */
export async function applySnapshotDb(
  target: SQLite.SQLiteDatabase,
  bytes: Uint8Array,
  prefsToKeep: Record<string, string | number | null>
): Promise<{ books: number; chapters: number }> {
  const saved = Object.entries(prefsToKeep) as [string, string | number][]
  const mem = await SQLite.deserializeDatabaseAsync(bytes)
  try {
    await SQLite.backupDatabaseAsync({
      sourceDatabase: mem,
      sourceDatabaseName: 'main',
      destDatabase: target,
      destDatabaseName: 'main'
    })
  } finally {
    await mem.closeAsync()
  }
  // 恢复被快照覆盖的移动端偏好
  for (const [k, v] of saved) {
    if (v === null || v === undefined) continue
    await target.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      k,
      String(v)
    )
  }
  const books = await target.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM books')
  const chapters = await target.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM chapters WHERE deleted = 0'
  )
  return { books: books?.n ?? 0, chapters: chapters?.n ?? 0 }
}
