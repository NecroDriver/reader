/**
 * 小说抓取作业管理：限速逐章、暂停/继续、断点续抓、增量更新（防复活/防覆盖）。
 * db 依赖经 setNovelDb 注入（避免循环 import）；进度经 setNovelProgressSink 推给渲染层。
 */
import { crawlDelay, dropTitlePara, fetchChapterParagraphs, normalizeChapterTitle, paragraphsToContent, parseTocPages } from './novel'
import { logEvent } from './logger'

export interface NovelJobState {
  bookId: number
  status: 'running' | 'paused' | 'idle' | 'error'
  done: number
  total: number
  currentTitle: string
  error?: string
}

const jobs = new Map<number, NovelJobState>()
const pauseFlags = new Set<number>()

/** 全部作业作废（账号退出 / 云恢复换库前调用）：先暂停再清空 */
export function resetNovelJobs(): void {
  for (const id of jobs.keys()) pauseNovel(id)
  jobs.clear()
  pauseFlags.clear()
}

export function getJob(bookId: number): NovelJobState {
  return jobs.get(bookId) ?? { bookId, status: 'idle', done: 0, total: 0, currentTitle: '' }
}

export interface NovelDbApi {
  getNovelSource(bookId: number): { tocUrl: string; cursorUrl: string } | null
  listChapterUrls(bookId: number): { url: string; deleted: number; hasContent: number }[]
  appendChapters(bookId: number, items: { url: string; title: string; content: string }[], startIndex: number): void
  countChapters(bookId: number): number
  getChapterIdxByUrl(bookId: number, url: string): number | null
  insertCrawledChapter(bookId: number, atIdx: number, url: string, title: string, content: string): void
  updateNovelProgress(bookId: number, cursorUrl: string, fetched: number, total: number, status: string): void
  setBookChapterCount(bookId: number): void
  listOnlineBookIds(): number[]
}
let dbApi: NovelDbApi | null = null
export function setNovelDb(api: NovelDbApi): void {
  dbApi = api
}

let progressSink: ((bookId: number, s: NovelJobState) => void) | null = null
export function setNovelProgressSink(fn: (bookId: number, s: NovelJobState) => void): void {
  progressSink = fn
}

function emit(bookId: number): void {
  const s = jobs.get(bookId)
  if (s && progressSink) progressSink(bookId, s)
}

/**
 * 抓取主循环（全量与增量统一入口）：
 * 1. 重解析目录页 → 最新章节 URL 序列
 * 2. 过滤：已存在且有内容（防覆盖）、已软删（防复活）
 * 3. 逐章限速抓取；单章失败重试 3 次后跳过
 */
export async function crawlNovel(bookId: number): Promise<NovelJobState> {
  if (!dbApi) throw new Error('novel db not ready')
  const src = dbApi.getNovelSource(bookId)
  if (!src) throw new Error('not a novel book')
  const state: NovelJobState = { bookId, status: 'running', done: 0, total: 0, currentTitle: '' }
  jobs.set(bookId, state)

  try {
    const toc = await parseTocPages(src.tocUrl)
    const tocUrls = new Set(toc.chapters.map((c) => c.url))
    const tocPos = new Map(toc.chapters.map((c, i) => [c.url, i]))
    const existing = new Map(dbApi.listChapterUrls(bookId).map((c) => [c.url, c]))
    const todo: { url: string; title: string }[] = []
    for (const ch of toc.chapters) {
      const ex = existing.get(ch.url)
      if (ex && (ex.deleted || ex.hasContent)) continue
      todo.push({ url: ch.url, title: normalizeChapterTitle(ch.title) })
    }
    state.total = todo.length
    state.done = 0
    logEvent('novel', 'info', `开始检查/抓取 book=${bookId}：目录 ${toc.chapters.length} 章，待抓 ${todo.length} 章`)
    emit(bookId)

    /**
     * 新章落位：优先「按目录顺序插回」（gap 回填，如旧库缺第一章）——
     * 在目录中向后找第一个已入库的章作为锚点，插到它前面；找不到锚点（新尾巴章）追加到末尾。
     */
    const api = dbApi
    const insertAt = (url: string): number | null => {
      const pos = tocPos.get(url)
      if (pos === undefined) return null
      for (let j = pos + 1; j < toc.chapters.length && j <= pos + 50; j++) {
        const anchor = api.getChapterIdxByUrl(bookId, toc.chapters[j].url)
        if (anchor !== null) return anchor
      }
      return null
    }

    for (let i = 0; i < todo.length; i++) {
      if (pauseFlags.has(bookId)) {
        state.status = 'paused'
        dbApi.updateNovelProgress(bookId, '', state.done, state.total, 'paused')
        emit(bookId)
        return state
      }
      const ch = todo[i]
      state.currentTitle = ch.title
      let content = ''
      for (let attempt = 0; attempt < 3 && !content; attempt++) {
        try {
          if (attempt > 0) await crawlDelay()
          content = paragraphsToContent(dropTitlePara(ch.title, await fetchChapterParagraphs(ch.url, tocUrls)))
        } catch {
          /* 重试 */
        }
      }
      if (content) {
        const at = insertAt(ch.url)
        if (at !== null) {
          dbApi.insertCrawledChapter(bookId, at, ch.url, ch.title, content)
        } else {
          dbApi.appendChapters(bookId, [{ url: ch.url, title: ch.title, content }], dbApi.countChapters(bookId))
        }
        state.done++
        dbApi.updateNovelProgress(bookId, ch.url, state.done, state.total, 'running')
      }
      emit(bookId)
      if (i < todo.length - 1) await crawlDelay()
    }
    state.status = 'idle'
    state.currentTitle = ''
    dbApi.updateNovelProgress(bookId, '', state.done, state.total, 'idle')
    dbApi.setBookChapterCount(bookId)
    logEvent('novel', 'info', `抓取完成 book=${bookId}：新增 ${state.done} 章`)
    emit(bookId)
    return state
  } catch (e) {
    state.status = 'error'
    state.error = e instanceof Error ? e.message : String(e)
    dbApi.updateNovelProgress(bookId, '', state.done, state.total, 'error')
    logEvent('novel', 'error', `抓取失败 book=${bookId}：${state.error ?? ''}`)
    emit(bookId)
    return state
  }
}

export function pauseNovel(bookId: number): void {
  pauseFlags.add(bookId)
}

/**
 * 确保这本书在抓：running 直接返回现状；paused/idle/未启动（含应用重启后 jobs 为空）
 * 都启动一轮增量检查。「更新图书」按钮与打开时的自动检查都走这里。
 */
export function resumeNovel(bookId: number): NovelJobState {
  pauseFlags.delete(bookId)
  const s = jobs.get(bookId)
  if (s && s.status === 'running') return s
  // 立即回一个 running 占位，让 UI 马上有进度态；真实状态随后经 emit 推送
  const placeholder: NovelJobState = { bookId, status: 'running', done: s?.done ?? 0, total: s?.total ?? 0, currentTitle: '正在检查目录…' }
  jobs.set(bookId, placeholder)
  emit(bookId)
  void crawlNovel(bookId)
  return placeholder
}

export function isRunning(bookId: number): boolean {
  return jobs.get(bookId)?.status === 'running'
}

export interface UpdateAllResult {
  checked: number
  updatedBooks: number
  addedChapters: number
}

/**
 * 「更新全部」：对每一本在线小说做一轮增量检查（串行，避免并发请求风暴）。
 * 每本书经 resumeNovel 的 ensure-crawl 语义：已是 running 的跳过等待，其余立即检查目录。
 * 进度仍走 setNovelProgressSink → 同步记录实时条目。
 */
export async function updateAllNovels(): Promise<UpdateAllResult> {
  if (!dbApi) throw new Error('novel db not ready')
  const ids = dbApi.listOnlineBookIds()
  const result: UpdateAllResult = { checked: 0, updatedBooks: 0, addedChapters: 0 }
  for (const id of ids) {
    // 已在抓的书不重复启动（避免同书并发），等它自然收敛即可
    if (isRunning(id)) {
      result.checked++
      continue
    }
    try {
      const s = await crawlNovel(id)
      result.checked++
      if (s.done > 0) {
        result.updatedBooks++
        result.addedChapters += s.done
      }
    } catch (e) {
      logEvent('novel', 'error', `updateAll book=${id} 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}
