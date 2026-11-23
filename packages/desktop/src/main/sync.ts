import {
  addPullLog,
  getSource,
  insertArticlesIfNew,
  listSources,
  markSourceFailed,
  markSourcePulled,
  type SourceRow
} from './db'
import { fetchSource } from './feed'
import { logEvent } from './logger'

export interface PullResult {
  ok: boolean
  sourceId: number
  sourceName: string
  added: number
  error?: string
}

export interface SyncProgress {
  done: number
  total: number
  name: string
  finished: boolean
}

const inFlight = new Set<number>()
let progressSink: ((p: SyncProgress) => void) | null = null

/** 渲染层订阅同步进度（index.ts 转发到 webContents.send） */
export function setSyncProgressSink(fn: ((p: SyncProgress) => void) | null): void {
  progressSink = fn
}

function emitProgress(p: SyncProgress): void {
  try {
    progressSink?.(p)
  } catch {
    /* sink 异常不影响拉取 */
  }
}

function pullLabel(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 旧数据/手输可能是裸域名（sspai.com）：net.fetch 会 Failed to parse URL，统一补 scheme */
function normalizeUrl(url: string): string {
  const u = url.trim()
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

/** 拉取单个源（防重入）：fetch → 解析/抽正文 → 去重入库；完成即写同步记录与文件日志 */
export async function pullSource(id: number): Promise<PullResult> {
  const src = getSource(id)
  if (!src) return { ok: false, sourceId: id, sourceName: '', added: 0, error: '源不存在' }
  if (inFlight.has(id))
    return { ok: false, sourceId: id, sourceName: src.name, added: 0, error: '正在拉取中' }
  inFlight.add(id)
  try {
    const items = await fetchSource(normalizeUrl(src.url), src.type)
    const added = insertArticlesIfNew(src, items)
    markSourcePulled(id, added, pullLabel())
    const r = { ok: true, sourceId: id, sourceName: src.name, added }
    addPullLog({ at: pullLabel(), name: src.name, added, ok: true })
    logEvent('sync', 'info', `「${src.name}」拉取成功 +${added}（${normalizeUrl(src.url)}）`)
    return r
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    markSourceFailed(id, pullLabel())
    addPullLog({ at: pullLabel(), name: src.name, added: 0, ok: false, error: err })
    logEvent('sync', 'error', `「${src.name}」拉取失败：${err}（${normalizeUrl(src.url)}）`)
    return { ok: false, sourceId: id, sourceName: src.name, added: 0, error: err }
  } finally {
    inFlight.delete(id)
  }
}

/** 立即拉取全部启用源（stagger 300ms 依次触发），逐源推送进度，返回逐个结果 */
export async function pullAllSources(onEach?: (r: PullResult) => void): Promise<PullResult[]> {
  const enabled = listSources().filter((s) => s.enabled) as SourceRow[]
  logEvent('sync', 'info', `手动拉取全部：${enabled.length} 个启用源`)
  if (enabled.length === 0) {
    /* 没有启用源也要留下行动记录，否则同步记录面板永远空白、用户不知道点击是否生效 */
    addPullLog({ at: pullLabel(), name: '手动拉取全部', added: 0, ok: true, empty: true })
  }
  const results: PullResult[] = []
  let done = 0
  for (const s of enabled) {
    if (done > 0) await new Promise((r) => setTimeout(r, 300)) // stagger 防背靠背
    const r = await pullSource(s.id)
    results.push(r)
    done += 1
    emitProgress({ done, total: enabled.length, name: s.name, finished: done >= enabled.length })
    onEach?.(r)
  }
  return results
}

/* ---------- 定时调度：每 60s 检查到期源 ---------- */

let timer: NodeJS.Timeout | null = null

/** @param initialPull false 时跳过启动首轮（由「启动时拉取」设置控制） */
export function startScheduler(initialPull = true): void {
  if (timer) return
  const tick = (): void => {
    const now = Date.now()
    for (const s of listSources()) {
      if (!s.enabled || s.interval_minutes <= 0) continue
      if (now - s.last_pull_ms >= s.interval_minutes * 60_000) {
        void pullSource(s.id).catch(() => undefined)
      }
    }
  }
  timer = setInterval(tick, 60_000)
  logEvent('sync', 'info', `定时调度已启动（${initialPull ? '含启动首轮' : '跳过启动首轮'}）`)
  if (initialPull) setTimeout(tick, 8_000) // 启动后首轮
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
