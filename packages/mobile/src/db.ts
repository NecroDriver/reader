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
    `UPDATE books SET progress = ?, current_chapter = ?, chapter_label = ? WHERE id = ?`,
    [Math.min(100, Math.max(0, pct)), chapterIdx, label.slice(0, 40), bookId]
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
