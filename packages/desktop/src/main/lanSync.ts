import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import {
  getSetting,
  setSetting,
  listSyncBooks,
  listTombstones,
  listSyncChapters,
  applyPhoneProgress,
  type PhoneProgressEntry
} from './db'
import { logEvent } from './logger'
import { getActiveAccount } from './accounts'

/* ── 配置与设备注册表（settings 表 JSON） ── */

export interface LanSyncConfig {
  enabled: boolean
  port: number
}
export interface LanDevice {
  id: string
  name: string
  tokenHash: string
  createdAt: number
  lastSyncAt: number
}

const KEY_CFG = 'lan_sync'
const KEY_DEV = 'lan_devices'

function readCfg(): LanSyncConfig {
  try {
    const raw = getSetting(KEY_CFG)
    if (raw) {
      const j = JSON.parse(raw) as Partial<LanSyncConfig>
      return { enabled: !!j.enabled, port: Number(j.port) > 0 ? Number(j.port) : 7380 }
    }
  } catch {
    /* fallthrough */
  }
  return { enabled: false, port: 7380 }
}

function readDevices(): LanDevice[] {
  try {
    const raw = getSetting(KEY_DEV)
    if (raw) return JSON.parse(raw) as LanDevice[]
  } catch {
    /* fallthrough */
  }
  return []
}

function writeDevices(list: LanDevice[]): void {
  setSetting(KEY_DEV, JSON.stringify(list))
}

export function getLanConfigView(): { enabled: boolean; port: number; lanIp: string; running: boolean } {
  const c = readCfg()
  return { enabled: c.enabled, port: c.port, lanIp: getLanIp(), running: server !== null }
}

export function listDevicesView(): { id: string; name: string; createdAt: number; lastSyncAt: number }[] {
  return readDevices().map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSyncAt: d.lastSyncAt }))
}

export function saveLanConfig(patch: { enabled?: boolean; port?: number }): { enabled: boolean; port: number; lanIp: string; running: boolean } {
  const cur = readCfg()
  const next: LanSyncConfig = {
    enabled: patch.enabled ?? cur.enabled,
    port: patch.port !== undefined && Number(patch.port) > 0 ? Number(patch.port) : cur.port
  }
  setSetting(KEY_CFG, JSON.stringify(next))
  if (next.enabled) void restartServer()
  else stopServer()
  return getLanConfigView()
}

export function revokeDevice(id: string): void {
  writeDevices(readDevices().filter((d) => d.id !== id))
  logEvent('lan', 'info', `已移除配对设备 ${id}`)
}

/* ── 局域网地址 ── */

export function getLanIp(): string {
  const nets = networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) {
        if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)) return n.address
      }
    }
  }
  return '127.0.0.1'
}

/* ── 配对会话（QR 令牌 + 6 位码，5 分钟有效，单活跃） ── */

interface PairSession {
  secret: string
  code6: string
  expiresAt: number
}
let pairSession: PairSession | null = null
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

export function startPairing(): { secret: string; code: string; ip: string; port: number; expiresAt: number } {
  const c = readCfg()
  const secret = randomBytes(24).toString('base64url')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  pairSession = { secret, code6: code, expiresAt: Date.now() + 5 * 60 * 1000 }
  return { secret, code, ip: getLanIp(), port: c.port, expiresAt: pairSession.expiresAt }
}

function consumePairing(cred: string): boolean {
  if (!pairSession) return false
  if (Date.now() > pairSession.expiresAt) {
    pairSession = null
    return false
  }
  return cred === pairSession.secret || cred === pairSession.code6
}

/* ── HTTP 服务 ── */

let server: Server | null = null
const pairAttempts = new Map<string, { n: number; windowStart: number }>()

function json(res: ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    /* 移动端 web（Expo web）是合法客户端：放开 CORS 供浏览器直连 */
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600'
  })
  res.end(buf)
}

function readBody(req: IncomingMessage, capBytes = 16 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > capBytes) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {})
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function authDevice(req: IncomingMessage): LanDevice | null {
  const h = req.headers.authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  const hash = sha256(m[1].trim())
  return readDevices().find((d) => d.tokenHash === hash) ?? null
}

function touchDevice(id: string): void {
  const list = readDevices()
  const d = list.find((x) => x.id === id)
  if (d) {
    d.lastSyncAt = Date.now()
    writeDevices(list)
  }
}

type OnProgress = () => void
let onProgressApplied: OnProgress | null = null
export function setLanProgressSink(fn: OnProgress | null): void {
  onProgressApplied = fn
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://lan')
  const path = url.pathname.replace(/\/+$/, '') || '/'

  /* CORS 预检（移动端 web fetch 跨源） */
  if (req.method === 'OPTIONS') {
    return json(res, 200, {})
  }

  if (path === '/ping') {
    return json(res, 200, { app: 'mozhi', v: 1 })
  }

  if (path === '/pair' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?'
    const now = Date.now()
    const a = pairAttempts.get(ip) ?? { n: 0, windowStart: now }
    if (now - a.windowStart > 60_000) {
      a.n = 0
      a.windowStart = now
    }
    a.n++
    pairAttempts.set(ip, a)
    if (a.n > 8) return json(res, 429, { ok: false, error: '尝试过于频繁，请一分钟后再试' })

    const body = await readBody(req, 4096)
    const cred = String(body.secret || body.code || '')
    const name = String(body.name || '手机').slice(0, 24)
    if (!consumePairing(cred)) return json(res, 403, { ok: false, error: '配对码无效或已过期' })

    const token = randomBytes(32).toString('base64url')
    const dev: LanDevice = {
      id: randomBytes(6).toString('hex'),
      name,
      tokenHash: sha256(token),
      createdAt: Date.now(),
      lastSyncAt: 0
    }
    const list = readDevices()
    if (list.length >= 8) return json(res, 403, { ok: false, error: '配对设备已达上限' })
    list.push(dev)
    writeDevices(list)
    pairSession = null
    logEvent('lan', 'info', `新设备配对成功：${name}`)
    return json(res, 200, { ok: true, token, deviceName: name, serverNow: Date.now() })
  }

  const dev = authDevice(req)
  if (!dev) return json(res, 401, { ok: false, error: 'unauthorized' })

  if (path === '/sync/info' && req.method === 'GET') {
    const books = listSyncBooks(0)
    return json(res, 200, {
      ok: true,
      serverNow: Date.now(),
      books: books.length,
      device: dev.name,
      owner: getActiveAccount()?.name ?? ''
    })
  }

  if (path === '/sync/books' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0) || 0
    touchDevice(dev.id)
    return json(res, 200, {
      ok: true,
      serverNow: Date.now(),
      books: listSyncBooks(since),
      tombstones: listTombstones(since)
    })
  }

  if (path === '/sync/chapters' && req.method === 'GET') {
    const uuid = String(url.searchParams.get('uuid') || '')
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0) || 0)
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 300) || 300))
    if (!/^[0-9a-f-]{10,40}$/i.test(uuid)) return json(res, 400, { ok: false, error: 'bad uuid' })
    const r = listSyncChapters(uuid, offset, limit)
    touchDevice(dev.id)
    return json(res, 200, { ok: true, offset, limit, ...r })
  }

  if (path === '/sync/push' && req.method === 'POST') {
    const body = await readBody(req)
    const entries = Array.isArray(body.entries) ? (body.entries as PhoneProgressEntry[]) : []
    const clean = entries
      .filter((e) => e && typeof e.uuid === 'string' && /^[0-9a-f-]{10,40}$/i.test(e.uuid))
      .slice(0, 2000)
      .map((e) => ({
        uuid: e.uuid,
        progress: Number(e.progress) || 0,
        currentChapter: Number(e.currentChapter) || 0,
        chapterLabel: String(e.chapterLabel || '').slice(0, 40),
        updatedAt: Number(e.updatedAt) || 0
      }))
    const r = applyPhoneProgress(clean)
    touchDevice(dev.id)
    logEvent('lan', 'info', `${dev.name} 推送进度：${r.applied} 应用 / ${r.rejected} 跳过`)
    if (r.applied > 0) onProgressApplied?.()
    return json(res, 200, { ok: true, ...r })
  }

  return json(res, 404, { ok: false, error: 'not found' })
}

export async function restartServer(): Promise<void> {
  stopServer()
  const c = readCfg()
  if (!c.enabled) return
  await new Promise<void>((resolve) => {
    const s = createServer((req, res) => {
      handle(req, res).catch((e) => {
        try {
          json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
        } catch {
          /* response gone */
        }
      })
    })
    s.on('error', (e) => {
      logEvent('lan', 'error', `同步服务启动失败：${e.message}`)
      server = null
      resolve()
    })
    s.listen(c.port, '0.0.0.0', () => {
      server = s
      logEvent('lan', 'info', `局域网同步服务已启动：0.0.0.0:${c.port}（IP ${getLanIp()}）`)
      resolve()
    })
  })
}

export function stopServer(): void {
  if (server) {
    const s = server
    server = null
    try {
      s.closeAllConnections?.()
      s.close()
    } catch {
      /* already closed */
    }
    logEvent('lan', 'info', '局域网同步服务已停止')
  }
}
