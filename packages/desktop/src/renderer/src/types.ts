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
export interface Shelf {
  books: Book[]
  lastSyncAt: string
}
export type ViewName = 'shelf' | 'store' | 'history' | 'sources' | 'settings'

export interface StoreResultItem {
  siteId: string
  siteName: string
  title: string
  author: string
  status: string
  category: string
  latestChapter: string
  tocUrl: string
  coverUrl: string
}

export interface HistoryItem {
  id: number
  title: string
  author: string
  format: string
  coverIdx: number
  originPath: string
  progress: number
  chapterLabel: string
  totalChapters: number
  currentChapter: number
  lastReadAt: number
}

export interface CoverPickResult {
  ok: boolean
  canceled?: boolean
  error?: string
  name?: string
}
