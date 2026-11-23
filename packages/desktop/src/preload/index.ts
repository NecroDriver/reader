import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 主进程返回蛇形命名行，此处统一映射为驼峰供渲染层使用
function mapBook(r: any) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    format: r.format,
    coverIdx: r.cover_idx,
    progress: r.progress,
    chapterLabel: r.chapter_label,
    totalChapters: r.total_chapters ?? 0,
    currentChapter: r.current_chapter ?? 0,
    originPath: r.origin_path ?? '',
    coverPath: (r.cover_path ?? '') as string
  }
}
function mapArticle(r: any) {
  return { id: r.id, title: r.title, source: r.source, sourceId: r.source_id ?? 0, url: r.url ?? '', author: r.author ?? '', publishedAt: r.published_at, unread: !!r.unread, progress: r.progress, isNew: !!r.is_new, sortAt: r.sort_at }
}
function mapSource(r: any) {
  return { id: r.id, name: r.name, url: r.url, type: r.type, intervalMinutes: r.interval_minutes, lastPullAt: r.last_pull_at, lastCount: r.last_count, enabled: !!r.enabled }
}

export interface ImportOutcome {
  ok: boolean
  bookId?: number
  title?: string
  chapters?: number
  error?: string
}

export interface CloudCfgView {
  enabled: boolean
  provider: 'webdav' | 's3'
  webdav: { url: string; dir: string; username: string }
  s3: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
  lastUploadAt: string
  lastDownloadAt: string
  secretStored: boolean
}

export interface CloudManifestSummary {
  app: string
  createdAt: string
  books: number
  articles: number
  chapters: number
  sources: number
  covers: number
  zipBytes: number
}

const api = {
  getShelf: async () => {
    const s = await ipcRenderer.invoke('library:getShelf')
    return {
      books: (s.books || []).map(mapBook),
      articles: (s.articles || []).map(mapArticle),
      sources: (s.sources || []).map(mapSource),
      lastSyncAt: s.last_sync_at
    }
  },
  /** 拖放导入：渲染层 File 对象 → 真实路径 */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** 按路径导入（拖放） */
  importPaths: (paths: string[]): Promise<ImportOutcome[]> =>
    ipcRenderer.invoke('library:importPaths', paths),
  /** 原生对话框选文件并导入 */
  pickAndImport: (): Promise<ImportOutcome[]> => ipcRenderer.invoke('library:pickAndImport'),
  openBook: async (bookId: number) => {
    const b = await ipcRenderer.invoke('book:open', bookId)
    if (!b) return null
    return {
      id: b.id,
      title: b.title,
      author: b.author,
      format: b.format,
      totalChapters: b.totalChapters,
      currentChapter: b.currentChapter,
      progress: b.progress,
      cfi: (b.cfi || '') as string,
      toc: (b.toc || []) as { idx: number; title: string; dup: boolean }[]
    }
  },
  /** 读取二进制书源（EPUB/PDF） */
  readBookFile: (bookId: number): Promise<{ format: string; data: ArrayBuffer } | null> =>
    ipcRenderer.invoke('book:readFile', bookId),
  getChapter: (bookId: number, idx: number): Promise<{ title: string; content: string } | null> =>
    ipcRenderer.invoke('book:getChapter', bookId, idx),
  saveProgress: (
    bookId: number,
    chapterIdx: number,
    pct: number,
    label: string,
    cfi?: string
  ): Promise<void> => ipcRenderer.invoke('book:saveProgress', bookId, chapterIdx, pct, label, cfi ?? ''),
  /** 删除书架上的书（连章节/在线源记录），返回是否已删 */
  deleteBook: (bookId: number): Promise<void> => ipcRenderer.invoke('book:delete', bookId),

  /* 书籍详情 */
  getBookDetail: async (bookId: number) => {
    const d = await ipcRenderer.invoke('book:getDetail', bookId)
    if (!d) return null
    return {
      id: d.id,
      title: d.title,
      author: d.author,
      format: d.format,
      coverIdx: d.coverIdx,
      coverPath: d.coverPath ?? '',
      downloadUrl: d.downloadUrl ?? '',
      originPath: d.originPath ?? '',
      tocUrl: d.tocUrl ?? '',
      progress: d.progress,
      chapterLabel: d.chapterLabel,
      totalChapters: d.totalChapters,
      chapterCount: d.chapterCount,
      createdAt: d.createdAt
    }
  },
  updateBook: (
    bookId: number,
    patch: { title?: string; author?: string; downloadUrl?: string }
  ): Promise<boolean> => ipcRenderer.invoke('book:update', bookId, patch),
  pickCover: (
    bookId: number
  ): Promise<{ ok: boolean; canceled?: boolean; error?: string; name?: string }> =>
    ipcRenderer.invoke('cover:pick', bookId),
  clearCover: (bookId: number): Promise<boolean> => ipcRenderer.invoke('cover:clear', bookId),

  /* 订阅源 */
  addSource: (input: { name: string; url: string; type: string; intervalMinutes: number }): Promise<{
    id: number
    name: string
    url: string
    type: string
    intervalMinutes: number
    lastPullAt: string | null
    lastCount: number
    enabled: boolean
  }> => ipcRenderer.invoke('source:add', input),
  updateSource: (
    id: number,
    patch: { intervalMinutes?: number; enabled?: boolean; name?: string }
  ): Promise<void> => ipcRenderer.invoke('source:update', id, patch),
  removeSource: (id: number): Promise<void> => ipcRenderer.invoke('source:remove', id),
  pullSource: (id: number): Promise<{ ok: boolean; sourceId: number; sourceName: string; added: number; error?: string }> =>
    ipcRenderer.invoke('source:pull', id),
  pullAllSources: (): Promise<
    { ok: boolean; sourceId: number; sourceName: string; added: number; error?: string }[]
  > => ipcRenderer.invoke('sources:pullAll'),
  getPullLogs: (): Promise<
    { at: string; name: string; added: number; ok: boolean; error?: string }[]
  > => ipcRenderer.invoke('sync:getLogs'),
  onSyncProgress: (
    cb: (p: { done: number; total: number; name: string; finished: boolean }) => void
  ): (() => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; name: string; finished: boolean }): void =>
      cb(p)
    ipcRenderer.on('sync:progress', listener)
    return () => ipcRenderer.removeListener('sync:progress', listener)
  },

  /* 文章 */
  openArticle: (id: number): Promise<{
    id: number
    title: string
    source: string
    author: string
    publishedAt: string
    url: string
    contentHtml: string
    progress: number
  } | null> => ipcRenderer.invoke('article:open', id),
  saveArticleProgress: (id: number, pct: number): Promise<void> =>
    ipcRenderer.invoke('article:saveProgress', id, pct),

  /* 设置与数据管理 */
  getSettings: (): Promise<{
    autostart: boolean
    closeToTray: boolean
    pullOnStart: boolean
    bossKey: string
    bossKeyCustom: boolean
  }> => ipcRenderer.invoke('settings:getAll'),
  setBossKey: (accel: string): Promise<{ key: string; custom: boolean; ok: boolean }> =>
    ipcRenderer.invoke('boss:setKey', accel),
  resetBossKey: (): Promise<{ key: string; custom: boolean; ok: boolean }> =>
    ipcRenderer.invoke('boss:resetKey'),
  setSetting: (key: 'autostart' | 'close_to_tray' | 'pull_on_start', value: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),
  clearArticles: (): Promise<boolean> => ipcRenderer.invoke('data:clearArticles'),
  getDataDirInfo: (): Promise<{ current: string; defaultDir: string; custom: string | null }> =>
    ipcRenderer.invoke('data:getDirInfo'),
  pickDataDir: (): Promise<{ canceled: true } | { canceled: false; dir: string }> =>
    ipcRenderer.invoke('data:pickAndSetDir'),
  resetDataDir: (): Promise<boolean> => ipcRenderer.invoke('data:resetDir'),
  getLogDir: (): Promise<string> => ipcRenderer.invoke('logs:getDir'),
  openLogDir: (): Promise<string> => ipcRenderer.invoke('logs:openDir'),
  /** 主进程数据变化（托盘拉取/清空文章）时通知渲染层刷新书架 */
  onShelfChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('shelf:changed', listener)
    return () => ipcRenderer.removeListener('shelf:changed', listener)
  },
  /** 同步记录变化（小说抓取进度写入 pull_log）时刷新订阅页「同步记录」 */
  onSyncLogChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('sync-log:changed', listener)
    return () => ipcRenderer.removeListener('sync-log:changed', listener)
  },

  /* 在线小说 */
  createNovel: (tocUrl: string): Promise<{ ok: boolean; bookId?: number; title?: string; author?: string; chapters?: number; error?: string }> =>
    ipcRenderer.invoke('novel:create', tocUrl),
  pauseNovel: (bookId: number): Promise<NovelJob | null> => ipcRenderer.invoke('novel:pause', bookId),
  resumeNovel: (bookId: number): Promise<NovelJob | null> => ipcRenderer.invoke('novel:resume', bookId),
  recrawlNovel: (bookId: number): Promise<NovelJob | null> => ipcRenderer.invoke('novel:recrawl', bookId),
  novelStatus: (bookId: number): Promise<NovelJob | null> => ipcRenderer.invoke('novel:status', bookId),
  renameNovel: (bookId: number, title: string, author: string): Promise<boolean> =>
    ipcRenderer.invoke('novel:renameBook', bookId, title, author),
  exportNovel: (
    bookId: number,
    encoding: 'utf-8' | 'gbk'
  ): Promise<{ canceled: true } | { canceled: false; path: string }> =>
    ipcRenderer.invoke('novel:export', bookId, encoding),
  onNovelProgress: (
    cb: (s: { bookId: number } & NovelJob) => void
  ): (() => void) => {
    const listener = (_e: unknown, s: { bookId: number } & NovelJob): void => cb(s)
    ipcRenderer.on('novel:progress', listener)
    return () => ipcRenderer.removeListener('novel:progress', listener)
  },

  /* 章节管理 */
  insertChapter: (bookId: number, atIdx: number, title: string, content: string): Promise<number> =>
    ipcRenderer.invoke('chapter:insert', bookId, atIdx, title, content),
  renameChapter: (bookId: number, idx: number, title: string): Promise<boolean> =>
    ipcRenderer.invoke('chapter:rename', bookId, idx, title),
  deleteChapter: (bookId: number, idx: number): Promise<boolean> =>
    ipcRenderer.invoke('chapter:delete', bookId, idx),
  editChapterContent: (bookId: number, idx: number, content: string): Promise<boolean> =>
    ipcRenderer.invoke('chapter:editContent', bookId, idx, content),
  mergeChapterUp: (bookId: number, idx: number): Promise<boolean> =>
    ipcRenderer.invoke('chapter:mergeUp', bookId, idx),
  markDupChapters: (bookId: number): Promise<number> => ipcRenderer.invoke('chapter:markDup', bookId),

  /* 网络代理 */
  getProxy: (): Promise<{ on: boolean; url: string }> => ipcRenderer.invoke('proxy:get'),
  saveProxy: (url: string, on: boolean): Promise<boolean> => ipcRenderer.invoke('proxy:save', url, on),
  testProxy: (): Promise<{ ok: boolean; status?: number; error?: string }> => ipcRenderer.invoke('proxy:test'),

  /* 账号与会话（本地多账号，数据隔离） */
  getSession: (): Promise<
    | { mode: 'app'; env: boolean; account: { id: string; name: string } | null }
    | { mode: 'login'; env: false; accounts: { id: string; name: string; hasPassword: boolean; lastUsedAt: string; active: boolean }[] }
  > => ipcRenderer.invoke('session:current'),
  listAccounts: (): Promise<
    { id: string; name: string; hasPassword: boolean; lastUsedAt: string; active: boolean }[]
  > => ipcRenderer.invoke('accounts:list'),
  loginAccount: (
    id: string,
    password: string,
    remember: boolean
  ): Promise<{ ok: true; account: { id: string; name: string } } | { ok: false; error: string }> =>
    ipcRenderer.invoke('session:login', id, password, remember),
  createAccount: (
    name: string,
    password: string,
    remember: boolean
  ): Promise<{ ok: true; account: { id: string; name: string } } | { ok: false; error: string }> =>
    ipcRenderer.invoke('accounts:create', name, password, remember),
  logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('session:logout'),

  /* 云同步（通用快照：WebDAV / S3 兼容） */
  getCloudConfig: (): Promise<CloudCfgView> => ipcRenderer.invoke('cloud:getConfig'),
  saveCloudConfig: (patch: {
    enabled?: boolean
    provider?: 'webdav' | 's3'
    webdav?: { url: string; dir: string; username: string }
    s3?: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
    webdavPassword?: string
    s3SecretAccessKey?: string
  }): Promise<CloudCfgView> => ipcRenderer.invoke('cloud:saveConfig', patch),
  testCloud: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('cloud:test'),
  uploadCloud: (): Promise<{ ok: boolean; message: string; manifest?: CloudManifestSummary }> =>
    ipcRenderer.invoke('cloud:upload'),
  downloadCloud: (): Promise<{ ok: boolean; message: string; manifest: CloudManifestSummary | null }> =>
    ipcRenderer.invoke('cloud:download'),
  applyCloudRestore: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('cloud:applyRestore'),
  discardCloudRestore: (): Promise<boolean> => ipcRenderer.invoke('cloud:discardRestore'),
  cloudRemoteInfo: (): Promise<{ exists: boolean; manifest?: CloudManifestSummary; message?: string }> =>
    ipcRenderer.invoke('cloud:remoteInfo')
}

export interface NovelJob {
  bookId: number
  status: 'running' | 'paused' | 'idle' | 'error'
  done: number
  total: number
  currentTitle: string
  error?: string
}

contextBridge.exposeInMainWorld('mozhi', api)
export type MozhiApi = typeof api
