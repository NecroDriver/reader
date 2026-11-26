import type { SQLiteDatabase } from 'expo-sqlite'
import type { BookRow, TocRow } from './types'

/** 书库的唯一数据源。未配对时为空库，配对同步后由桌面端权威重建。 */

/** 确保书库 schema 存在（空库首次打开时建表；IF NOT EXISTS 对老库无副作用） */
export async function ensureSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      format TEXT DEFAULT 'TXT',
      cover_idx INTEGER DEFAULT 0,
      progress REAL DEFAULT 0,
      chapter_label TEXT DEFAULT '',
      sort_at REAL,
      created_at TEXT,
      total_chapters INTEGER DEFAULT 0,
      current_chapter INTEGER DEFAULT 0,
      origin_path TEXT DEFAULT '',
      cfi TEXT DEFAULT '',
      cover_path TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      download_url TEXT DEFAULT '',
      sync_uuid TEXT DEFAULT '',
      updated_at REAL DEFAULT 0,
      chapters_rev INTEGER DEFAULT 0,
      last_read_at REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chapters (
      book_id INTEGER,
      idx INTEGER,
      title TEXT,
      content TEXT,
      url TEXT DEFAULT '',
      deleted INTEGER DEFAULT 0,
      content_edited INTEGER DEFAULT 0,
      dup INTEGER DEFAULT 0,
      PRIMARY KEY (book_id, idx)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  /* 老库（旧账号体系建的表）补 LAN 同步列 */
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(books)')
  const have = new Set(cols.map((c) => c.name))
  if (!have.has('sync_uuid')) await db.execAsync("ALTER TABLE books ADD COLUMN sync_uuid TEXT DEFAULT ''")
  if (!have.has('updated_at')) await db.execAsync('ALTER TABLE books ADD COLUMN updated_at REAL DEFAULT 0')
  if (!have.has('chapters_rev')) await db.execAsync('ALTER TABLE books ADD COLUMN chapters_rev INTEGER DEFAULT 0')
  if (!have.has('last_read_at')) await db.execAsync('ALTER TABLE books ADD COLUMN last_read_at REAL DEFAULT 0')
  if (!have.has('cover_url')) await db.execAsync("ALTER TABLE books ADD COLUMN cover_url TEXT DEFAULT ''")
}

export async function listShelf(db: SQLiteDatabase): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>(
    `SELECT id, title, author, format, cover_idx, cover_path, cover_url, progress, chapter_label,
            total_chapters, current_chapter, sort_at
       FROM books
      ORDER BY sort_at DESC, id DESC`
  )
}

export async function getBook(
  db: SQLiteDatabase,
  id: number
): Promise<BookRow | null> {
  await db.runAsync('UPDATE books SET last_read_at = ? WHERE id = ?', [Date.now(), id])
  return db.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', [id])
}

export async function getToc(db: SQLiteDatabase, bookId: number): Promise<TocRow[]> {
  return db.getAllAsync<TocRow>(
    'SELECT idx, title FROM chapters WHERE book_id = ? AND deleted = 0 ORDER BY idx',
    [bookId]
  )
}

export async function getChapter(
  db: SQLiteDatabase,
  bookId: number,
  idx: number
): Promise<{ title: string; content: string } | null> {
  return db.getFirstAsync<{ title: string; content: string }>(
    'SELECT title, content FROM chapters WHERE book_id = ? AND idx = ? AND deleted = 0',
    [bookId, idx]
  )
}

export async function saveProgress(
  db: SQLiteDatabase,
  bookId: number,
  chapterIdx: number,
  pct: number,
  label: string
): Promise<void> {
  await db.runAsync(
    `UPDATE books SET progress = ?, current_chapter = ?, chapter_label = ?, updated_at = ?, last_read_at = ? WHERE id = ?`,
    [Math.min(100, Math.max(0, pct)), chapterIdx, label.slice(0, 40), Date.now(), Date.now(), bookId]
  )
}

/* ---------- LAN 设备同步（桌面为权威，手机为从库） ---------- */

/** 服务端书架行（lanSync /sync/books 返回） */
export interface SyncBookIn {
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

/** 首次同步前清掉无同步身份的旧快照残留（整库由桌面权威重建） */
export async function clearUnsyncedBooks(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `DELETE FROM chapters WHERE book_id IN (SELECT id FROM books WHERE sync_uuid IS NULL OR sync_uuid = '');
     DELETE FROM books WHERE sync_uuid IS NULL OR sync_uuid = ''`
  )
}

/** 本地是否已有该书（返回本地 id；无则 null） */
export async function findLocalBookId(db: SQLiteDatabase, uuid: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM books WHERE sync_uuid = ?', [uuid])
  return row?.id ?? null
}

/** 本地行的章节集版本（无行/无列信息返回 -1，触发整集拉取） */
export async function localChaptersRev(db: SQLiteDatabase, localId: number): Promise<number> {
  const row = await db.getFirstAsync<{ rev: number }>(
    'SELECT chapters_rev AS rev FROM books WHERE id = ?',
    [localId]
  )
  return row?.rev ?? -1
}

/**
 * 落一条服务端书架行。元数据始终覆盖；进度按 LWW（仅当服务端比本地「更旧进度」时
 * 保留本地——本地 updated_at 是手机自己的时钟戳，只在手机阅读时更新）。
 * 返回本地 id（新建或既有）。
 */
export async function upsertSyncBook(db: SQLiteDatabase, b: SyncBookIn): Promise<number> {
  const existing = await findLocalBookId(db, b.uuid)
  if (existing == null) {
    const r = await db.runAsync(
      `INSERT INTO books
         (title, author, format, cover_idx, cover_path, cover_url, progress, chapter_label,
          total_chapters, current_chapter, sort_at, created_at, sync_uuid, updated_at, chapters_rev, last_read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, 0, ?, ?)`,
      [
        b.title, b.author, b.format, b.coverIdx, b.coverPath, b.coverUrl ?? '', b.progress, b.chapterLabel,
        b.totalChapters, b.currentChapter, b.sortAt, b.uuid, b.chaptersRev, b.lastReadAt ?? 0
      ]
    )
    return Number(r.lastInsertRowId)
  }
  await db.runAsync(
    `UPDATE books SET title = ?, author = ?, format = ?, cover_idx = ?, cover_path = ?,
        cover_url = CASE WHEN ? != '' THEN ? ELSE cover_url END,
        total_chapters = ?, sort_at = ?, chapters_rev = ?,
        last_read_at = CASE WHEN last_read_at < ? THEN ? ELSE last_read_at END
      WHERE id = ?`,
    [b.title, b.author, b.format, b.coverIdx, b.coverPath,
      b.coverUrl ?? '', b.coverUrl ?? '',
      b.totalChapters, b.sortAt, b.chaptersRev,
      b.lastReadAt ?? 0, b.lastReadAt ?? 0, existing]
  )
  /* 进度 LWW：本地 updated_at 非零=手机读过且未上推过，仅当服务端时间更新才覆盖 */
  await db.runAsync(
    `UPDATE books SET progress = ?, current_chapter = ?, chapter_label = ?
       WHERE id = ? AND updated_at < ?`,
    [b.progress, b.currentChapter, b.chapterLabel, existing, b.updatedAt]
  )
  return existing
}

/** 整集替换章节（chapters_rev 变化时；含软删行，读取侧自会过滤）。
 *  分页拉取时首页用全量替换、后续页 append（否则每页都会把前页删掉）。 */
export async function replaceChapters(
  db: SQLiteDatabase,
  localId: number,
  rows: { idx: number; title: string; content: string; deleted: number; dup: number }[],
  opts?: { append?: boolean }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (!opts?.append) await db.runAsync('DELETE FROM chapters WHERE book_id = ?', [localId])
    for (const r of rows) {
      await db.runAsync(
        'INSERT INTO chapters (book_id, idx, title, content, deleted, dup) VALUES (?, ?, ?, ?, ?, ?)',
        [localId, r.idx, r.title, r.content, r.deleted, r.dup]
      )
    }
  })
}

export async function deleteBooksByUuids(db: SQLiteDatabase, uuids: string[]): Promise<number> {
  if (!uuids.length) return 0
  await db.withTransactionAsync(async () => {
    for (const u of uuids) {
      await db.runAsync('DELETE FROM chapters WHERE book_id IN (SELECT id FROM books WHERE sync_uuid = ?)', [u])
      await db.runAsync('DELETE FROM books WHERE sync_uuid = ?', [u])
    }
  })
  return uuids.length
}

/** 收集待回传的进度（updated_at 仅由手机阅读行为置位，天然防回声） */
export async function collectProgressEntries(
  db: SQLiteDatabase,
  since: number
): Promise<
  { uuid: string; progress: number; currentChapter: number; chapterLabel: string; updatedAt: number }[]
> {
  return db.getAllAsync(
    `SELECT sync_uuid AS uuid, progress, current_chapter AS currentChapter,
            chapter_label AS chapterLabel, updated_at AS updatedAt
       FROM books
      WHERE sync_uuid != '' AND progress > 0 AND updated_at > ?
      ORDER BY updated_at ASC
      LIMIT 2000`,
    [since]
  )
}

export async function countBooks(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM books')
  return row?.n ?? 0
}

export interface HistoryRow {
  id: number
  title: string
  author: string
  format: string
  cover_idx: number
  progress: number
  chapter_label: string
  total_chapters: number
  current_chapter: number
  last_read_at: number
}

/** 阅读历史（最近阅读优先，只含有阅读痕迹的书） */
export async function listHistory(db: SQLiteDatabase): Promise<HistoryRow[]> {
  return db.getAllAsync<HistoryRow>(
    `SELECT id, title, author, format, cover_idx, progress, chapter_label,
            total_chapters, current_chapter, last_read_at
       FROM books
      WHERE last_read_at > 0
      ORDER BY last_read_at DESC
      LIMIT 100`
  )
}

export async function getSetting(
  db: SQLiteDatabase,
  key: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  )
  return row?.value ?? null
}

export async function setSetting(
  db: SQLiteDatabase,
  key: string,
  value: string
): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )
}
