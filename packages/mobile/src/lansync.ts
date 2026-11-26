import type { SQLiteDatabase } from 'expo-sqlite'
import { fetch } from 'expo/fetch'
import {
  clearUnsyncedBooks,
  collectProgressEntries,
  deleteBooksByUuids,
  findLocalBookId,
  localChaptersRev,
  replaceChapters,
  upsertSyncBook,
  type SyncBookIn
} from './db'
import { clearLanPair, loadLanCursors, loadLanPair, saveLanCursors, saveLanPair, setCfgValue, type LanPair } from './storage'

/**
 * LAN 设备同步客户端。桌面端是唯一权威（书架/章节/删除），手机只回传阅读进度。
 * 协议见桌面 lanSync.ts：/ping /pair /sync/info /sync/books /sync/chapters /sync/push。
 */

export interface SyncSummary {
  ok: boolean
  error?: string
  newBooks?: number
  updatedBooks?: number
  deletedBooks?: number
  chaptersFetched?: number
  progressPushed?: number
  at: number
}

interface ServerBook {
  uuid: string
  title: string
  author: string
  format: string
  coverIdx: number
  coverPath: string
  coverUrl?: string
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  sortAt: number
  updatedAt: number
  chaptersRev: number
  lastReadAt?: number
}

function toSyncBookIn(b: ServerBook): SyncBookIn {
  return {
    uuid: b.uuid,
    title: b.title,
    author: b.author,
    format: b.format,
    coverIdx: b.coverIdx,
    coverPath: b.coverPath,
    coverUrl: b.coverUrl,
    progress: b.progress,
    chapterLabel: b.chapterLabel,
    totalChapters: b.totalChapters,
    currentChapter: b.currentChapter,
    sortAt: b.sortAt,
    updatedAt: b.updatedAt,
    chaptersRev: b.chaptersRev,
    lastReadAt: b.lastReadAt
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normAddr(raw: string): string {
  const a = raw.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!/^\S+:\d+$/.test(a)) throw new Error('地址格式应为 IP:端口，例如 192.168.1.100:7380')
  return a
}

async function api<T>(addr: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://${addr}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

export async function pingServer(addrRaw: string): Promise<boolean> {
  const addr = normAddr(addrRaw)
  const r = await api<{ app?: string }>(addr, '/ping')
  return r.app === 'mozhi'
}

/** 手动六位码配对（需同时输入桌面显示的 IP:端口） */
export async function pairManual(addrRaw: string, code: string, deviceName: string): Promise<LanPair> {
  const addr = normAddr(addrRaw)
  const c = code.trim()
  if (!/^\d{6}$/.test(c)) throw new Error('请输入桌面端显示的 6 位数字码')
  const name = deviceName.trim().slice(0, 24) || '手机'
  const r = await api<{ ok: boolean; token: string; deviceName: string }>(addr, '/pair', {
    method: 'POST',
    body: JSON.stringify({ code: c, name })
  })
  if (!r.ok || !r.token) throw new Error('配对失败：码已过期或不正确')
  const pair: LanPair = { addr, token: r.token, deviceName: r.deviceName || name, pairedAt: Date.now() }
  await saveLanPair(pair)
  return pair
}

/** 扫码配对（QR 载荷 {v:1, ip, port, s}） */
export async function pairFromQr(payloadJson: string, deviceName: string): Promise<LanPair> {
  let p: { v?: number; ip?: string; port?: number; s?: string }
  try {
    p = JSON.parse(payloadJson) as typeof p
  } catch {
    throw new Error('二维码内容无法识别')
  }
  if (p.v !== 1 || !p.ip || !p.port || !p.s) throw new Error('这不是墨纸的配对二维码')
  const addr = `${p.ip}:${p.port}`
  const name = deviceName.trim().slice(0, 24) || '手机'
  const r = await api<{ ok: boolean; token: string; deviceName: string }>(addr, '/pair', {
    method: 'POST',
    body: JSON.stringify({ secret: p.s, name })
  })
  if (!r.ok || !r.token) throw new Error('配对失败：二维码已过期')
  const pair: LanPair = { addr, token: r.token, deviceName: r.deviceName || name, pairedAt: Date.now() }
  await saveLanPair(pair)
  return pair
}

export type { LanPair } from './storage'

export async function unpair(): Promise<void> {
  await clearLanPair()
}

export async function getPair(): Promise<LanPair | null> {
  return loadLanPair()
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

/** 完整同步：info → 增量书架 → 变更书整集章节 → 回传进度。幂等，可随时中断重跑。
 *  opts.full=true：覆盖式——游标清零，书架与全部章节从桌面端全量重建（本地阅读进度保留并回传）。 */
export async function runSync(db: SQLiteDatabase, opts?: { full?: boolean }): Promise<SyncSummary> {
  const pair = await loadLanPair()
  if (!pair) return { ok: false, error: '尚未配对桌面端', at: Date.now() }
  const cursors = await loadLanCursors()
  const full = opts?.full === true
  const since = full ? 0 : cursors.since

  const info = await api<{ serverNow: number; books: number; owner?: string }>(
    pair.addr,
    '/sync/info',
    { headers: authHeaders(pair.token) }
  )
  const offset = info.serverNow - Date.now() /* 服务端-本机时钟偏移，回传时校准 */
  if (info.owner) await setCfgValue('desktop_owner', info.owner).catch(() => {})

  if (full || !cursors.firstSyncDone) await clearUnsyncedBooks(db)

  const pull = await api<{ books: ServerBook[]; tombstones: { uuid: string }[]; serverNow: number }>(
    pair.addr,
    `/sync/books?since=${since}`,
    { headers: authHeaders(pair.token) }
  )

  let newBooks = 0
  let updatedBooks = 0
  let chaptersFetched = 0
  const needChapters: ServerBook[] = []

  for (const b of pull.books ?? []) {
    if (!UUID_RE.test(b.uuid)) continue
    const localId = await findLocalBookId(db, b.uuid)
    if (localId == null) newBooks++
    else updatedBooks++
    const id = await upsertSyncBook(db, toSyncBookIn(b))
    const localRev = localId == null ? -1 : await localChaptersRev(db, id)
    if (full || b.chaptersRev !== localRev) needChapters.push(b)
    else if (localId == null) needChapters.push(b) /* 保险：新书必拉章节 */
  }

  for (const b of needChapters) {
    let offset0 = 0
    let first = true
    for (;;) {
      const page = await api<{
        rows: { idx: number; title: string; content: string; deleted: number; dup: number }[]
        total: number
      }>(
        pair.addr,
        `/sync/chapters?uuid=${encodeURIComponent(b.uuid)}&offset=${offset0}&limit=300`,
        { headers: authHeaders(pair.token) }
      )
      const localId = await findLocalBookId(db, b.uuid)
      if (localId == null) break
      await replaceChapters(
        db,
        localId,
        (page.rows ?? []).map((r) => ({
          idx: r.idx,
          title: r.title,
          content: r.content,
          deleted: r.deleted ? 1 : 0,
          dup: r.dup ? 1 : 0
        })),
        { append: !first }
      )
      first = false
      chaptersFetched += (page.rows ?? []).length
      offset0 += (page.rows ?? []).length
      if (offset0 >= page.total || !page.rows?.length) break
    }
  }

  const deletedBooks = await deleteBooksByUuids(
    db,
    (pull.tombstones ?? []).map((t) => t.uuid).filter((u) => UUID_RE.test(u))
  )

  /* 进度回传（updatedAt 用服务端时钟近似，避免本机钟慢被拒） */
  let progressPushed = 0
  const entries = await collectProgressEntries(db, cursors.lastPushAt)
  if (entries.length) {
    const push = await api<{ ok: boolean; applied: number }>(pair.addr, '/sync/push', {
      method: 'POST',
      headers: authHeaders(pair.token),
      body: JSON.stringify({
        entries: entries.map((e) => ({ ...e, updatedAt: e.updatedAt + offset }))
      })
    })
    progressPushed = push.applied ?? 0
  }

  await saveLanCursors({
    since: pull.serverNow,
    lastPushAt: Date.now() + 1,
    firstSyncDone: true,
    lastSyncAt: Date.now()
  })

  return {
    ok: true,
    newBooks,
    updatedBooks,
    deletedBooks,
    chaptersFetched,
    progressPushed,
    at: Date.now()
  }
}

/** 给设置页/自动同步用的一次性格式化 */
export function formatSyncResult(s: SyncSummary): string {
  if (!s.ok) return `同步失败：${s.error ?? '未知错误'}`
  const parts: string[] = []
  if (s.newBooks) parts.push(`新增 ${s.newBooks} 本`)
  if (s.updatedBooks) parts.push(`更新 ${s.updatedBooks} 本`)
  if (s.chaptersFetched) parts.push(`拉取 ${s.chaptersFetched} 章`)
  if (s.deletedBooks) parts.push(`移除 ${s.deletedBooks} 本`)
  if (s.progressPushed) parts.push(`回传进度 ${s.progressPushed} 条`)
  return parts.length ? `同步完成 · ${parts.join(' · ')}` : '同步完成 · 暂无变化'
}
