/**
 * 云同步编排：快照打包（mozhi.db + covers + manifest）/ 上传轮转 / 下载恢复 / 配置与密钥管理。
 * 原则：
 * - 手动触发、单飞（in-flight 去重）、全程日志，绝不静默失败。
 * - 快照 = 整库覆盖模型（最后上传者赢），恢复前强制本地自动备份。
 * - 口令/密钥单独落盘（safeStorage 加密，DPAPI 绑定本机），绝不进快照（快照里的 mozhi.db 只含非敏感配置）。
 */
import { app, safeStorage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { getDb, closeDb, getSetting, setSetting } from './db'
import {
  EMPTY_SECRETS,
  makeProvider,
  type CloudConfig,
  type CloudProvider,
  type CloudSecrets
} from './cloudStorage'
import { logEvent } from './logger'

const DB_NAME = 'mozhi.db'
const SECRET_FILE = 'cloud-secret.bin'
const CFG_KEY = 'cloud_sync'
const KEY_LAST_UPLOAD = 'last_cloud_upload_at'
const KEY_LAST_DOWNLOAD = 'last_cloud_download_at'

export interface SnapshotManifest {
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

export interface CloudConfigView {
  enabled: boolean
  provider: 'webdav' | 's3'
  webdav: { url: string; dir: string; username: string }
  s3: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
  lastUploadAt: string
  lastDownloadAt: string
  secretStored: boolean
}

function userDataDir(): string {
  return app.getPath('userData')
}

function dbPath(): string {
  return join(userDataDir(), DB_NAME)
}

function coversPath(): string {
  return join(userDataDir(), 'covers')
}

function tmpDir(): string {
  return join(userDataDir(), 'cloud-tmp')
}

/* ---------------- 密钥（本机加密，不进快照） ---------------- */

function secretFilePath(): string {
  return join(userDataDir(), SECRET_FILE)
}

function loadSecrets(): CloudSecrets {
  try {
    const raw = readFileSync(secretFilePath(), 'utf-8').trim()
    if (!raw) return { ...EMPTY_SECRETS }
    if (raw.startsWith('enc:')) {
      if (!safeStorage.isEncryptionAvailable()) return { ...EMPTY_SECRETS }
      const json = safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
      const parsed = JSON.parse(json) as Partial<CloudSecrets>
      return { webdavPassword: parsed.webdavPassword ?? '', s3SecretAccessKey: parsed.s3SecretAccessKey ?? '' }
    }
    if (raw.startsWith('raw:')) {
      const parsed = JSON.parse(raw.slice(4)) as Partial<CloudSecrets>
      return { webdavPassword: parsed.webdavPassword ?? '', s3SecretAccessKey: parsed.s3SecretAccessKey ?? '' }
    }
  } catch {
    /* 读不出当空 */
  }
  return { ...EMPTY_SECRETS }
}

function saveSecrets(secrets: CloudSecrets): void {
  const json = JSON.stringify({ webdavPassword: secrets.webdavPassword, s3SecretAccessKey: secrets.s3SecretAccessKey })
  mkdirSync(userDataDir(), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json)
    writeFileSync(secretFilePath(), 'enc:' + Buffer.from(enc).toString('base64'), 'utf-8')
  } else {
    writeFileSync(secretFilePath(), 'raw:' + json, 'utf-8')
  }
}

/* ---------------- 配置（随库漫游的非敏感部分） ---------------- */

function emptyConfigView(): CloudConfigView {
  return {
    enabled: false,
    provider: 'webdav',
    webdav: { url: '', dir: '', username: '' },
    s3: { endpoint: '', region: '', bucket: '', prefix: 'mozhi', accessKeyId: '' },
    lastUploadAt: '',
    lastDownloadAt: '',
    secretStored: false
  }
}

export function getCloudConfigView(): CloudConfigView {
  const view = emptyConfigView()
  try {
    const raw = getSetting(CFG_KEY)
    if (raw) Object.assign(view, JSON.parse(raw))
  } catch {
    /* 无配置 */
  }
  view.lastUploadAt = getSetting(KEY_LAST_UPLOAD) ?? ''
  view.lastDownloadAt = getSetting(KEY_LAST_DOWNLOAD) ?? ''
  const secrets = loadSecrets()
  view.secretStored = !!(secrets.webdavPassword || secrets.s3SecretAccessKey)
  return view
}

/** 保存配置；secrets 传 undefined 表示不动密钥，传值（含空串）则覆写 */
export function setCloudConfig(patch: {
  enabled?: boolean
  provider?: 'webdav' | 's3'
  webdav?: { url: string; dir: string; username: string }
  s3?: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
  webdavPassword?: string
  s3SecretAccessKey?: string
}): void {
  const view = getCloudConfigView()
  const cfg: CloudConfigView = { ...view }
  if (patch.enabled !== undefined) cfg.enabled = patch.enabled
  if (patch.provider) cfg.provider = patch.provider
  if (patch.webdav) cfg.webdav = { ...patch.webdav }
  if (patch.s3) cfg.s3 = { ...patch.s3 }
  setSetting(
    CFG_KEY,
    JSON.stringify({
      enabled: cfg.enabled,
      provider: cfg.provider,
      webdav: cfg.webdav,
      s3: cfg.s3
    })
  )
  const secrets = loadSecrets()
  let touched = false
  if (patch.webdavPassword !== undefined) {
    secrets.webdavPassword = patch.webdavPassword
    touched = true
  }
  if (patch.s3SecretAccessKey !== undefined) {
    secrets.s3SecretAccessKey = patch.s3SecretAccessKey
    touched = true
  }
  if (touched) saveSecrets(secrets)
}

function buildProvider(): CloudProvider {
  const view = getCloudConfigView()
  const cfg: CloudConfig = { provider: view.provider, webdav: view.webdav, s3: view.s3 }
  return makeProvider(cfg, loadSecrets())
}

/* ---------------- 快照 ---------------- */

function countRows(sql: string): number {
  const d = getDb()
  const row = d.prepare(sql).get() as { n: number } | undefined
  return row?.n ?? 0
}

function buildManifest(zipBytes: number): SnapshotManifest {
  let covers = 0
  try {
    covers = readdirSync(coversPath()).filter((f) => /^book-/.test(f)).length
  } catch {
    /* 无封面目录 */
  }
  let dbBytes = 0
  try {
    dbBytes = statSync(dbPath()).size
  } catch {
    /* 库文件异常时仍出 manifest */
  }
  return {
    app: app.getVersion(),
    createdAt: new Date().toISOString(),
    books: countRows('SELECT COUNT(*) n FROM books'),
    articles: countRows('SELECT COUNT(*) n FROM articles'),
    chapters: countRows('SELECT COUNT(*) n FROM chapters WHERE deleted = 0'),
    sources: countRows('SELECT COUNT(*) n FROM sources'),
    covers,
    dbBytes,
    zipBytes
  }
}

/** 打快照 zip（不碰云端）。返回临时文件路径 + manifest。 */
function writeSnapshotZip(): { zipPath: string; manifest: SnapshotManifest } {
  const d = getDb()
  d.pragma('wal_checkpoint(TRUNCATE)')
  const tmp = tmpDir()
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const zip = new AdmZip()
  zip.addLocalFile(dbPath(), '', DB_NAME)
  if (existsSync(coversPath())) zip.addLocalFolder(coversPath(), 'covers')
  const zipPath = join(tmp, 'mozhi-latest.zip')
  zip.writeZip(zipPath)
  /* 两遍：先定型体积，再把带体积数的 manifest 收进包内（下载侧只读包内 manifest） */
  const manifest = buildManifest(statSync(zipPath).size)
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
  zip.writeZip(zipPath)
  return { zipPath, manifest }
}

/** 读取 zip 内 manifest（不整包解压） */
export function readSnapshotSummary(zipPath: string): SnapshotManifest {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry('manifest.json')
  if (!entry) throw new Error('快照缺少 manifest.json，可能不是墨纸的备份文件')
  return JSON.parse(entry.getData().toString('utf-8')) as SnapshotManifest
}

/* ---------------- 上传 / 下载 / 恢复 ---------------- */

let inFlight = false

export async function uploadSnapshot(): Promise<{ ok: boolean; message: string; manifest?: SnapshotManifest }> {
  if (inFlight) return { ok: false, message: '已有同步任务进行中' }
  inFlight = true
  try {
    const provider = buildProvider()
    const { zipPath, manifest } = writeSnapshotZip()
    /* 轮转：现有 latest → prev（无则跳过） */
    try {
      const prev = await provider.get('mozhi-latest.zip')
      await provider.put('mozhi-prev.zip', prev)
    } catch {
      /* 首次上传没有旧快照 */
    }
    const zipBytes = readFileSync(zipPath)
    await provider.put('mozhi-latest.zip', zipBytes)
    const manifestJson = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    await provider.put('manifest.json', manifestJson)
    setSetting(KEY_LAST_UPLOAD, new Date().toISOString())
    logEvent('cloud', 'info', `快照已上传：${manifest.books} 书 / ${manifest.articles} 文 / ${manifest.chapters} 章，${(manifest.zipBytes / 1048576).toFixed(1)}MB`)
    return { ok: true, message: '快照已上传', manifest }
  } catch (e) {
    const msg = (e as Error).message || '上传失败'
    logEvent('cloud', 'error', '上传失败：' + msg)
    return { ok: false, message: msg }
  } finally {
    inFlight = false
    try {
      rmSync(tmpDir(), { recursive: true, force: true })
    } catch {
      /* 清理失败无害 */
    }
  }
}

export interface DownloadedSnapshot {
  zipPath: string
  manifest: SnapshotManifest
}

/** 下载云端最新快照到临时目录并读出摘要（恢复前的确认步骤，不动本地数据） */
export async function downloadSnapshot(): Promise<{ ok: boolean; message: string; snapshot?: DownloadedSnapshot }> {
  if (inFlight) return { ok: false, message: '已有同步任务进行中' }
  inFlight = true
  try {
    const provider = buildProvider()
    const data = await provider.get('mozhi-latest.zip')
    const tmp = tmpDir()
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const zipPath = join(tmp, 'downloaded.zip')
    writeFileSync(zipPath, data)
    const manifest = readSnapshotSummary(zipPath)
    logEvent('cloud', 'info', `云端快照已下载待确认：${manifest.books} 书 / ${manifest.chapters} 章（${manifest.createdAt}）`)
    return { ok: true, message: '已下载，等待确认恢复', snapshot: { zipPath, manifest } }
  } catch (e) {
    const msg = (e as Error).message === 'NOT_FOUND' ? '云端还没有快照，请先上传' : (e as Error).message || '下载失败'
    logEvent('cloud', 'error', '下载失败：' + msg)
    return { ok: false, message: msg }
  } finally {
    inFlight = false
  }
}

let pendingRestore: DownloadedSnapshot | null = null

export function getPendingRestore(): DownloadedSnapshot | null {
  return pendingRestore
}

/** 确认恢复：本地自动备份 → 解压替换 db + covers → 重开库。 */
export function applyPendingRestore(): { ok: boolean; message: string } {
  if (!pendingRestore) return { ok: false, message: '没有待恢复的快照（请先「从云端恢复」下载）' }
  const { zipPath } = pendingRestore
  try {
    closeDb()
    /* 本地自动备份（单代） */
    try {
      rmSync(dbPath() + '.bak-restore', { force: true })
    } catch {
      /* 无旧备份 */
    }
    try {
      renameSync(dbPath(), dbPath() + '.bak-restore')
    } catch {
      /* 无现有库（空账号首次恢复） */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        rmSync(dbPath() + suffix, { force: true })
      } catch {
        /* 无 WAL 残留 */
      }
    }
    const bakCovers = coversPath() + '.bak-restore'
    try {
      rmSync(bakCovers, { recursive: true, force: true })
      renameSync(coversPath(), bakCovers)
    } catch {
      /* 无现有封面目录 */
    }
    /* 解压替换 */
    const zip = new AdmZip(zipPath)
    const dbEntry = zip.getEntry(DB_NAME)
    if (!dbEntry) throw new Error('快照内缺少 mozhi.db')
    writeFileSync(dbPath(), dbEntry.getData())
    mkdirSync(coversPath(), { recursive: true })
    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith('covers/') && !entry.isDirectory) {
        const name = entry.entryName.slice('covers/'.length).replace(/[/\\]/g, '_')
        if (/^book-\d+\.(jpe?g|png|webp|bmp|gif)$/i.test(name)) {
          writeFileSync(join(coversPath(), name), entry.getData())
        }
      }
    }
    setSetting(KEY_LAST_DOWNLOAD, new Date().toISOString())
    pendingRestore = null
    try {
      rmSync(tmpDir(), { recursive: true, force: true })
    } catch {
      /* 清理失败无害 */
    }
    getDb() /* 立即重开：migrate 兼容 + 让潜在错误在此暴露 */
    logEvent('cloud', 'info', '云端快照已恢复（恢复前本地库备份为 mozhi.db.bak-restore）')
    return { ok: true, message: '恢复完成' }
  } catch (e) {
    const msg = (e as Error).message || '恢复失败'
    logEvent('cloud', 'error', '恢复失败：' + msg)
    /* 尽力回滚 */
    try {
      if (existsSync(dbPath() + '.bak-restore') && !existsSync(dbPath())) {
        copyFileSync(dbPath() + '.bak-restore', dbPath())
      }
      getDb()
    } catch {
      /* 回滚失败只能提示重试 */
    }
    return { ok: false, message: msg }
  }
}

export function discardPendingRestore(): void {
  pendingRestore = null
  try {
    rmSync(tmpDir(), { recursive: true, force: true })
  } catch {
    /* 无害 */
  }
}

export function rememberPendingRestore(s: DownloadedSnapshot): void {
  pendingRestore = s
}

export async function remoteInfo(): Promise<{ exists: boolean; manifest?: SnapshotManifest; message?: string }> {
  try {
    const provider = buildProvider()
    const data = await provider.get('manifest.json')
    const manifest = JSON.parse(data.toString('utf-8')) as SnapshotManifest
    return { exists: true, manifest }
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'NOT_FOUND') return { exists: false }
    return { exists: false, message: msg }
  }
}

export async function testCloudConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const provider = buildProvider()
    const message = await provider.test()
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error).message || '连接失败' }
  }
}
