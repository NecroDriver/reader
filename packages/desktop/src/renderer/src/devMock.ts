/**
 * 浏览器直开 dev server（无 Electron preload）时的 mock。
 * 仅 import.meta.env.DEV 使用：完整模拟 window.mozhi，
 * 让 Playwright 能在 http://localhost:5173/ 验证渲染管线。
 * 进度存内存（刷新即重置，测试中可通过 window.__mockProg 查看）。
 */
import type { NovelJobState, OpenedBook, Shelf } from './types'

/* preload LanPairView 的内联等价（renderer 不能直接 import preload） */
interface LanPair {
  ip: string
  port: number
  code: string
  expiresAt: number
  qrSvg: string
  payload: string
}

const EPUB_TOC = [
  '冬阳·童年·骆驼队',
  '惠安馆',
  '我们看海去',
  '兰姨娘',
  '爸爸的花儿落了，我也不再是小孩子'
]

type Prog = { idx: number; pct: number; label: string; cfi: string }
const prog = new Map<number, Prog>()
/* 201 压测书的章节管理模拟（重命名/删除） */
const renames201 = new Map<number, string>()
const deleted201 = new Set<number>()
let lastSync = '14:32'
const pullLogs: {
  at: string
  name: string
  added: number
  ok: boolean
  error?: string
  empty?: boolean
  note?: string
  kind?: 'novel'
  bookId?: number
  running?: boolean
  paused?: boolean
  done?: number
  total?: number
}[] = [
  { at: '15:02', name: '墨与纸(模拟·在线抓取)', added: 3, ok: true, kind: 'novel', bookId: 301 },
  { at: '14:32', name: '阮一峰周刊', added: 3, ok: true },
  { at: '13:04', name: '失效测试源', added: 0, ok: false, error: 'HTTP 404 Not Found' }
]
const syncLogListeners: (() => void)[] = []

/* 模拟小说书（id=301）：12 章，第 6 章与第 5 章内容相同（查重用例） */
interface MockChapter {
  idx: number
  title: string
  content: string
  deleted: boolean
  dup: boolean
}
function mockNovelSeed(): MockChapter[] {
  const out: MockChapter[] = [{ idx: 0, title: '开篇', content: '《墨与纸》作者：墨纸工坊\n一个关于小说抓取的模拟故事。', deleted: false, dup: false }]
  for (let i = 1; i <= 11; i++) {
    // 第2章：正文首行完整重复章题（元始法则式）；第3章：首行剥掉「第X章」前缀只重复正题
    const dupTitle = i === 2 ? [`第${i}章 试验场的清晨`] : i === 3 ? ['试验场的清晨'] : []
    out.push({
      idx: i,
      title: `第${i}章 试验场的清晨`,
      content: [...dupTitle, ...Array.from({ length: 8 }, (_, k) => `第${i}章第${k + 1}段：少年推开木门，纸页在风里翻动，墨香混着晨雾涌进来。`)].join('\n'),
      deleted: false,
      dup: false
    })
  }
  // 第 6 章与第 5 章内容相同（站点重复上传用例）
  out[6].content = out[5].content
  return out
}
let novelChapters: MockChapter[] = mockNovelSeed()
/* 预置 301 书读到第 3 章（idx=2）40%：演示书架「N 章未读」 */
prog.set(301, { idx: 2, pct: 40, label: '第3章 校对室之夜', cfi: '' })
let novelJobState: NovelJobState | null = null
let novelPaused = false
const novelProgressListeners: ((s: NovelJobState) => void)[] = []

/** 模拟抓取：existing 章数起，每 350ms 抓 1 章，可暂停 */
function mockCrawl(startAt: number, total: number): void {
  if (novelJobState && novelJobState.status === 'running') return
  novelPaused = false
  novelJobState = { bookId: 301, status: 'running', done: startAt, total, currentTitle: '' }
  emitNovel()
  const tick = (): void => {
    if (!novelJobState || novelJobState.status !== 'running') return
    if (novelPaused) {
      novelJobState = { ...novelJobState, status: 'paused' }
      emitNovel()
      return
    }
    const done = novelJobState.done + 1
    novelJobState = { ...novelJobState, done, currentTitle: novelChapters[Math.min(done, novelChapters.length - 1)]?.title ?? '' }
    emitNovel()
    if (done >= total) {
      novelJobState = { ...novelJobState, status: 'idle', currentTitle: '' }
      emitNovel()
      mockShelfListeners.forEach((cb) => cb())
      return
    }
    setTimeout(tick, 350)
  }
  setTimeout(tick, 350)
}
function emitNovel(): void {
  if (!novelJobState) return
  novelProgressListeners.forEach((cb) => cb(novelJobState as NovelJobState))
  // 镜像主进程：抓取状态写入同步记录（唯一活条目带进度）并广播刷新
  const s = novelJobState
  const live = s.status === 'running' || s.status === 'paused'
  let e = pullLogs.find((x) => x.kind === 'novel' && x.bookId === s.bookId && (x.running || x.paused))
  if (live) {
    if (!e) {
      const d0 = new Date()
      e = {
        at: `${String(d0.getHours()).padStart(2, '0')}:${String(d0.getMinutes()).padStart(2, '0')}`,
        name: '墨与纸(模拟·在线抓取)',
        added: 0,
        ok: true
      }
      pullLogs.unshift(e)
    }
    e.kind = 'novel'
    e.bookId = s.bookId
    e.running = s.status === 'running'
    e.paused = s.status === 'paused'
    e.done = s.done
    e.total = s.total
    e.ok = true
  } else if (e) {
    if (s.status !== 'error' && s.total === 0) {
      // 镜像主进程：自动检查没有新章节 → 静默撤掉条目
      const i = pullLogs.indexOf(e)
      if (i >= 0) pullLogs.splice(i, 1)
    } else if (s.status === 'error') {
      e.running = false
      e.paused = false
      e.ok = false
      e.error = s.error
    } else {
      e.running = false
      e.paused = false
      e.done = s.done
      e.total = s.total
      e.ok = true
      e.added = s.done
    }
  }
  if (pullLogs.length > 30) pullLogs.length = 30
  syncLogListeners.forEach((cb) => cb())
}

;(window as unknown as { __mockProg: Map<number, Prog> }).__mockProg = prog

/* 书架删除模拟：软删书 id，shelf() 过滤 */
const deletedBooks = new Set<number>()
const mockBookEdits = new Map<number, { title?: string; author?: string; downloadUrl?: string }>()
const mockCovers = new Map<number, string>()

function shelf(): Shelf {
  return {
    books: [
      { id: 301, title: '墨与纸(模拟·在线抓取)', author: '墨纸工坊', format: 'NOVEL', coverIdx: 1, progress: prog.get(301)?.pct ?? 0, chapterLabel: prog.get(301)?.label ?? '', totalChapters: novelChapters.filter((c) => !c.deleted).length, currentChapter: prog.get(301)?.idx ?? 0, originPath: '' },
      { id: 101, title: '城南旧事·节选', author: '林海音', format: 'EPUB', coverIdx: 2, progress: prog.get(101)?.pct ?? 0, chapterLabel: prog.get(101)?.label ?? '', totalChapters: 0, currentChapter: 0, originPath: 'mock://test-nancheng.epub' },
      { id: 201, title: '无限进化(模拟·压测)', author: '不冷', format: 'TXT', coverIdx: 0, progress: prog.get(201)?.pct ?? 0, chapterLabel: prog.get(201)?.label ?? '', totalChapters: 3287, currentChapter: 0, originPath: 'mock://big.txt' },
      { id: 102, title: '墨纸测试文选', author: '墨纸工坊', format: 'PDF', coverIdx: 3, progress: prog.get(102)?.pct ?? 0, chapterLabel: prog.get(102)?.label ?? '', totalChapters: 3, currentChapter: prog.get(102)?.idx ?? 0, originPath: 'mock://test-mozhi.pdf' },
      { id: 1, title: '朝花夕拾', author: '鲁迅', format: 'EPUB', coverIdx: 1, progress: 62, chapterLabel: '第三章', totalChapters: 0, currentChapter: 0, originPath: '' },
      { id: 2, title: '呐喊', author: '鲁迅', format: 'EPUB', coverIdx: 0, progress: 0, chapterLabel: '', totalChapters: 0, currentChapter: 0, originPath: '' },
      { id: 3, title: '世说新语', author: '刘义庆', format: 'EPUB', coverIdx: 3, progress: 0, chapterLabel: '', totalChapters: 0, currentChapter: 0, originPath: '' },
      { id: 4, title: '浮生六记', author: '沈复', format: 'EPUB', coverIdx: 4, progress: 100, chapterLabel: '卷六', totalChapters: 0, currentChapter: 0, originPath: '' }
    ].filter((b) => !deletedBooks.has(b.id)).map((b) => {
      const e = mockBookEdits.get(b.id)
      const cover = mockCovers.get(b.id)
      return {
        ...b,
        title: e?.title ?? b.title,
        author: e?.author ?? b.author,
        coverPath: cover ?? ''
      }
    }),
    lastSyncAt: lastSync
  }
}

function openBook(id: number): OpenedBook | null {
  if (id === 301) {
    const p = prog.get(301)
    const alive = novelChapters.filter((c) => !c.deleted)
    return {
      id: 301,
      title: '墨与纸(模拟·在线抓取)',
      author: '墨纸工坊',
      format: 'NOVEL',
      totalChapters: alive.length,
      currentChapter: p?.idx ?? 0,
      progress: p?.pct ?? 0,
      cfi: '',
      toc: alive.map((c) => ({ idx: c.idx, title: c.title, dup: c.dup }))
    }
  }
  if (id === 201) {
    const p = prog.get(201)
    const raw = Array.from({ length: 3287 }, (_, i) => i).filter((i) => !deleted201.has(i))
    return {
      id: 201,
      title: '无限进化(模拟·压测)',
      author: '不冷',
      format: 'TXT',
      totalChapters: raw.length,
      currentChapter: p?.idx ?? 0,
      progress: p?.pct ?? 0,
      cfi: '',
      toc: raw.map((i) => ({
        idx: i,
        title: renames201.get(i) ?? (i === 0 ? '开篇' : `第${i}章 压测章节标题第${i}小节`),
        dup: false
      }))
    }
  }
  if (id === 101) {
    const p = prog.get(101)
    return {
      id: 101,
      title: '城南旧事·节选',
      author: '林海音',
      format: 'EPUB',
      totalChapters: 0,
      currentChapter: 0,
      progress: p?.pct ?? 0,
      cfi: p?.cfi ?? '',
      toc: EPUB_TOC.map((t, i) => ({ idx: i, title: t, dup: false }))
    }
  }
  if (id === 102) {
    const p = prog.get(102)
    return {
      id: 102,
      title: '墨纸测试文选',
      author: '墨纸工坊',
      format: 'PDF',
      totalChapters: 3,
      currentChapter: p?.idx ?? 0,
      progress: p?.pct ?? 0,
      cfi: '',
      toc: [1, 2, 3].map((i) => ({ idx: i, title: `第 ${i} 页`, dup: false }))
    }
  }
  return null
}

/** 模拟「更新全部小说」：检查在线书（format NOVEL），1.8s 后返回新增章节数并写同步记录 */
async function mockUpdateAllNovels(): Promise<{ checked: number; updatedBooks: number; addedChapters: number }> {
  const online = shelf().books.filter((b) => b.format === 'NOVEL')
  await new Promise((r) => setTimeout(r, 1800))
  const d = new Date()
  const pad = (x: number): string => String(x).padStart(2, '0')
  const at = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  lastSync = at
  const added = online.length > 0 ? 3 : 0
  for (const b of online.slice(0, 2)) {
    pullLogs.unshift({
      at,
      name: b.title,
      added: added > 0 ? Math.max(1, Math.round(added / Math.max(1, online.slice(0, 2).length))) : 0,
      ok: true,
      kind: 'novel',
      bookId: b.id
    })
  }
  if (pullLogs.length > 30) pullLogs.length = 30
  /* 与主进程 logUpdateAllResult 对齐：手动「更新全部」留汇总行 */
  const note =
    online.length === 0
      ? '没有在线小说'
      : added > 0
        ? `${online.length} 本有更新 · 新增 ${added} 章`
        : `已检查 ${online.length} 本 · 无新章节`
  pullLogs.unshift({ at, name: '更新全部', added, ok: true, note })
  if (pullLogs.length > 30) pullLogs.length = 30
  syncLogListeners.forEach((cb) => cb())
  mockShelfListeners.forEach((cb) => cb())
  return { checked: online.length, updatedBooks: added > 0 ? online.length : 0, addedChapters: added }
}

export function setupDevMock(): void {
  if (window.mozhi) return
  window.mozhi = {
    getShelf: () => Promise.resolve(shelf()),
    searchStore: (siteId: string, keyword: string) => {
      const kws = keyword.trim()
      if (!kws) {
        return Promise.resolve({ ok: false, error: '请输入书名或作者' })
      }
      const mk = (title: string, author: string, status: string, category: string, latest: string, n: number, chapters: number) => {
        const tocUrl = `https://www.suduguu.com/${n}/`
        mockStoreBooks.set(tocUrl, { title, author, chapters })
        return { siteId, siteName: '速读谷', title, author, status, category, latestChapter: latest, tocUrl, coverUrl: '' }
      }
      return new Promise((resolve) => {
        window.setTimeout(() => {
          resolve({
            ok: true,
            results: kws.includes('剑')
              ? [mk('借剑', '黑山老鬼', '连载中', '仙侠', '第两千零一章 一剑光寒', 55, 2001), mk('剑来', '烽火戏诸侯', '连载中', '仙侠', '第一千一百二十章 山巅', 77, 1120)]
              : kws.includes('元始')
                ? [mk('元始法则', '飞天鱼', '连载中', '玄幻', '第一千三百三十六章 南宫雨', 6, 1336)]
                : kws.includes('万夜')
                  ? []
                  : [mk(`${kws}·示例甲`, '墨纸工坊', '已完结', '玄幻', '完本 · 共 1200 章', 101, 1200), mk(`${kws}·示例乙`, '一柄墨刀', '连载中', '都市', '第六百章 夜色', 102, 600)]
          })
        }, 700)
      })
    },
    listStoreSites: () => Promise.resolve([{ id: 'suduguu', name: '速读谷', home: 'https://www.suduguu.com' }]),
    listReadHistory: () =>
      Promise.resolve(
        shelf()
          .books.filter((b) => b.progress > 0)
          .map((b) => {
            const i = (b.id * 47) % 11
            const lastReadAt = Date.now() - i * 3600000 - (b.id % 3) * 600000
            return {
              id: b.id,
              title: b.title,
              author: b.author,
              format: b.format,
              coverIdx: b.coverIdx,
              originPath: b.originPath,
              progress: b.progress,
              chapterLabel: b.chapterLabel,
              totalChapters: b.totalChapters,
              currentChapter: b.currentChapter,
              lastReadAt
            }
          })
          .sort((a, b) => b.lastReadAt - a.lastReadAt)
      ),
    openBook: (id: number) => Promise.resolve(openBook(id)),
    deleteBook: (bookId: number) => {
      deletedBooks.add(bookId)
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve()
    },
    getBookDetail: (bookId: number) => {
      const b = shelf().books.find((x) => x.id === bookId)
      if (!b) return Promise.resolve(null)
      const tocUrl = bookId === 301 ? 'https://example.com/novel/mozhi-paper' : ''
      const chapterCount =
        bookId === 301
          ? novelChapters.filter((c) => !c.deleted).length
          : bookId === 201
            ? 3287
            : b.totalChapters
      return Promise.resolve({
        id: b.id,
        title: b.title,
        author: b.author,
        format: b.format,
        coverIdx: b.coverIdx,
        coverPath: mockCovers.get(bookId) ?? '',
        downloadUrl: tocUrl,
        originPath: b.originPath.startsWith('mock://') ? `D:\\Books\\${b.originPath.slice(7)}` : b.originPath,
        tocUrl,
        progress: b.progress,
        chapterLabel: b.chapterLabel,
        totalChapters: b.totalChapters,
        chapterCount,
        createdAt: '2026-11-20 10:24'
      })
    },
    updateBook: (bookId: number, patch: { title?: string; author?: string; downloadUrl?: string }) => {
      const cur = mockBookEdits.get(bookId) ?? {}
      mockBookEdits.set(bookId, { ...cur, ...patch })
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve(true)
    },
    pickCover: (bookId: number) => {
      /* 浏览器无法弹原生对话框：直接落到 public 测试图 */
      mockCovers.set(bookId, '/test-cover.png')
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve({ ok: true, name: '/test-cover.png' })
    },
    clearCover: (bookId: number) => {
      mockCovers.delete(bookId)
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve(true)
    },
    readBookFile: (id: number) => {
      const url = id === 101 ? '/test-nancheng.epub' : id === 102 ? '/test-mozhi.pdf' : null
      if (!url) return Promise.resolve(null)
      return fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`)
          return r.arrayBuffer()
        })
        .then((data) => ({ format: id === 101 ? 'EPUB' : 'PDF', data }))
    },
    getChapter: (id: number, idx: number) => {
      if (id === 301) {
        const c = novelChapters.find((x) => x.idx === idx && !x.deleted)
        return Promise.resolve(c ? { idx, title: c.title, content: c.content } : null)
      }
      if (id === 201) {
        const title = idx === 0 ? '开篇' : `第${idx}章 压测章节标题第${idx}小节`
        const body = idx === 0
          ? '《无限进化》作者：不冷\n数百年前，代号为“T”的生物病毒为人类文明开启了毁灭之门。\n而这，正是一个发生在混乱纪元的故事。'
          : Array.from({ length: 30 }, (_, i) => `这是第 ${idx} 章的第 ${i + 1} 段正文，用于压测渲染与滚动性能。蚂蚁力量，螳螂之刃，飞蝗之翼，甲虫之铠。`).join('\n')
        return Promise.resolve({ idx, title, content: body })
      }
      return Promise.resolve(openBook(id)?.toc[idx] ? { idx, title: openBook(id)!.toc[idx].title, content: '（浏览器样例无章正文）' } : null)
    },
    saveProgress: (id: number, idx: number, pct: number, label: string, cfi = '') => {
      prog.set(id, { idx, pct: Math.min(100, Math.max(0, pct)), label, cfi })
      console.log('[devMock] saveProgress', { id, idx, pct, label, cfi: cfi.slice(0, 40) })
      return Promise.resolve()
    },
    importPaths: () => Promise.resolve([]),
    pickAndImport: () => Promise.resolve([]),
    pathForFile: () => '',
    updateAllNovels: () => mockUpdateAllNovels(),
    getPullLogs: () => Promise.resolve(pullLogs.slice()),
    getSettings: () =>
      Promise.resolve({
        autostart: mockSettings.autostart,
        closeToTray: mockSettings.closeToTray,
        pullOnStart: mockSettings.pullOnStart,
        bossKey: mockBossKey,
        bossKeyCustom: mockBossKeyCustom
      }),
    setBossKey: (accel: string) => {
      mockBossKey = accel
      mockBossKeyCustom = true
      console.log('[devMock] setBossKey', accel)
      return Promise.resolve({ key: accel, custom: true, ok: true })
    },
    resetBossKey: () => {
      mockBossKey = 'CommandOrControl+Shift+M'
      mockBossKeyCustom = false
      console.log('[devMock] resetBossKey')
      return Promise.resolve({ key: mockBossKey, custom: false, ok: true })
    },
    setSetting: (key: 'autostart' | 'close_to_tray' | 'pull_on_start', value: boolean) => {
      if (key === 'autostart') mockSettings.autostart = value
      else if (key === 'close_to_tray') mockSettings.closeToTray = value
      else mockSettings.pullOnStart = value
      console.log('[devMock] setSetting', key, value)
      return Promise.resolve()
    },
    getDataDirInfo: () =>
      Promise.resolve({ current: mockDataDir, defaultDir: 'C:\\Users\\you\\AppData\\Roaming\\墨纸 Mozhi Reader', custom: mockDataDirCustom }),
    pickDataDir: () => {
      mockDataDirCustom = 'D:\\MozhiData'
      mockDataDir = mockDataDirCustom
      console.log('[devMock] pickDataDir →', mockDataDir)
      return Promise.resolve({ canceled: false as const, dir: mockDataDir })
    },
    resetDataDir: () => {
      mockDataDirCustom = null
      mockDataDir = 'C:\\Users\\you\\AppData\\Roaming\\墨纸 Mozhi Reader'
      return Promise.resolve(true)
    },
    getLogDir: () => Promise.resolve('C:\\Users\\you\\AppData\\Roaming\\墨纸 Mozhi Reader\\logs'),
    openLogDir: () => {
      console.log('[devMock] openLogDir（真实环境会打开资源管理器）')
      return Promise.resolve('')
    },
    onShelfChanged: (cb: () => void) => {
      mockShelfListeners.push(cb)
      return () => {
        const i = mockShelfListeners.indexOf(cb)
        if (i >= 0) mockShelfListeners.splice(i, 1)
      }
    },

    /* 在线小说（mock） */
    createNovel: (tocUrl: string) => {
      if (!/^https?:\/\//i.test(tocUrl)) {
        return Promise.resolve({ ok: false, error: '地址格式不正确' })
      }
      const known = mockStoreBooks.get(tocUrl)
      if (known) {
        novelChapters = mockNovelSeed()
        novelJobState = null
        mockCrawl(0, novelChapters.length)
        return Promise.resolve({ ok: true, bookId: 301, title: known.title, author: known.author, chapters: known.chapters })
      }
      novelChapters = mockNovelSeed()
      novelJobState = null
      mockCrawl(0, novelChapters.length)
      return Promise.resolve({ ok: true, bookId: 301, title: '墨与纸(模拟·在线抓取)', author: '墨纸工坊', chapters: novelChapters.length })
    },
    pauseNovel: (bookId: number) => {
      if (bookId !== 301) return Promise.resolve(null)
      novelPaused = true
      return Promise.resolve(novelJobState)
    },
    resumeNovel: (bookId: number) => {
      if (bookId !== 301) return Promise.resolve(null)
      const done = novelJobState?.done ?? 0
      const total = novelJobState?.total ?? novelChapters.length
      if (done >= total) {
        // 模拟「已是最新」：不再自动新增章节，直接 idle 收尾（真实链路里更新完成 toast 由 ReaderView 发）
        novelJobState = { bookId: 301, status: 'idle', done: total, total, currentTitle: '' }
        window.setTimeout(() => {
          novelProgressListeners.forEach((cb) => cb(novelJobState as NovelJobState))
        }, 600)
        return Promise.resolve(novelJobState)
      }
      mockCrawl(done, total)
      return Promise.resolve(novelJobState)
    },
    novelStatus: (bookId: number) => {
      if (bookId !== 301) return Promise.resolve(null)
      if (!novelJobState) {
        novelJobState = { bookId: 301, status: 'idle', done: novelChapters.length, total: novelChapters.length, currentTitle: '' }
      }
      return Promise.resolve(novelJobState)
    },
    recrawlNovel: (bookId: number) => {
      if (bookId !== 301) return Promise.resolve(null)
      novelChapters = mockNovelSeed()
      novelPaused = false
      novelJobState = null
      mockCrawl(0, novelChapters.length)
      return Promise.resolve(novelJobState)
    },
    renameNovel: async () => true,
    exportNovel: (bookId: number, encoding: 'utf-8' | 'gbk') => {
      const alive = novelChapters.filter((c) => !c.deleted)
      console.log('[devMock] exportNovel', { bookId, encoding, chapters: alive.length })
      return Promise.resolve({ canceled: false as const, path: `D:\\Downloads\\墨与纸(${encoding}).txt` })
    },
    onNovelProgress: (cb: (s: NovelJobState) => void) => {
      novelProgressListeners.push(cb)
      return () => {
        const i = novelProgressListeners.indexOf(cb)
        if (i >= 0) novelProgressListeners.splice(i, 1)
      }
    },
    onSyncLogChanged: (cb: () => void) => {
      syncLogListeners.push(cb)
      return () => {
        const i = syncLogListeners.indexOf(cb)
        if (i >= 0) syncLogListeners.splice(i, 1)
      }
    },

    /* 章节管理（mock） */
    insertChapter: (bookId: number, atIdx: number, title: string, content: string) => {
      if (bookId !== 301) return Promise.resolve(-1)
      novelChapters = novelChapters.map((c) => (c.idx >= atIdx ? { ...c, idx: c.idx + 1 } : c))
      novelChapters.push({ idx: atIdx, title: title.slice(0, 60), content, deleted: false, dup: false })
      novelChapters.sort((a, b) => a.idx - b.idx)
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve(atIdx)
    },
    renameChapter: (bookId: number, idx: number, title: string) => {
      if (bookId === 201) {
        renames201.set(idx, title.slice(0, 60))
        return Promise.resolve(true)
      }
      if (bookId !== 301) return Promise.resolve(false)
      const c = novelChapters.find((x) => x.idx === idx)
      if (c) c.title = title.slice(0, 60)
      console.log('[devMock] renameChapter', idx, title)
      return Promise.resolve(true)
    },
    deleteChapter: (bookId: number, idx: number) => {
      if (bookId === 201) {
        deleted201.add(idx)
        mockShelfListeners.forEach((cb) => cb())
        return Promise.resolve(true)
      }
      if (bookId !== 301) return Promise.resolve(false)
      novelChapters = novelChapters.map((c) => (c.idx === idx ? { ...c, deleted: true } : c))
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve(true)
    },
    editChapterContent: (bookId: number, idx: number, content: string) => {
      if (bookId !== 301) return Promise.resolve(false)
      const c = novelChapters.find((x) => x.idx === idx)
      if (c) c.content = content
      console.log('[devMock] editChapterContent', idx, content.length + 'ch')
      return Promise.resolve(true)
    },
    mergeChapterUp: (bookId: number, idx: number) => {
      if (bookId !== 301) return Promise.resolve(false)
      const alive = novelChapters.filter((c) => !c.deleted)
      const pos = alive.findIndex((c) => c.idx === idx)
      if (pos <= 0) return Promise.resolve(false)
      alive[pos - 1].content += '\n\n' + alive[pos].content
      novelChapters = novelChapters.map((c) => (c.idx === idx ? { ...c, deleted: true } : c))
      mockShelfListeners.forEach((cb) => cb())
      return Promise.resolve(true)
    },
    markDupChapters: (bookId: number) => {
      if (bookId !== 301) return Promise.resolve(0)
      const alive = novelChapters.filter((c) => !c.deleted)
      let n = 0
      for (let i = 1; i < alive.length; i++) {
        if (alive[i].content === alive[i - 1].content && alive[i].content.length > 0) {
          alive[i].dup = true
          n++
        }
      }
      console.log('[devMock] markDupChapters →', n)
      return Promise.resolve(n)
    },

    /* 网络代理（mock） */
    getProxy: () => Promise.resolve({ ...mockProxy }),
    saveProxy: (url: string, on: boolean) => {
      mockProxy = { url, on }
      console.log('[devMock] saveProxy', mockProxy)
      return Promise.resolve(true)
    },
    testProxy: () => {
      console.log('[devMock] testProxy', mockProxy)
      return new Promise((r) => setTimeout(() => r({ ok: mockProxy.on && !!mockProxy.url, status: 204 }), 800))
    },

    /* 账号与会话（mock）：注册账号 + 游客双轨；「记住我」用 localStorage 模拟本机凭据 */
    getSession: () => {
      if (!mockSession.account && !mockSession.guest) {
        const rid = localStorage.getItem('mozhi-mock-remember')
        const a = rid ? mockAccounts.find((x) => x.id === rid) : undefined
        if (a) {
          mockSession.account = { id: a.id, name: a.name }
          console.log('[devMock] auto-login (remembered)', mockSession.account)
        }
      }
      return Promise.resolve(
        mockSession.account
          ? { mode: 'app', env: false, guest: false, account: { ...mockSession.account } }
          : mockSession.guest
            ? { mode: 'app', env: false, guest: true, account: null }
            : { mode: 'login', env: false, accounts: mockAccounts.map(accView) }
      )
    },
    listAccounts: () => Promise.resolve(mockAccounts.map(accView)),
    enterGuest: () => {
      mockSession.guest = true
      mockSession.account = null
      console.log('[devMock] enterGuest')
      return Promise.resolve({ ok: true } as const)
    },
    loginAccount: (id: string, password: string, remember: boolean) => {
      const a = mockAccounts.find((x) => x.id === id)
      if (!a) return Promise.resolve({ ok: false, error: '账号不存在' })
      if (a.hasPassword && password !== 'mozhi') return Promise.resolve({ ok: false, error: '口令不正确' })
      mockSession.account = { id: a.id, name: a.name }
      if (remember) localStorage.setItem('mozhi-mock-remember', a.id)
      else localStorage.removeItem('mozhi-mock-remember')
      console.log('[devMock] login', mockSession.account, 'remember=', remember)
      return Promise.resolve({ ok: true, account: { ...mockSession.account } })
    },
    createAccount: (name: string, password: string, remember: boolean) => {
      const n = name.trim()
      if (!n) return Promise.resolve({ ok: false, error: '请填写账号名' })
      if (mockAccounts.some((x) => x.name === n)) return Promise.resolve({ ok: false, error: '已存在同名账号' })
      if (password.length < 4) return Promise.resolve({ ok: false, error: '口令至少 4 位' })
      const a = { id: `mock-${Date.now().toString(36)}`, name: n, hasPassword: true, lastUsedAt: '刚刚', active: false }
      mockAccounts.push(a)
      mockSession.account = { id: a.id, name: a.name }
      if (remember) localStorage.setItem('mozhi-mock-remember', a.id)
      console.log('[devMock] createAccount', a, 'remember=', remember)
      return Promise.resolve({ ok: true, account: { ...mockSession.account } })
    },
    logout: () => {
      localStorage.removeItem('mozhi-mock-remember')
      mockSession.account = null
      mockSession.guest = false
      console.log('[devMock] logout')
      return Promise.resolve({ ok: true })
    },

    /* 云同步（mock） */
    getCloudConfig: () => Promise.resolve(mockCloudView()),
    saveCloudConfig: (patch: Record<string, unknown>) => {
      const p = patch as {
        enabled?: boolean
        provider?: 'webdav' | 's3'
        webdav?: { url: string; dir: string; username: string }
        s3?: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
        webdavPassword?: string
        s3SecretAccessKey?: string
      }
      if (p.enabled !== undefined) mockCloud.enabled = p.enabled
      if (p.provider) mockCloud.provider = p.provider
      if (p.webdav) mockCloud.webdav = { ...mockCloud.webdav, ...p.webdav }
      if (p.s3) mockCloud.s3 = { ...mockCloud.s3, ...p.s3 }
      if (p.webdavPassword) mockCloud.secretStored = true
      if (p.s3SecretAccessKey) mockCloud.secretStored = true
      console.log('[devMock] saveCloudConfig', mockCloud)
      return Promise.resolve(mockCloudView())
    },
    testCloud: () =>
      new Promise((r) =>
        setTimeout(() => {
          const ok = mockCloud.provider === 'webdav'
            ? !!(mockCloud.webdav.url && mockCloud.webdav.username && mockCloud.secretStored)
            : !!(mockCloud.s3.bucket && mockCloud.s3.accessKeyId && mockCloud.secretStored)
          r({ ok, message: ok ? '连接成功（模拟）' : '请先完整填写配置与密钥' })
        }, 700)
      ),
    uploadCloud: () =>
      new Promise((r) =>
        setTimeout(() => {
          mockCloudRemote = mockManifest()
          mockCloud.lastUploadAt = new Date().toISOString()
          console.log('[devMock] uploadCloud', mockCloudRemote)
          r({ ok: true, message: '已上传快照（模拟）', manifest: { ...mockCloudRemote } })
        }, 900)
      ),
    downloadCloud: () =>
      new Promise((r) =>
        setTimeout(() => {
          if (!mockCloudRemote) {
            r({ ok: false, message: '云端暂无快照（先上传一次）', manifest: null })
            return
          }
          mockCloud.lastDownloadAt = new Date().toISOString()
          r({ ok: true, message: '快照已下载（模拟）', manifest: { ...mockCloudRemote } })
        }, 800)
      ),
    applyCloudRestore: () =>
      new Promise((r) => {
        mockShelfListeners.forEach((cb) => cb())
        r({ ok: true, message: '已恢复（模拟）' })
      }),
    discardCloudRestore: () => Promise.resolve(true),
    cloudRemoteInfo: () =>
      Promise.resolve(
        mockCloudRemote
          ? { exists: true, manifest: { ...mockCloudRemote } }
          : { exists: false }
      ),
    fetchPhoneProgress: () =>
      new Promise((r) =>
        setTimeout(() => {
          if (!mockPhoneProgress) {
            r({ ok: true })
            return
          }
          r({ ok: true, progress: mockPhoneProgress() })
        }, 600)
      ),
    applyPhoneProgress: (
      picks: Array<{ bookId: number; progress: number; currentChapter: number; chapterLabel: string }>
    ) =>
      new Promise((r) => {
        const known = new Set(shelf().books.map((b) => b.id))
        let applied = 0
        for (const p of picks) {
          if (!known.has(p.bookId)) continue
          prog.set(p.bookId, { pct: p.progress, label: p.chapterLabel, idx: p.currentChapter, cfi: prog.get(p.bookId)?.cfi ?? '' })
          applied++
        }
        console.log('[devMock] applyPhoneProgress', applied, '/', picks.length)
        mockShelfListeners.forEach((cb) => cb())
        r({ applied, missing: picks.length - applied })
      }),

    /* 账号云同步（PG）mock */
    getPgConfig: () => Promise.resolve(mockPgView()),
    savePgConfig: (patch: { enabled?: boolean; host?: string; port?: number; database?: string; user?: string; password?: string }) => {
      if (patch.enabled !== undefined) mockPg.enabled = patch.enabled
      if (patch.host !== undefined) mockPg.host = patch.host
      if (patch.port !== undefined && patch.port > 0) mockPg.port = patch.port
      if (patch.database !== undefined) mockPg.database = patch.database
      if (patch.user !== undefined) mockPg.user = patch.user
      if (patch.password !== undefined) mockPg.secretStored = patch.password !== ''
      return Promise.resolve(mockPgView())
    },
    testPg: () =>
      new Promise((r) => {
        setTimeout(() => {
          if (!mockPg.host || !mockPg.database || !mockPg.user || !mockPg.secretStored) {
            r({ ok: false, message: '请先完整填写连接配置并保存口令（模拟）' })
            return
          }
          r({ ok: true, message: 'PostgreSQL 18.6 · 账本表就绪（模拟）' })
        }, 700)
      }),
    registerPg: (name: string, password: string) =>
      new Promise((r) => {
        setTimeout(() => {
          const n = name.trim()
          if (!n) r({ ok: false, error: '请填写账号名' })
          else if (n.length > 24) r({ ok: false, error: '账号名最长 24 字' })
          else if (n === '游客') r({ ok: false, error: '账号名不可用' })
          else if (!password || password.length < 4) r({ ok: false, error: '口令至少 4 位' })
          else if (mockPgUsers.has(n)) r({ ok: false, error: '该账号名已被注册' })
          else {
            mockPgUsers.set(n, password)
            mockPg.session = { userId: `u-${n}`, name: n }
            console.log('[devMock] registerPg', n)
            r({ ok: true, view: mockPgView() })
          }
        }, 700)
      }),
    loginPg: (name: string, password: string) =>
      new Promise((r) => {
        setTimeout(() => {
          const n = name.trim()
          if (!n || !password) r({ ok: false, error: '请填写账号名与口令' })
          else if (!mockPgUsers.has(n) || mockPgUsers.get(n) !== password) r({ ok: false, error: '账号或口令不正确' })
          else {
            mockPg.session = { userId: `u-${n}`, name: n }
            console.log('[devMock] loginPg', n)
            r({ ok: true, view: mockPgView() })
          }
        }, 700)
      }),
    logoutPg: () => {
      mockPg.session = null
      return Promise.resolve({ ok: true, view: mockPgView() })
    },

    /* 局域网设备同步 mock */
    getLanConfig: () => Promise.resolve(mockLanView()),
    saveLanConfig: (patch: { enabled?: boolean; port?: number }) => {
      if (patch.enabled !== undefined) mockLan.enabled = patch.enabled
      if (patch.port !== undefined && patch.port > 0) mockLan.port = patch.port
      mockLan.running = mockLan.enabled
      return Promise.resolve(mockLanView())
    },
    startLanPair: () =>
      new Promise<LanPair>((r) => {
        setTimeout(() => {
          const code = String(Math.floor(100000 + Math.random() * 900000))
          r({
            ip: '192.168.2.100',
            port: mockLan.port,
            code,
            expiresAt: Date.now() + 5 * 60 * 1000,
            qrSvg:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges" width="200" height="200"><path fill="#000" d="M1 1h7v1H1zM11 1h2v1h-2zM15 1h2v1h-2zM19 1h9v1h-9zM1 2h1v1H1zM7 2h1v1H7zM9 2h1v1H9zM12 2h3v1h-3zM17 2h1v1h-1zM19 2h1v1h-1zM27 2h1v1h-1zM1 3h1v1H1zM3 3h3v1H3zM7 3h1v1H7zM10 3h1v1h-1zM13 3h3v1h-3zM16 3h1v1h-1zM19 3h1v1h-1zM21 3h5v1h-5zM27 3h1v1h-1zM1 4h1v1H1zM3 4h3v1H3zM7 4h1v1H7zM9 4h2v1H9zM12 4h1v1h-1zM14 4h2v1h-2zM17 4h2v1h-2zM20 4h1v1h-1zM22 4h2v1h-2zM26 4h1v1h-1zM1 5h1v1H1zM3 5h3v1H3zM7 5h1v1H7zM11 5h2v1h-2zM15 5h1v1h-1zM18 5h3v1h-3zM23 5h2v1h-2zM26 5h1v1h-1zM1 6h1v1H1zM7 6h1v1H7zM9 6h1v1H9zM11 6h1v1h-1zM13 6h2v1h-2zM17 6h1v1h-1zM19 6h2v1h-2zM22 6h1v1h-1zM24 6h3v1h-3zM1 7h1v1H1zM2 7h4v1H2zM7 7h1v1H7zM10 7h1v1h-1zM13 7h2v1h-2zM16 7h2v1h-2zM19 7h1v1h-1zM21 7h1v1h-1zM23 7h1v1h-1zM25 7h1v1h-1zM27 7h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM14 8h2v1h-2zM17 8h1v1h-1zM20 8h1v1h-1zM22 8h2v1h-2zM26 8h1v1h-1zM1 9h2v1H1zM4 9h1v1H4zM6 9h1v1H6zM8 9h2v1H8zM11 9h2v1h-2zM15 9h2v1h-2zM19 9h2v1h-2zM23 9h1v1h-1zM25 9h1v1h-1zM27 9h1v1h-1zM2 10h1v1H2zM5 10h2v1H5zM9 10h1v1H9zM11 10h2v1h-2zM15 10h1v1h-1zM17 10h2v1h-2zM21 10h2v1h-2zM24 10h1v1h-1zM26 10h1v1h-1zM1 11h1v1H1zM3 11h1v1H3zM6 11h2v1H6zM9 11h1v1H9zM12 11h1v1h-1zM14 11h3v1h-3zM19 11h1v1h-1zM22 11h1v1h-1zM24 11h3v1h-3zM2 12h2v1H2zM5 12h1v1H5zM8 12h2v1H8zM11 12h1v1h-1zM13 12h1v1h-1zM16 12h1v1h-1zM18 12h1v1h-1zM20 12h2v1h-2zM23 12h1v1h-1zM26 12h1v1h-1zM1 13h2v1H1zM4 13h2v1H4zM7 13h1v1H7zM10 13h1v1h-1zM12 13h1v1h-1zM15 13h1v1h-1zM17 13h1v1h-1zM19 13h2v1h-2zM22 13h2v1h-2zM25 13h1v1h-1zM27 13h1v1h-1zM2 14h1v1H2zM5 14h1v1H5zM8 14h1v1H8zM11 14h1v1h-1zM13 14h1v1h-1zM16 14h2v1h-2zM19 14h1v1h-1zM21 14h3v1h-3zM25 14h1v1h-1zM1 15h1v1H1zM4 15h2v1H4zM7 15h1v1H7zM9 15h1v1H9zM12 15h2v1h-2zM15 15h1v1h-1zM18 15h1v1h-1zM20 15h1v1h-1zM22 15h2v1h-2zM26 15h1v1h-1zM2 16h2v1H2zM5 16h1v1H5zM8 16h1v1H8zM10 16h1v1h-1zM13 16h1v1h-1zM16 16h2v1h-2zM19 16h1v1h-1zM21 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM1 17h1v1H1zM3 17h1v1H3zM5 17h2v1H5zM9 17h2v1H9zM12 17h1v1h-1zM14 17h1v1h-1zM17 17h1v1h-1zM19 17h2v1h-2zM23 17h1v1h-1zM25 17h2v1h-2zM2 18h2v1H2zM6 18h1v1H6zM9 18h1v1H9zM11 18h1v1h-1zM13 18h2v1h-2zM16 18h1v1h-1zM18 18h1v1h-1zM21 18h2v1h-2zM24 18h1v1h-1zM26 18h1v1h-1zM1 19h1v1H1zM3 19h4v1H3zM8 19h1v1H8zM10 19h2v1h-2zM13 19h1v1h-1zM15 19h1v1h-1zM17 19h2v1h-2zM20 19h1v1h-1zM22 19h2v1h-2zM25 19h1v1h-1zM27 19h1v1h-1zM1 20h1v1H1zM7 20h1v1H7zM10 20h1v1h-1zM12 20h2v1h-2zM15 20h1v1h-1zM18 20h1v1h-1zM20 20h2v1h-2zM23 20h1v1h-1zM26 20h1v1h-1zM2 21h1v1H2zM4 21h2v1H4zM8 21h1v1H8zM11 21h1v1h-1zM14 21h1v1h-1zM16 21h1v1h-1zM19 21h1v1h-1zM21 21h2v1h-2zM24 21h1v1h-1zM26 21h1v1h-1zM1 22h1v1H1zM3 22h3v1H3zM7 22h1v1H7zM9 22h1v1H9zM12 22h1v1h-1zM15 22h1v1h-1zM17 22h1v1h-1zM20 22h1v1h-1zM22 22h1v1h-1zM24 22h2v1h-2zM27 22h1v1h-1zM1 23h1v1H1zM7 23h1v1H7zM10 23h1v1h-1zM13 23h2v1h-2zM16 23h1v1h-1zM18 23h1v1h-1zM21 23h1v1h-1zM23 23h1v1h-1zM25 23h2v1h-2zM1 24h1v1H1zM2 24h4v1H2zM7 24h1v1H7zM9 24h2v1H9zM13 24h1v1h-1zM15 24h1v1h-1zM17 24h2v1h-2zM20 24h1v1h-1zM22 24h1v1h-1zM24 24h3v1h-3zM1 25h1v1H1zM7 25h1v1H7zM11 25h1v1h-1zM14 25h1v1h-1zM16 25h2v1h-2zM19 25h1v1h-1zM21 25h2v1h-2zM25 25h1v1h-1zM27 25h1v1h-1z" fill-rule="evenodd"/></svg>',
            payload: JSON.stringify({ v: 1, ip: '192.168.2.100', port: mockLan.port, s: 'mock-secret' })
          })
          console.log('[devMock] startLanPair', code)
        }, 500)
      }),
    revokeLanDevice: (id: string) => {
      mockLan.devices = mockLan.devices.filter((d) => d.id !== id)
      return Promise.resolve(mockLanView())
    }
  }
}

/* ---------- 账号 / 云同步 mock 状态 ---------- */
interface MockAccount { id: string; name: string; hasPassword: boolean; lastUsedAt: string; active: boolean }
const accView = (a: MockAccount) => ({ ...a })
const mockAccounts: MockAccount[] = [
  { id: 'main', name: '主账号', hasPassword: true, lastUsedAt: '昨天 21:04', active: false },
  { id: 'second', name: '书房客', hasPassword: false, lastUsedAt: '11-18 09:12', active: false }
]
const mockSession = { account: null as { id: string; name: string } | null, guest: false }
const mockCloud = {
  enabled: false,
  provider: 'webdav' as 'webdav' | 's3',
  webdav: { url: '', dir: '墨纸', username: '' },
  s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: 'mozhi/', accessKeyId: '' },
  lastUploadAt: '',
  lastDownloadAt: '',
  secretStored: false
}
const mockCloudView = () => ({ ...mockCloud, webdav: { ...mockCloud.webdav }, s3: { ...mockCloud.s3 } })
const mockPg = {
  enabled: false,
  host: '',
  port: 5432,
  database: '',
  user: '',
  secretStored: false,
  session: null as { userId: string; name: string } | null
}
const mockPgUsers = new Map<string, string>()
const mockStoreBooks = new Map<string, { title: string; author: string; chapters: number }>()
const mockPgView = () => ({ ...mockPg, session: mockPg.session ? { ...mockPg.session } : null })
/* 局域网设备同步 mock 状态 */
const mockLan = {
  enabled: false,
  port: 7380,
  running: false,
  devices: [] as { id: string; name: string; createdAt: number; lastSyncAt: number }[]
}
const mockLanView = () => ({
  enabled: mockLan.enabled,
  port: mockLan.port,
  lanIp: '192.168.2.100',
  running: mockLan.running,
  devices: mockLan.devices.map((d) => ({ ...d }))
})
let mockCloudRemote: ReturnType<typeof mockManifest> | null = null
let mockPhoneProgress: (() => {
  app: string
  deviceId: string
  generatedAt: string
  entries: Array<{ bookId: number; title: string; progress: number; currentChapter: number; chapterLabel: string }>
}) | null = function () {
  return {
    app: 'mozhi-mobile',
    deviceId: 'test-device',
    generatedAt: new Date().toISOString(),
    entries: [
      { bookId: 301, title: '墨与纸(模拟·在线抓取)', progress: 88, currentChapter: 11, chapterLabel: '第十一章' },
      { bookId: 101, title: '城南旧事·节选', progress: 42, currentChapter: 3, chapterLabel: '我们看海去' }
    ]
  }
}
function mockManifest() {
  const s = shelf()
  return {
    app: '0.2.0',
    createdAt: new Date().toISOString(),
    books: s.books.length,
    articles: 0,
    chapters: s.books.reduce((n, b) => n + (b.totalChapters || 0), 0),
    sources: 0,
    covers: mockCovers.size,
    zipBytes: 15329894
  }
}

const mockSettings = { autostart: false, closeToTray: true, pullOnStart: true }
let mockBossKey = 'CommandOrControl+Shift+M'
let mockBossKeyCustom = false
const mockShelfListeners: (() => void)[] = []
const DEFAULT_DATA_DIR = 'C:\\Users\\you\\AppData\\Roaming\\墨纸 Mozhi Reader'
let mockDataDir = DEFAULT_DATA_DIR
let mockDataDirCustom: string | null = null
let mockProxy = { on: false, url: '' }
