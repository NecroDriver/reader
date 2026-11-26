import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import { parseLocalFile } from './parsers'

export interface BookRow {
  id: number
  title: string
  author: string
  format: string
  cover_idx: number
  progress: number
  chapter_label: string
  total_chapters: number
  current_chapter: number
  origin_path: string
  cfi: string
  cover_path: string
  cover_url: string
  download_url: string
  created_at: string
}
export interface ArticleRow {
  id: number
  title: string
  source: string
  source_id: number
  url: string
  author: string
  published_at: string
  unread: number
  progress: number
  is_new: number
  sort_at: number
}
export interface SourceRow {
  id: number
  name: string
  url: string
  type: string
  interval_minutes: number
  last_pull_at: string | null
  last_pull_ms: number
  last_count: number
  enabled: number
}
export interface Shelf {
  books: BookRow[]
  last_sync_at: string
}

let db: Database.Database | null = null

/** 演示种子策略：新账号空库跳过（'none'），默认/环境覆盖模式保留演示数据（'demo'） */
let seedPolicy: 'demo' | 'none' = 'demo'
export function setSeedPolicy(p: 'demo' | 'none'): void {
  seedPolicy = p
}

/** 关闭当前库（账号切换 / 云恢复前调用）：折叠 WAL 再关，句柄置空待重开 */
export function closeDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* checkpoint 失败也要尝试关闭 */
  }
  try {
    db.close()
  } catch {
    /* 已关闭 */
  }
  db = null
}

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'mozhi.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT 'TXT',
      cover_idx INTEGER NOT NULL DEFAULT 0,
      progress REAL NOT NULL DEFAULT 0,
      chapter_label TEXT NOT NULL DEFAULT '',
      sort_at REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      unread INTEGER NOT NULL DEFAULT 1,
      progress REAL NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      sort_at REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'rss',
      interval_minutes INTEGER NOT NULL DEFAULT 360,
      last_pull_at TEXT,
      last_count INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  migrate(db)
  if (seedPolicy === 'demo') seedIfEmpty(db)
  /* 播种行（及任何遗漏行）也要有同步身份，否则对设备同步不可见 */
  backfillSyncCols(db)
  return db
}

/** 轻量迁移：articles.sort_at（旧开发库回填） + books 阅读器列 + chapters 表 */
function migrate(d: Database.Database): void {
  const artCols = d.prepare('PRAGMA table_info(articles)').all() as { name: string }[]
  if (!artCols.some((c) => c.name === 'sort_at')) {
    d.exec('ALTER TABLE articles ADD COLUMN sort_at REAL NOT NULL DEFAULT 0')
  }
  d.prepare('UPDATE articles SET sort_at = 1000 - id * 10 WHERE sort_at = 0').run()

  const bookCols = d.prepare('PRAGMA table_info(books)').all() as { name: string }[]
  if (!bookCols.some((c) => c.name === 'total_chapters')) {
    d.exec('ALTER TABLE books ADD COLUMN total_chapters INTEGER NOT NULL DEFAULT 0')
  }
  if (!bookCols.some((c) => c.name === 'current_chapter')) {
    d.exec('ALTER TABLE books ADD COLUMN current_chapter INTEGER NOT NULL DEFAULT 0')
  }
  if (!bookCols.some((c) => c.name === 'origin_path')) {
    d.exec("ALTER TABLE books ADD COLUMN origin_path TEXT NOT NULL DEFAULT ''")
  }
  if (!bookCols.some((c) => c.name === 'cfi')) {
    d.exec("ALTER TABLE books ADD COLUMN cfi TEXT NOT NULL DEFAULT ''")
  }
  if (!bookCols.some((c) => c.name === 'cover_path')) {
    d.exec("ALTER TABLE books ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''")
  }
  if (!bookCols.some((c) => c.name === 'download_url')) {
    d.exec("ALTER TABLE books ADD COLUMN download_url TEXT NOT NULL DEFAULT ''")
  }
  if (!bookCols.some((c) => c.name === 'cover_url')) {
    d.exec("ALTER TABLE books ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''")
  }
  if (!bookCols.some((c) => c.name === 'last_read_at')) {
    d.exec('ALTER TABLE books ADD COLUMN last_read_at REAL NOT NULL DEFAULT 0')
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      book_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (book_id, idx)
    );
  `)

  /* 里程碑3：订阅拉取 */
  const artCols2 = d.prepare('PRAGMA table_info(articles)').all() as { name: string }[]
  if (!artCols2.some((c) => c.name === 'source_id')) {
    d.exec('ALTER TABLE articles ADD COLUMN source_id INTEGER NOT NULL DEFAULT 0')
  }
  if (!artCols2.some((c) => c.name === 'url')) {
    d.exec("ALTER TABLE articles ADD COLUMN url TEXT NOT NULL DEFAULT ''")
  }
  if (!artCols2.some((c) => c.name === 'author')) {
    d.exec("ALTER TABLE articles ADD COLUMN author TEXT NOT NULL DEFAULT ''")
  }
  if (!artCols2.some((c) => c.name === 'content')) {
    d.exec("ALTER TABLE articles ADD COLUMN content TEXT NOT NULL DEFAULT ''")
  }
  const srcCols = d.prepare('PRAGMA table_info(sources)').all() as { name: string }[]
  if (!srcCols.some((c) => c.name === 'last_pull_ms')) {
    d.exec('ALTER TABLE sources ADD COLUMN last_pull_ms INTEGER NOT NULL DEFAULT 0')
  }
  /* 修复旧库裸域名源（无 scheme 时 net.fetch 报 Failed to parse URL） */
  d.exec("UPDATE sources SET url = 'https://' || url WHERE url <> '' AND url NOT LIKE 'http%'")

  /* 小说源：chapters 软删/编辑标记/重复标记/来源 URL + novel_sources 表 */
  const chCols = d.prepare('PRAGMA table_info(chapters)').all() as { name: string }[]
  if (!chCols.some((c) => c.name === 'url')) {
    d.exec("ALTER TABLE chapters ADD COLUMN url TEXT NOT NULL DEFAULT ''")
  }
  if (!chCols.some((c) => c.name === 'deleted')) {
    d.exec('ALTER TABLE chapters ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
  }
  if (!chCols.some((c) => c.name === 'content_edited')) {
    d.exec('ALTER TABLE chapters ADD COLUMN content_edited INTEGER NOT NULL DEFAULT 0')
  }
  if (!chCols.some((c) => c.name === 'dup')) {
    d.exec('ALTER TABLE chapters ADD COLUMN dup INTEGER NOT NULL DEFAULT 0')
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS novel_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL UNIQUE,
      toc_url TEXT NOT NULL,
      cursor_url TEXT NOT NULL DEFAULT '',
      fetched INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at REAL NOT NULL DEFAULT 0
    );
  `)

  /* 设备同步（v2.2 M-B）：sync_uuid 跨端身份、updated_at 行级版本、chapters_rev 章节集版本、删除墓碑 */
  const syncCols = d.prepare('PRAGMA table_info(books)').all() as { name: string }[]
  if (!syncCols.some((c) => c.name === 'sync_uuid')) {
    d.exec("ALTER TABLE books ADD COLUMN sync_uuid TEXT NOT NULL DEFAULT ''")
  }
  if (!syncCols.some((c) => c.name === 'updated_at')) {
    d.exec('ALTER TABLE books ADD COLUMN updated_at REAL NOT NULL DEFAULT 0')
  }
  if (!syncCols.some((c) => c.name === 'chapters_rev')) {
    d.exec('ALTER TABLE books ADD COLUMN chapters_rev INTEGER NOT NULL DEFAULT 0')
  }
  /* 旧库回填：已有书补 uuid/时间戳/章节版本（迁移与首次播种后都会调用） */
  backfillSyncCols(d)
  d.exec(`
    CREATE TABLE IF NOT EXISTS mozhi_tombstones (
      uuid TEXT PRIMARY KEY,
      deleted_at REAL NOT NULL
    );
  `)
}

/** 给 sync_uuid 为空的书补跨端身份/时间戳/章节版本（幂等）。 */
function backfillSyncCols(d: Database.Database): void {
  const now = Date.now()
  d.transaction(() => {
    const rows = d.prepare("SELECT id FROM books WHERE sync_uuid = ''").all() as { id: number }[]
    const fill = d.prepare('UPDATE books SET sync_uuid = ?, updated_at = ?, chapters_rev = 1 WHERE id = ?')
    for (const r of rows) fill.run(randomUUID(), now, r.id)
  })()
}

function seedIfEmpty(d: Database.Database): void {
  const hasBook = d.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }
  if (hasBook.n === 0) {
    const ins = d.prepare(
      `INSERT INTO books (title, author, format, cover_idx, progress, chapter_label, sort_at) VALUES (?,?,?,?,?,?,?)`
    )
    ins.run('朝花夕拾', '鲁迅', 'EPUB', 1, 62, '第三章', 9)
    ins.run('呐喊', '鲁迅', 'EPUB', 0, 0, '', 8)
    ins.run('城南旧事', '林海音', 'PDF', 2, 34, '第二章', 7)
    ins.run('世说新语', '刘义庆', 'EPUB', 3, 0, '', 6)
    ins.run('唐诗三百首', '蘅塘退士', 'TXT', 4, 18, '五言古诗', 5)
    ins.run('浮生六记', '沈复', 'EPUB', 2, 100, '卷六', 4)
  }
  const hasArt = d.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }
  if (hasArt.n === 0) {
    const ins = d.prepare(
      `INSERT INTO articles (title, source, published_at, unread, progress, is_new, sort_at) VALUES (?,?,?,?,?,?,?)`
    )
    ins.run('第 305 期：AI 与阅读的未来', '科技爱好者周刊', '11-10', 1, 0, 0, 9)
    ins.run('把 RSS 作为一种生活方式', '阮一峰周刊', '11-09', 1, 0, 0, 8)
    ins.run('为什么我还在写博客', '少数派', '11-09', 1, 0, 0, 7)
    ins.run('本地优先软件的十年', '科技爱好者周刊', '11-08', 1, 38, 0, 6)
    ins.run('从纸到屏：阅读介质小史', '少数派', '11-07', 0, 100, 0, 5)
    ins.run('PDF 重排版的一次尝试', '阮一峰周刊', '11-06', 0, 100, 0, 4)
  }
  // 订阅源不做种子：新装机从空列表开始，由用户在订阅页自行添加真实源
  // （旧版种子的演示源 URL 已不可用，且公共 rsshub 实例易超时产生失败记录）
}

export function getShelf(): Shelf {
  const d = getDb()
  const sync = d
    .prepare("SELECT value FROM settings WHERE key = 'last_sync_at'")
    .get() as { value: string } | undefined
  return {
    books: d.prepare('SELECT * FROM books ORDER BY sort_at DESC').all() as BookRow[],
    last_sync_at: sync?.value ?? '—'
  }
}

/** 全部在线小说书的 id（有 novel_sources 记录的书；toc_url 在该表，origin_path 恒空） */
export function listOnlineBookIds(): number[] {
  return (
    getDb()
      .prepare(
        `SELECT b.id FROM books b JOIN novel_sources ns ON ns.book_id = b.id
          ORDER BY b.sort_at DESC`
      )
      .all() as { id: number }[]
  ).map((r) => r.id)
}

/* ---------- 本地导入与阅读 ---------- */

export interface ImportResult {
  ok: boolean
  bookId?: number
  title?: string
  chapters?: number
  error?: string
}

export function importLocalFiles(paths: string[]): ImportResult[] {
  const d = getDb()
  const results: ImportResult[] = []
  for (const p of paths) {
    try {
      const name = basename(p)
      const lower = name.toLowerCase()
      if (lower.endsWith('.epub') || lower.endsWith('.pdf')) {
        // 二进制格式：不入 chapters，阅读时经 origin_path 流式解析
        const fmt = lower.endsWith('.epub') ? 'EPUB' : 'PDF'
        const title = name.replace(/\.(epub|pdf)$/i, '').trim() || name
        const dup = d
          .prepare('SELECT id FROM books WHERE title = ? AND format = ?')
          .get(title, fmt) as { id: number } | undefined
        if (dup) {
          results.push({ ok: true, bookId: dup.id, title, chapters: 0 })
          continue
        }
        const info = d
          .prepare(
            `INSERT INTO books (title, author, format, cover_idx, progress, chapter_label, sort_at, total_chapters, current_chapter, origin_path, sync_uuid, updated_at, chapters_rev)
             VALUES (?, '', ?, ?, 0, '', ?, 0, 0, ?, ?, ?, ?)`
          )
          .run(title, fmt, Math.floor(Math.random() * 5), Date.now() / 1000, p, randomUUID(), Date.now(), 0)
        results.push({ ok: true, bookId: Number(info.lastInsertRowid), title, chapters: 0 })
        continue
      }
      const buf = readFileSync(p)
      const parsed = parseLocalFile(name, buf)
      const fmt = /\.md$/i.test(name) ? 'MD' : 'TXT'
      // 同名+同章数视为重复导入，直接复用
      const dup = d
        .prepare('SELECT id FROM books WHERE title = ? AND total_chapters = ?')
        .get(parsed.title, parsed.chapters.length) as { id: number } | undefined
      if (dup) {
        results.push({ ok: true, bookId: dup.id, title: parsed.title, chapters: parsed.chapters.length })
        continue
      }
      const tx = d.transaction(() => {
        const info = d
          .prepare(
            `INSERT INTO books (title, author, format, cover_idx, progress, chapter_label, sort_at, total_chapters, current_chapter, origin_path, sync_uuid, updated_at, chapters_rev)
             VALUES (?,?,?,?,0,'',?, ?, 0, ?, ?, ?, ?)`
          )
          .run(
            parsed.title,
            parsed.author,
            fmt,
            Math.floor(Math.random() * 5),
            Date.now() / 1000,
            parsed.chapters.length,
            p,
            randomUUID(),
            Date.now(),
            parsed.chapters.length > 0 ? 1 : 0
          )
        const bookId = Number(info.lastInsertRowid)
        const insCh = d.prepare('INSERT INTO chapters (book_id, idx, title, content) VALUES (?,?,?,?)')
        for (const ch of parsed.chapters) insCh.run(bookId, ch.idx, ch.title, ch.content)
        return bookId
      })
      const bookId = tx()
      results.push({ ok: true, bookId, title: parsed.title, chapters: parsed.chapters.length })
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}

export interface OpenedBook {
  id: number
  title: string
  author: string
  format: string
  totalChapters: number
  currentChapter: number
  progress: number
  cfi: string
  toc: { idx: number; title: string; dup: boolean }[]
}

export function openBook(bookId: number): OpenedBook | null {
  const d = getDb()
  const b = d.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as BookRow | undefined
  if (!b) return null
  d.prepare('UPDATE books SET last_read_at = ? WHERE id = ?').run(Date.now(), bookId)
  const toc = d
    .prepare('SELECT idx, title, dup FROM chapters WHERE book_id = ? AND deleted = 0 ORDER BY idx')
    .all(bookId) as { idx: number; title: string; dup: number }[]
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    totalChapters: toc.length,
    currentChapter: b.current_chapter,
    progress: b.progress,
    cfi: b.cfi ?? '',
    toc: toc.map((t) => ({ idx: t.idx, title: t.title, dup: t.dup === 1 }))
  }
}

/** 读取二进制书源文件（EPUB/PDF），返回给渲染层流式解析 */
export function readBookFile(
  bookId: number
): { format: string; data: ArrayBuffer } | null {
  const d = getDb()
  const b = d.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as BookRow | undefined
  if (!b?.origin_path) return null
  const buf = readFileSync(b.origin_path)
  return { format: b.format, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
}

export function getChapter(bookId: number, idx: number): { title: string; content: string } | null {
  const d = getDb()
  const row = d
    .prepare('SELECT title, content FROM chapters WHERE book_id = ? AND idx = ? AND deleted = 0')
    .get(bookId, idx) as { title: string; content: string } | undefined
  return row ?? null
}

export function saveProgress(
  bookId: number,
  chapterIdx: number,
  pct: number,
  label: string,
  cfi = ''
): void {
  const d = getDb()
  d.prepare(
    'UPDATE books SET current_chapter = ?, progress = ?, chapter_label = ?, cfi = ?, updated_at = ?, last_read_at = ? WHERE id = ?'
  ).run(chapterIdx, Math.max(0, Math.min(100, pct)), label.slice(0, 40), cfi, Date.now(), Date.now(), bookId)
}

/* ---------- 订阅源与文章 ---------- */

export interface FeedItemIn {
  title: string
  url: string
  author: string
  publishedAt: string
  contentHtml: string
}

export function listSources(): SourceRow[] {
  return getDb().prepare('SELECT * FROM sources ORDER BY id').all() as SourceRow[]
}

export function getSource(id: number): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
}

export function addSource(input: {
  name: string
  url: string
  type: string
  intervalMinutes: number
}): SourceRow {
  const d = getDb()
  const info = d
    .prepare('INSERT INTO sources (name, url, type, interval_minutes) VALUES (?,?,?,?)')
    .run(input.name.slice(0, 40), input.url, input.type, input.intervalMinutes)
  return getSource(Number(info.lastInsertRowid))!
}

export function updateSource(
  id: number,
  patch: { intervalMinutes?: number; enabled?: boolean; name?: string }
): void {
  const d = getDb()
  if (patch.intervalMinutes !== undefined)
    d.prepare('UPDATE sources SET interval_minutes = ? WHERE id = ?').run(patch.intervalMinutes, id)
  if (patch.enabled !== undefined)
    d.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id)
  if (patch.name !== undefined)
    d.prepare('UPDATE sources SET name = ? WHERE id = ?').run(patch.name.slice(0, 40), id)
}

export function removeSource(id: number): void {
  const d = getDb()
  d.transaction(() => {
    d.prepare('DELETE FROM articles WHERE source_id = ?').run(id)
    d.prepare('DELETE FROM sources WHERE id = ?').run(id)
  })()
}

/** 删除一本书及其章节/在线书源记录（书架管理用）；写墓碑供设备同步 */
export function deleteBook(id: number): void {
  const d = getDb()
  d.transaction(() => {
    const row = d.prepare('SELECT sync_uuid FROM books WHERE id = ?').get(id) as
      | { sync_uuid: string }
      | undefined
    if (row && row.sync_uuid) {
      d.prepare(
        'INSERT OR REPLACE INTO mozhi_tombstones (uuid, deleted_at) VALUES (?, ?)'
      ).run(row.sync_uuid, Date.now())
    }
    d.prepare('DELETE FROM chapters WHERE book_id = ?').run(id)
    d.prepare('DELETE FROM novel_sources WHERE book_id = ?').run(id)
    d.prepare('DELETE FROM books WHERE id = ?').run(id)
  })()
}

/** 拉取到的条目去重入库（source_id+url 命中即跳过），返回新增数 */
export function insertArticlesIfNew(source: SourceRow, items: FeedItemIn[]): number {
  const d = getDb()
  const exists = d.prepare('SELECT id FROM articles WHERE source_id = ? AND url = ? AND url != \'\'')
  const ins = d.prepare(
    `INSERT INTO articles (title, source, source_id, url, author, published_at, unread, progress, is_new, sort_at, content)
     VALUES (?,?,?,?,?,?,1,0,1,?,?)`
  )
  let added = 0
  const tx = d.transaction(() => {
    const base = Date.now() / 1000
    items.forEach((it, i) => {
      if (it.url && exists.get(source.id, it.url)) return
      ins.run(
        it.title.slice(0, 120) || '（无标题）',
        source.name,
        source.id,
        it.url,
        it.author.slice(0, 40),
        it.publishedAt,
        base + (items.length - i) / 100,
        it.contentHtml
      )
      added++
    })
  })
  tx()
  return added
}

export function markSourcePulled(id: number, added: number, label: string): void {
  const d = getDb()
  d.prepare('UPDATE sources SET last_pull_at = ?, last_pull_ms = ?, last_count = ? WHERE id = ?').run(
    label,
    Date.now(),
    added,
    id
  )
}

/** 拉取失败也要记时间：否则调度器每分钟都会重试失败的源（重试风暴） */
export function markSourceFailed(id: number, label: string): void {
  const d = getDb()
  d.prepare('UPDATE sources SET last_pull_at = ?, last_pull_ms = ?, last_count = 0 WHERE id = ?').run(
    `${label} · 失败`,
    Date.now(),
    id
  )
}

export interface OpenedArticle {
  id: number
  title: string
  source: string
  author: string
  publishedAt: string
  url: string
  contentHtml: string
  progress: number
}

/** 打开文章：标记已读并返回全文 */
export function openArticle(id: number): OpenedArticle | null {
  const d = getDb()
  const row = d.prepare('SELECT * FROM articles WHERE id = ?').get(id) as
    | (ArticleRow & { content: string })
    | undefined
  if (!row) return null
  d.prepare('UPDATE articles SET unread = 0 WHERE id = ?').run(id)
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    author: row.author,
    publishedAt: row.published_at,
    url: row.url,
    contentHtml: row.content,
    progress: row.progress
  }
}

export function saveArticleProgress(id: number, pct: number): void {
  const d = getDb()
  d.prepare('UPDATE articles SET progress = ? WHERE id = ?').run(Math.max(0, Math.min(100, pct)), id)
}

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

/** 清空所有已拉取文章（保留订阅源与本地图书） */
export function clearArticles(): void {
  getDb().prepare('DELETE FROM articles').run()
}

/* ---------- 同步记录（settings 表 JSON，环 30 条） ---------- */

export interface PullLogEntry {
  at: string // 本地时间 YYYY-MM-DDTHH:mm；历史数据可能是纯 HH:MM（渲染层兼容）
  name: string
  added: number
  ok: boolean
  error?: string
  /** 手动拉取全部但没有任何启用源 */
  empty?: boolean
  /** 自定义结果文案（「更新全部」汇总行等） */
  note?: string
  /** 小说抓取任务（订阅页「同步记录」里展示实时进度） */
  kind?: 'novel'
  bookId?: number
  running?: boolean
  paused?: boolean
  done?: number
  total?: number
}

function savePullLogs(list: PullLogEntry[]): void {
  setSetting('pull_log', JSON.stringify(list.slice(0, 30)))
}

export function addPullLog(entry: PullLogEntry): void {
  const raw = getSetting('pull_log')
  let list: PullLogEntry[] = []
  try {
    list = raw ? (JSON.parse(raw) as PullLogEntry[]) : []
  } catch {
    list = []
  }
  list.unshift(entry)
  savePullLogs(list)
}

export function getPullLogs(): PullLogEntry[] {
  const raw = getSetting('pull_log')
  try {
    return raw ? (JSON.parse(raw) as PullLogEntry[]) : []
  } catch {
    return []
  }
}

/** 同步记录时间戳：本地 YYYY-MM-DDTHH:mm（可排序、可区分天） */
function logStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「更新全部」完成后的汇总行（手动触发可见；启动时自动更新不记录，防噪音） */
export function logUpdateAllResult(r: { checked: number; updatedBooks: number; addedChapters: number }): void {
  const note =
    r.checked === 0
      ? '没有在线小说'
      : r.addedChapters > 0
        ? `${r.updatedBooks} 本有更新 · 新增 ${r.addedChapters} 章`
        : `已检查 ${r.checked} 本 · 无新章节`
  addPullLog({ at: logStamp(), name: '更新全部', added: r.addedChapters, ok: true, note })
}

/** 小说抓取任务在同步记录里的唯一活条目（running/paused），没有则新建到最前 */
export function upsertNovelPullLog(bookId: number, title: string, patch: Partial<PullLogEntry>): void {
  const list = getPullLogs()
  let e = list.find((x) => x.kind === 'novel' && x.bookId === bookId && (x.running || x.paused))
  if (!e) {
    e = {
      at: logStamp(),
      name: title,
      added: 0,
      ok: true
    }
    list.unshift(e)
  }
  e.kind = 'novel'
  e.bookId = bookId
  if (title) e.name = title
  Object.assign(e, patch)
  savePullLogs(list)
}

/** 应用启动时把上次异常退出残留的 running/paused 小说条目标记为中断 */
export function markStaleNovelLogs(): void {
  const list = getPullLogs()
  let dirty = false
  for (const e of list) {
    if (e.kind === 'novel' && (e.running || e.paused)) {
      e.running = false
      e.paused = false
      e.ok = false
      e.error = '应用重启时中断，可重新抓取'
      dirty = true
    }
  }
  if (dirty) savePullLogs(list)
}

/** 静默无操作（自动检查没有新章节）的任务不留记录 */
export function dropNovelPullLog(bookId: number): void {
  const list = getPullLogs()
  const i = list.findIndex((x) => x.kind === 'novel' && x.bookId === bookId && (x.running || x.paused))
  if (i < 0) return
  list.splice(i, 1)
  savePullLogs(list)
}

export function getBookTitleById(bookId: number): string {
  const r = getDb().prepare('SELECT title FROM books WHERE id = ?').get(bookId) as
    | { title: string }
    | undefined
  return r?.title ?? ''
}

/* ---------- 在线小说 ---------- */

export interface NovelSourceRow {
  id: number
  book_id: number
  toc_url: string
  cursor_url: string
  fetched: number
  total: number
  status: string
}

/** 建小说书：books 加一条 format='NOVEL'，novel_sources 记录目录页 */
export function createNovelBook(
  tocUrl: string,
  title: string,
  author: string,
  totalChapters: number,
  coverUrl = ''
): number {
  const d = getDb()
  const dup = d
    .prepare("SELECT id FROM books WHERE format = 'NOVEL' AND title = ?")
    .get(title) as { id: number } | undefined
  if (dup) {
    // 已有同名书：回填缺失的封面（不动其他字段）
    if (coverUrl) {
      d.prepare("UPDATE books SET cover_url = ? WHERE id = ? AND cover_url = ''").run(coverUrl, dup.id)
    }
    return dup.id
  }
  const tx = d.transaction(() => {
    const info = d
      .prepare(
        `INSERT INTO books (title, author, format, cover_idx, progress, chapter_label, sort_at, total_chapters, current_chapter, origin_path, sync_uuid, updated_at, cover_url)
         VALUES (?,?,'NOVEL',?,0,'',?, 0, 0, '', ?, ?, ?)`
      )
      .run(title, author, Math.floor(Math.random() * 5), Date.now() / 1000, randomUUID(), Date.now(), coverUrl)
    const bookId = Number(info.lastInsertRowid)
    d.prepare('INSERT INTO novel_sources (book_id, toc_url, total, created_at) VALUES (?,?,?,?)').run(
      bookId,
      tocUrl,
      totalChapters,
      Date.now() / 1000
    )
    return bookId
  })
  return tx()
}

/** 补小说封面：仅在该书尚无封面时写入（crawl 时从目录页 og 元数据回填）；touch updated_at 让手机端同步拿到 */
export function setNovelCoverUrl(bookId: number, url: string): void {
  if (!url) return
  const d = getDb()
  const cur = d.prepare('SELECT cover_url, cover_path FROM books WHERE id = ?').get(bookId) as
    | { cover_url: string; cover_path: string }
    | undefined
  if (!cur || cur.cover_url || cur.cover_path) return
  d.prepare('UPDATE books SET cover_url = ?, updated_at = ? WHERE id = ?').run(url, Date.now(), bookId)
}

export function getNovelSource(bookId: number): NovelSourceRow | undefined {
  return getDb().prepare('SELECT * FROM novel_sources WHERE book_id = ?').get(bookId) as
    | NovelSourceRow
    | undefined
}

export function listChapterUrls(bookId: number): { url: string; deleted: number; hasContent: number }[] {
  return getDb()
    .prepare("SELECT url, deleted, CASE WHEN content != '' THEN 1 ELSE 0 END AS hasContent FROM chapters WHERE book_id = ?")
    .all(bookId) as { url: string; deleted: number; hasContent: number }[]
}

export function appendChapters(
  bookId: number,
  items: { url: string; title: string; content: string }[],
  startIndex: number
): void {
  const d = getDb()
  const tx = d.transaction(() => {
    const ins = d.prepare('INSERT INTO chapters (book_id, idx, title, content, url) VALUES (?,?,?,?,?)')
    items.forEach((it, i) => ins.run(bookId, startIndex + i, it.title, it.content, it.url))
    d.prepare(
      `UPDATE books SET total_chapters = (SELECT COUNT(*) FROM chapters WHERE book_id = ? AND deleted = 0),
              chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?`
    ).run(bookId, Date.now(), bookId)
  })
  tx()
}

export function countChapters(bookId: number): number {
  const r = getDb()
    .prepare('SELECT COALESCE(MAX(idx) + 1, 0) AS next FROM chapters WHERE book_id = ?')
    .get(bookId) as { next: number }
  return r.next
}

/** 按 URL 查章 idx（gap 回填时定位插入锚点；同 URL 多行取最前） */
export function getChapterIdxByUrl(bookId: number, url: string): number | null {
  const r = getDb()
    .prepare('SELECT MIN(idx) AS idx FROM chapters WHERE book_id = ? AND url = ?')
    .get(bookId, url) as { idx: number | null }
  return r.idx
}

/**
 * 抓取补章插入到目录顺序位置（gap 回填：如旧库缺第一章，修复后更新应插回 idx 0 而非追加到末尾）。
 * 与 appendChapters 的区别：带位移（后续章 idx+1、current_chapter 跟随）且保留 url 供增量去重。
 */
export function insertCrawledChapter(
  bookId: number,
  atIdx: number,
  url: string,
  title: string,
  content: string
): void {
  const d = getDb()
  const tx = d.transaction(() => {
    // SQLite 的 UPDATE 不支持 ORDER BY：先抬到高空位再落回，避免 PK 瞬时冲突
    d.prepare('UPDATE chapters SET idx = idx + 1000000 WHERE book_id = ? AND idx >= ?').run(bookId, atIdx)
    d.prepare('UPDATE chapters SET idx = idx - 1000000 + 1 WHERE book_id = ? AND idx >= 1000000').run(bookId)
    d.prepare('INSERT INTO chapters (book_id, idx, title, content, url) VALUES (?,?,?,?,?)').run(
      bookId,
      atIdx,
      title.slice(0, 60),
      content,
      url
    )
    const b = d.prepare('SELECT current_chapter FROM books WHERE id = ?').get(bookId) as
      | { current_chapter: number }
      | undefined
    if (b && b.current_chapter >= atIdx) {
      d.prepare('UPDATE books SET current_chapter = current_chapter + 1 WHERE id = ?').run(bookId)
    }
    d.prepare(
      `UPDATE books SET total_chapters = (SELECT COUNT(*) FROM chapters WHERE book_id = ? AND deleted = 0),
              chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?`
    ).run(bookId, Date.now(), bookId)
  })
  tx()
}

/** 重抓本书：清空全部章节与进度（软删/编辑标记一并作废），抓取任务从零开始 */
export function resetNovelChapters(bookId: number): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
    d.prepare(
      "UPDATE books SET total_chapters = 0, current_chapter = 0, progress = 0, chapter_label = '', cfi = '', chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?"
    ).run(Date.now(), bookId)
    d.prepare("UPDATE novel_sources SET cursor_url = '', fetched = 0, total = 0, status = '' WHERE book_id = ?").run(
      bookId
    )
  })
  tx()
}

export function updateNovelProgress(bookId: number, cursorUrl: string, fetched: number, total: number, status: string): void {
  getDb()
    .prepare('UPDATE novel_sources SET cursor_url = ?, fetched = ?, total = ?, status = ? WHERE book_id = ?')
    .run(cursorUrl, fetched, total, status, bookId)
}

export function setBookChapterCount(bookId: number): void {
  getDb()
    .prepare(
      "UPDATE books SET total_chapters = (SELECT COUNT(*) FROM chapters WHERE book_id = ? AND deleted = 0) WHERE id = ?"
    )
    .run(bookId, bookId)
}

export function setBookMeta(bookId: number, title: string, author: string): void {
  getDb()
    .prepare('UPDATE books SET title = ?, author = ?, updated_at = ? WHERE id = ?')
    .run(title, author, Date.now(), bookId)
}

/* ---------- 章节管理（软删 / 重命名 / 内容编辑 / 合并 / 插入） ---------- */

/**
 * 手动插入章节（新增 / 单章导入）：atIdx 起全部右移一位后插入新章。
 * 当前阅读位置在插入点（含）之后 → current_chapter 同步 +1，保持停在原章。
 */
export function insertChapter(bookId: number, atIdx: number, title: string, content: string): number {
  const d = getDb()
  const tx = d.transaction(() => {
    // SQLite 的 UPDATE 不支持 ORDER BY：先抬到高空位再落回，避免 PK 瞬时冲突
    d.prepare('UPDATE chapters SET idx = idx + 1000000 WHERE book_id = ? AND idx >= ?').run(bookId, atIdx)
    d.prepare('UPDATE chapters SET idx = idx - 1000000 + 1 WHERE book_id = ? AND idx >= 1000000').run(bookId)
    d.prepare(
      "INSERT INTO chapters (book_id, idx, title, content, url, content_edited) VALUES (?, ?, ?, ?, '', 1)"
    ).run(bookId, atIdx, title.slice(0, 60), content)
    const b = d.prepare('SELECT current_chapter FROM books WHERE id = ?').get(bookId) as
      | { current_chapter: number }
      | undefined
    if (b && b.current_chapter >= atIdx) {
      d.prepare('UPDATE books SET current_chapter = current_chapter + 1 WHERE id = ?').run(bookId)
    }
    setBookChapterCount(bookId)
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })
  tx()
  return atIdx
}

export function renameChapter(bookId: number, idx: number, title: string): void {
  const d = getDb()
  d.transaction(() => {
    d.prepare('UPDATE chapters SET title = ? WHERE book_id = ? AND idx = ?').run(
      title.slice(0, 60),
      bookId,
      idx
    )
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })()
}

/** 软删：TOC/阅读/导出全部过滤；增量更新遇到 deleted=1 的 URL 跳过（防复活） */
export function softDeleteChapter(bookId: number, idx: number): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('UPDATE chapters SET deleted = 1 WHERE book_id = ? AND idx = ?').run(bookId, idx)
    setBookChapterCount(bookId)
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })
  tx()
}

/** 内容编辑：写正文并打 content_edited=1（增量更新不覆盖） */
export function editChapterContent(bookId: number, idx: number, content: string): void {
  const d = getDb()
  d.transaction(() => {
    d.prepare('UPDATE chapters SET content = ?, content_edited = 1 WHERE book_id = ? AND idx = ?').run(
      content,
      bookId,
      idx
    )
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })()
}

/** 合并到上一章：上一未删章正文追加本章，本章软删 */
export function mergeChapterUp(bookId: number, idx: number): boolean {
  const d = getDb()
  const prev = d
    .prepare('SELECT idx, content FROM chapters WHERE book_id = ? AND idx < ? AND deleted = 0 ORDER BY idx DESC LIMIT 1')
    .get(bookId, idx) as { idx: number; content: string } | undefined
  if (!prev) return false
  const cur = d
    .prepare('SELECT title, content FROM chapters WHERE book_id = ? AND idx = ? AND deleted = 0')
    .get(bookId, idx) as { title: string; content: string } | undefined
  if (!cur) return false
  const tx = d.transaction(() => {
    d.prepare('UPDATE chapters SET content = ?, content_edited = 1 WHERE book_id = ? AND idx = ?').run(
      `${prev.content}\n\n${cur.content}`,
      bookId,
      prev.idx
    )
    d.prepare('UPDATE chapters SET deleted = 1 WHERE book_id = ? AND idx = ?').run(bookId, idx)
    setBookChapterCount(bookId)
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })
  tx()
  return true
}

/** 重算疑似重复标记：相邻未删章正文 hash 相同或标题（清洗后）相同 → 后者 dup=1 */
export function markDuplicates(bookId: number): number {
  const d = getDb()
  const rows = d
    .prepare('SELECT idx, title, content FROM chapters WHERE book_id = ? AND deleted = 0 ORDER BY idx')
    .all(bookId) as { idx: number; title: string; content: string }[]
  const norm = (t: string): string => t.replace(/[\s（）()\[\]【】·，,。.]/g, '').replace(/（重）|重复$/, '')
  let n = 0
  const tx = d.transaction(() => {
    d.prepare('UPDATE chapters SET dup = 0 WHERE book_id = ?').run(bookId)
    const upd = d.prepare('UPDATE chapters SET dup = 1 WHERE book_id = ? AND idx = ?')
    for (let i = 1; i < rows.length; i++) {
      const sameTitle = norm(rows[i - 1].title) === norm(rows[i].title) && norm(rows[i].title).length > 0
      const sameContent = rows[i - 1].content === rows[i].content && rows[i].content.length > 0
      if (sameTitle || sameContent) {
        upd.run(bookId, rows[i].idx)
        n++
      }
    }
    d.prepare('UPDATE books SET chapters_rev = chapters_rev + 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      bookId
    )
  })
  tx()
  return n
}

/** 导出全文：未删章拼接（书名/作者头 + 章题 + 正文） */
export function exportNovelText(bookId: number): string | null {
  const d = getDb()
  const b = d.prepare('SELECT title, author FROM books WHERE id = ?').get(bookId) as
    | { title: string; author: string }
    | undefined
  if (!b) return null
  const rows = d
    .prepare('SELECT title, content FROM chapters WHERE book_id = ? AND deleted = 0 ORDER BY idx')
    .all(bookId) as { title: string; content: string }[]
  const parts = [b.title]
  if (b.author) parts.push(`作者：${b.author}`)
  for (const ch of rows) parts.push(`\n\n${ch.title}\n\n${ch.content}`)
  return parts.join('\n')
}

/* ---------- 书籍详情（m05661） ---------- */

export interface BookDetail {
  id: number
  title: string
  author: string
  format: string
  coverIdx: number
  coverPath: string
  downloadUrl: string
  originPath: string
  tocUrl: string
  progress: number
  chapterLabel: string
  totalChapters: number
  chapterCount: number
  createdAt: string
}

/** 详情聚合：books 行 + novel_sources.toc_url + 未删章计数 */
export function getBookDetail(bookId: number): BookDetail | null {
  const d = getDb()
  const b = d.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as BookRow | undefined
  if (!b) return null
  const ns = d
    .prepare('SELECT toc_url FROM novel_sources WHERE book_id = ?')
    .get(bookId) as { toc_url: string } | undefined
  const cc = d
    .prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND deleted = 0')
    .get(bookId) as { n: number }
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    coverIdx: b.cover_idx,
    coverPath: b.cover_path,
    downloadUrl: b.download_url || (ns ? ns.toc_url : ''),
    originPath: b.origin_path,
    tocUrl: ns ? ns.toc_url : '',
    progress: b.progress,
    chapterLabel: b.chapter_label,
    totalChapters: b.total_chapters,
    chapterCount: cc.n,
    createdAt: b.created_at
  }
}

/** 编辑：书名必填非空；下载地址/作者可清空 */
export function updateBook(
  bookId: number,
  patch: { title?: string; author?: string; downloadUrl?: string }
): boolean {
  const d = getDb()
  const b = d.prepare('SELECT id FROM books WHERE id = ?').get(bookId)
  if (!b) return false
  const sets: string[] = []
  const args: unknown[] = []
  if (patch.title !== undefined) {
    const t = patch.title.trim()
    if (!t) return false
    sets.push('title = ?')
    args.push(t)
  }
  if (patch.author !== undefined) {
    sets.push('author = ?')
    args.push(patch.author.trim())
  }
  if (patch.downloadUrl !== undefined) {
    sets.push('download_url = ?')
    args.push(patch.downloadUrl.trim())
  }
  if (!sets.length) return true
  sets.push('updated_at = ?')
  args.push(Date.now())
  d.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...args, bookId)
  return true
}

/** 封面落库（文件由 main 侧 copy 到 covers/ 后调这里） */
export function setBookCover(bookId: number, coverPath: string): void {
  const d = getDb()
  d.prepare('UPDATE books SET cover_path = ?, updated_at = ? WHERE id = ?').run(
    coverPath,
    Date.now(),
    bookId
  )
}

/* ---------- 设备同步（v2.2 M-B）---------- */

export interface SyncBookRow {
  uuid: string
  title: string
  author: string
  format: string
  coverIdx: number
  coverPath: string
  coverUrl: string
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  sortAt: number
  updatedAt: number
  chaptersRev: number
  lastReadAt: number
}

/** 手机拉书架：updated_at > since 的书（since=0 全量），不含章节正文 */
export function listSyncBooks(since: number): SyncBookRow[] {
  const rows = getDb()
    .prepare(
      `SELECT sync_uuid, title, author, format, cover_idx, cover_path, cover_url, progress, chapter_label,
              total_chapters, current_chapter, sort_at, updated_at, chapters_rev, last_read_at
       FROM books WHERE updated_at > ? ORDER BY sort_at DESC`
    )
    .all(since) as Record<string, unknown>[]
  return rows.map((r) => ({
    uuid: String(r.sync_uuid),
    title: String(r.title),
    author: String(r.author),
    format: String(r.format),
    coverIdx: Number(r.cover_idx),
    coverPath: String(r.cover_path),
    coverUrl: String(r.cover_url),
    progress: Number(r.progress),
    chapterLabel: String(r.chapter_label),
    totalChapters: Number(r.total_chapters),
    currentChapter: Number(r.current_chapter),
    sortAt: Number(r.sort_at),
    updatedAt: Number(r.updated_at),
    chaptersRev: Number(r.chapters_rev),
    lastReadAt: Number(r.last_read_at)
  }))
}

/* ---------- 阅读历史（last_read_at 仅在开书/存进度时更新）---------- */

export interface ReadHistoryRow {
  id: number
  title: string
  author: string
  format: string
  coverIdx: number
  coverPath: string
  coverUrl: string
  originPath: string
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  lastReadAt: number
}

export function listReadHistory(limit = 60): ReadHistoryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, title, author, format, cover_idx, cover_path, cover_url, origin_path, progress, chapter_label,
              total_chapters, current_chapter, last_read_at
       FROM books WHERE last_read_at > 0 ORDER BY last_read_at DESC LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    author: String(r.author),
    format: String(r.format),
    coverIdx: Number(r.cover_idx),
    coverPath: String(r.cover_path ?? ''),
    coverUrl: String(r.cover_url ?? ''),
    originPath: String(r.origin_path),
    progress: Number(r.progress),
    chapterLabel: String(r.chapter_label),
    totalChapters: Number(r.total_chapters),
    currentChapter: Number(r.current_chapter),
    lastReadAt: Number(r.last_read_at)
  }))
}

export function listTombstones(since: number): { uuid: string; deletedAt: number }[] {
  const rows = getDb()
    .prepare('SELECT uuid, deleted_at FROM mozhi_tombstones WHERE deleted_at > ?')
    .all(since) as { uuid: string; deleted_at: number }[]
  return rows.map((r) => ({ uuid: r.uuid, deletedAt: Number(r.deleted_at) }))
}

/** 手机拉章节：按书 uuid 整集分页（含软删标记，手机端据此过滤） */
export function listSyncChapters(
  uuid: string,
  offset: number,
  limit: number
): { rows: { idx: number; title: string; content: string; deleted: number; dup: number }[]; total: number } {
  const d = getDb()
  const book = d.prepare('SELECT id FROM books WHERE sync_uuid = ?').get(uuid) as
    | { id: number }
    | undefined
  if (!book) return { rows: [], total: 0 }
  const total = (d.prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?').get(book.id) as { n: number }).n
  const rows = d
    .prepare(
      'SELECT idx, title, content, deleted, dup FROM chapters WHERE book_id = ? ORDER BY idx LIMIT ? OFFSET ?'
    )
    .all(book.id, limit, offset) as { idx: number; title: string; content: string; deleted: number; dup: number }[]
  return { rows, total }
}

export interface PhoneProgressEntry {
  uuid: string
  progress: number
  currentChapter: number
  chapterLabel: string
  updatedAt: number
}

/** 手机推进度：按书 last-writer-wins（updated_at 新者胜；时钟偏移由手机端校准后上报） */
export function applyPhoneProgress(entries: PhoneProgressEntry[]): { applied: number; rejected: number } {
  const d = getDb()
  let applied = 0
  let rejected = 0
  const get = d.prepare('SELECT id, updated_at FROM books WHERE sync_uuid = ?')
  const upd = d.prepare(
    'UPDATE books SET progress = ?, current_chapter = ?, chapter_label = ?, updated_at = ? WHERE id = ?'
  )
  const tx = d.transaction(() => {
    for (const e of entries) {
      const row = get.get(e.uuid) as { id: number; updated_at: number } | undefined
      if (!row) {
        rejected++
        continue
      }
      if (e.updatedAt > row.updated_at) {
        upd.run(
          Math.max(0, Math.min(100, e.progress)),
          Math.max(0, Math.floor(e.currentChapter)),
          String(e.chapterLabel || '').slice(0, 40),
          e.updatedAt,
          row.id
        )
        applied++
      } else {
        rejected++
      }
    }
  })
  tx()
  return { applied, rejected }
}
