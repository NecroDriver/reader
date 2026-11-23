export interface Book {
  id: number
  title: string
  author: string
  format: string
  coverIdx: number
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  originPath: string
  coverPath: string
}
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
export interface NovelJobState {
  bookId: number
  status: 'running' | 'paused' | 'idle' | 'error'
  done: number
  total: number
  currentTitle: string
  error?: string
}
export interface PullLogEntry {
  at: string
  name: string
  added: number
  ok: boolean
  error?: string
  /** 手动拉取全部但没有任何启用源 */
  empty?: boolean
  /** 小说抓取任务（订阅页「同步记录」里展示实时进度） */
  kind?: 'novel'
  bookId?: number
  running?: boolean
  paused?: boolean
  done?: number
  total?: number
}
export interface SyncProgress {
  done: number
  total: number
  name: string
  finished: boolean
}
export interface ImportOutcome {
  ok: boolean
  bookId?: number
  title?: string
  chapters?: number
  error?: string
}
export interface Article {
  id: number
  title: string
  source: string
  sourceId: number
  url: string
  author: string
  publishedAt: string
  unread: boolean
  progress: number
  isNew: boolean
  sortAt: number
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
export interface PullOutcome {
  ok: boolean
  sourceId: number
  sourceName: string
  added: number
  error?: string
}
export interface Source {
  id: number
  name: string
  url: string
  type: string
  intervalMinutes: number
  lastPullAt: string | null
  lastCount: number
  enabled: boolean
}
export interface Shelf {
  books: Book[]
  articles: Article[]
  sources: Source[]
  lastSyncAt: string
}
export type ViewName = 'shelf' | 'sources' | 'settings'

export interface CoverPickResult {
  ok: boolean
  canceled?: boolean
  error?: string
  name?: string
}
