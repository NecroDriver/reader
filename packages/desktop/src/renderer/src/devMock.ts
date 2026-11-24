/**
 * 浏览器直开 dev server（无 Electron preload）时的 mock。
 * 仅 import.meta.env.DEV 使用：完整模拟 window.mozhi，
 * 让 Playwright 能在 http://localhost:5173/ 验证渲染管线。
 * 进度存内存（刷新即重置，测试中可通过 window.__mockProg 查看）。
 */
import type { NovelJobState, OpenedBook, Shelf } from './types'

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
  syncLogListeners.forEach((cb) => cb())
  mockShelfListeners.forEach((cb) => cb())
  return { checked: online.length, updatedBooks: added > 0 ? online.length : 0, addedChapters: added }
}

export function setupDevMock(): void {
  if (window.mozhi) return
  window.mozhi = {
    getShelf: () => Promise.resolve(shelf()),
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
      })
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
