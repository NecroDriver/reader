import type { SQLiteDatabase } from 'expo-sqlite'
import type { BookRow, TocRow } from './types'

/** 设备快照的读写封装。只读除 books 阅读进度与 settings 显示偏好以外的表。 */

export async function listShelf(db: SQLiteDatabase): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>(
    `SELECT id, title, author, format, cover_idx, cover_path, progress, chapter_label,
            total_chapters, current_chapter, sort_at
       FROM books
      ORDER BY sort_at DESC, id DESC`
  )
}

export async function getBook(
  db: SQLiteDatabase,
  id: number
): Promise<BookRow | null> {
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
    `UPDATE books SET progress = ?, current_chapter = ?, chapter_label = ?, updated_at = ? WHERE id = ?`,
    [Math.min(100, Math.max(0, pct)), chapterIdx, label.slice(0, 40), Date.now(), bookId]
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
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  sortAt: number
  updatedAt: number
  chaptersRev: number
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
         (title, author, format, cover_idx, cover_path, progress, chapter_label,
          total_chapters, current_chapter, sort_at, created_at, sync_uuid, updated_at, chapters_rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, 0, ?)`,
      [
        b.title, b.author, b.format, b.coverIdx, b.coverPath, b.progress, b.chapterLabel,
        b.totalChapters, b.currentChapter, b.sortAt, b.uuid, b.chaptersRev
      ]
    )
    return Number(r.lastInsertRowId)
  }
  await db.runAsync(
    `UPDATE books SET title = ?, author = ?, format = ?, cover_idx = ?, cover_path = ?,
        total_chapters = ?, sort_at = ?, chapters_rev = ? WHERE id = ?`,
    [b.title, b.author, b.format, b.coverIdx, b.coverPath, b.totalChapters, b.sortAt, b.chaptersRev, existing]
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
