import { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, session, net, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initUserData, defaultDataDir } from './bootstrap'
import { initBossKey, registerBossIpc } from './boss'
import { getLogDir, logEvent } from './logger'
import {
  getShelf,
  importLocalFiles,
  openBook,
  getChapter,
  saveProgress,
  readBookFile,
  setSetting,
  getSetting,
  getPullLogs,
  createNovelBook,
  getNovelSource,
  listChapterUrls,
  appendChapters,
  countChapters,
  updateNovelProgress,
  setBookChapterCount,
  setBookMeta,
  renameChapter,
  softDeleteChapter,
  insertChapter,
  editChapterContent,
  mergeChapterUp,
  markDuplicates,
  exportNovelText,
  resetNovelChapters,
  deleteBook,
  getBookDetail,
  updateBook,
  setBookCover,
  upsertNovelPullLog,
  markStaleNovelLogs,
  dropNovelPullLog,
  getBookTitleById,
  closeDb,
  listOnlineBookIds
} from './db'
import { parseTocPages, writeTxtFile } from './novel'
import {
  setNovelDb,
  setNovelProgressSink,
  crawlNovel,
  pauseNovel,
  resumeNovel,
  getJob,
  updateAllNovels
} from './novelJob'
import {
  bindCloseToTray,
  boolSetting,
  createTray,
  destroyTray,
  markQuitting,
  registerSettingsIpc
} from './tray'
import {
  activateAccount,
  activateGuest,
  clearRemember,
  createAndActivate,
  deactivateAccount,
  getActiveAccount,
  getAccountDataDir,
  isGuestActive,
  listAccounts,
  setAccountDataDir,
  startupSession,
  writeRemember
} from './accounts'
import {
  applyPendingRestore,
  applyPhoneProgress,
  discardPendingRestore,
  downloadSnapshot,
  fetchPhoneProgress,
  getCloudConfigView,
  rememberPendingRestore,
  remoteInfo,
  setCloudConfig,
  testCloudConnection,
  uploadSnapshot
} from './cloudSync'
import { resetNovelJobs } from './novelJob'

let mainWindow: BrowserWindow | null = null

/* 账号体系引导（替代旧 initUserData 单用户引导）：
   - MOZHI_DATA_DIR 直通（自动化测试），行为与旧版一致；
   - 注册表里有最近账号，且（无口令 或 本机留有「记住我」凭据）→ 自动进入；
   - 否则停在基座目录（不碰任何账号库），渲染层展示登录页，session:login 后再进入。 */
type BootMode = { mode: 'env' } | { mode: 'login' } | { mode: 'auto'; account: { id: string; name: string } }
const bootSession: BootMode = (() => {
  const s = startupSession()
  if (s.mode === 'env') {
    initUserData()
    return { mode: 'env' }
  }
  if (s.mode === 'auto' && !process.env.MOZHI_ACCT_TEST) {
    const err = activateAccount(s.account.id, s.rememberedPassword ?? '')
    if (err === null) return { mode: 'auto', account: { id: s.account.id, name: s.account.name } }
    /* 自动进入失败（目录被删等）→ 落到登录页人工处理 */
  }
  /* 停在登录页时，dev 构建同样落 -dev 基座：
     ① 不与正式版抢生产 userData 的单实例锁（否则 dev 一启动就把用户正在用的正式版顶掉）；
     ② 日志/缓存与账号注册表（defaultDataDir()）同基座，不再一份写生产一份读 -dev。 */
  if (!app.isPackaged) app.setPath('userData', defaultDataDir())
  return { mode: 'login' }
})()

/** 当前是否有可用会话（env 或已登录）——决定 db 依赖操作是否放行 */
let sessionActive = bootSession.mode !== 'login'

function requireSession(): void {
  if (!sessionActive) throw new Error('请先登录账号')
}

/* 单实例锁：必须尽早调用。抢不到时先不退出——见下方 whenReady 前的轮询接管逻辑 */
let gotLock = app.requestSingleInstanceLock()

/* ---------- 自定义封面：mozhi-cover:<bookId>.<ext> → userData/covers/ ---------- */
protocol.registerSchemesAsPrivileged([
  { scheme: 'mozhi-cover', privileges: { supportFetchAPI: true, stream: true } }
])

function coversDir(): string {
  return join(app.getPath('userData'), 'covers')
}

/** 把用户选的图片复制进 covers/（book-<id>.<ext>），返回相对文件名 */
function importCoverFile(bookId: number, srcPath: string): string | null {
  const m = /\.(jpe?g|png|webp|bmp|gif)$/i.exec(srcPath)
  if (!m) return null
  const name = `book-${bookId}.${m[1].toLowerCase()}`
  mkdirSync(coversDir(), { recursive: true })
  /* 清掉同书旧封面（不同扩展名） */
  for (const f of readdirSync(coversDir())) {
    if (f.startsWith(`book-${bookId}.`)) {
      try {
        unlinkSync(join(coversDir(), f))
      } catch {
        /* 忽略 */
      }
    }
  }
  copyFileSync(srcPath, join(coversDir(), name))
  return name
}

function clearCoverFile(bookId: number): void {
  try {
    for (const f of readdirSync(coversDir())) {
      if (f.startsWith(`book-${bookId}.`)) unlinkSync(join(coversDir(), f))
    }
  } catch {
    /* 目录不存在等，忽略 */
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F5EFE3',
    title: '墨纸 Mozhi Reader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())
  bindCloseToTray(win)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win

  // dev 诊断：确认渲染层书架真实渲染（延后等待 IPC 数据就位）
  if (is.dev) {
    win.webContents.on('did-finish-load', () => {
      const probe = (): Promise<void> =>
        win.webContents
          .executeJavaScript(
            `({ stats: document.querySelector('.stats')?.textContent ?? null, cards: document.querySelectorAll('.card').length, books: document.querySelectorAll('.card.book').length, articles: document.querySelectorAll('.card.article').length })`
          )
          .then((r) => console.log('[diagnostic] SHELF_RENDER', JSON.stringify(r)))
          .catch((e) => console.log('[diagnostic] SHELF_RENDER_FAIL', String(e))) as Promise<void>
      setTimeout(probe, 1000)
      setTimeout(probe, 2500)
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void (async (): Promise<void> => {
  /* 抢不到锁：老实例（0.1.4+）收到 second-instance 会主动退出让位，这里轮询等它放手，
     实现「后启动者接管」——测试环境与正式环境共用同一个库时切换不打架。
     旧版本持有锁时不会让位，重试耗尽后弹提示退出。 */
  if (!gotLock) {
    for (let i = 0; i < 12 && !gotLock; i++) {
      await new Promise((r) => setTimeout(r, 250))
      gotLock = app.requestSingleInstanceLock()
    }
    if (!gotLock) {
      dialog.showErrorBox(
        '墨纸 Mozhi Reader',
        '另一个墨纸实例正在运行（可能是旧版本，不会自动让位）。\n请先从系统托盘退出它，再重新启动墨纸。'
      )
      app.quit()
      return
    }
  }
  /* 新实例启动时本实例让位退出（接管模式） */
  app.on('second-instance', () => {
    app.quit()
  })
  await app.whenReady()
  electronApp.setAppUserModelId('com.mozhi.reader')

  /* mozhi-cover:<name> → covers/ 下同名文件（仅白名单扩展，防任意文件读取） */
  protocol.handle('mozhi-cover', (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
    if (!/^book-\d+\.(jpe?g|png|webp|bmp|gif)$/i.test(name)) {
      return new Response('not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(join(coversDir(), name)).toString())
  })

  app.on('browser-window-created', (_e, win) => {
    optimizer.watchWindowShortcuts(win)
  })

  ipcMain.handle('library:getShelf', () => getShelf())
  ipcMain.handle('library:importPaths', (_e, paths: string[]) => importLocalFiles(paths))
  ipcMain.handle('library:pickAndImport', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return []
    const r = await dialog.showOpenDialog(win, {
      title: '导入本地图书',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图书文件', extensions: ['txt', 'md', 'epub', 'pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (r.canceled || r.filePaths.length === 0) return []
    return importLocalFiles(r.filePaths)
  })
  ipcMain.handle('book:open', (_e, bookId: number) => openBook(bookId))
  ipcMain.handle('book:readFile', (_e, bookId: number) => readBookFile(bookId))
  ipcMain.handle('book:getChapter', (_e, bookId: number, idx: number) => getChapter(bookId, idx))
  ipcMain.handle(
    'book:saveProgress',
    (_e, bookId: number, ch: number, pct: number, label: string, cfi: string) =>
      saveProgress(bookId, ch, pct, label, cfi)
  )
  ipcMain.handle('book:delete', (_e, bookId: number) => {
    deleteBook(bookId)
    mainWindow?.webContents.send('shelf:changed')
  })
  ipcMain.handle('book:getDetail', (_e, bookId: number) => getBookDetail(bookId))
  ipcMain.handle(
    'book:update',
    (
      _e,
      bookId: number,
      patch: { title?: string; author?: string; downloadUrl?: string }
    ): boolean => {
      const ok = updateBook(bookId, patch)
      if (ok) mainWindow?.webContents.send('shelf:changed')
      return ok
    }
  )
  ipcMain.handle('cover:pick', async (_e, bookId: number) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { ok: false, error: 'window' } as const
    const r = await dialog.showOpenDialog(win, {
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true } as const
    const name = importCoverFile(bookId, r.filePaths[0])
    if (!name) return { ok: false, error: 'format' } as const
    setBookCover(bookId, name)
    mainWindow?.webContents.send('shelf:changed')
    logEvent('app', 'info', `已设置书籍封面（book=${bookId}）`)
    return { ok: true, name } as const
  })
  ipcMain.handle('cover:clear', (_e, bookId: number) => {
    clearCoverFile(bookId)
    setBookCover(bookId, '')
    mainWindow?.webContents.send('shelf:changed')
    return true
  })

  /* 同步记录 + 更新全部小说 */
  ipcMain.handle('sync:getLogs', () => getPullLogs())
  ipcMain.handle('novels:updateAll', async () => {
    const r = await updateAllNovels()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const d = new Date()
    setSetting('last_sync_at', `${pad(d.getHours())}:${pad(d.getMinutes())}`)
    mainWindow?.webContents.send('shelf:changed')
    logEvent('novel', 'info', `更新全部：检查 ${r.checked} 本，${r.updatedBooks} 本有更新，共新增 ${r.addedChapters} 章`)
    return r
  })

  /* 设置与数据管理 */
  registerSettingsIpc()
  ipcMain.handle('data:getDirInfo', () => ({
    current: app.getPath('userData'),
    defaultDir: defaultDataDir(),
    custom: getAccountDataDir()
  }))
  ipcMain.handle('data:pickAndSetDir', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win!, {
      title: '选择墨纸数据目录',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return { canceled: true } as const
    setAccountDataDir(r.filePaths[0])
    return { canceled: false, dir: r.filePaths[0] } as const
  })
  ipcMain.handle('data:resetDir', () => {
    setAccountDataDir(null)
    return true
  })

  /* ---------- 运行日志 ---------- */
  ipcMain.handle('logs:getDir', () => getLogDir())
  ipcMain.handle('logs:openDir', () => shell.openPath(getLogDir()))

  /* ---------- 在线小说 ---------- */
  if (sessionActive) markStaleNovelLogs() // 上次异常退出时残留的 running 条目 → 标记中断（登录后同样补跑）
  setNovelDb({
    getNovelSource: (bookId) => {
      const r = getNovelSource(bookId)
      return r ? { tocUrl: r.toc_url, cursorUrl: r.cursor_url } : null
    },
    listChapterUrls,
    appendChapters,
    countChapters,
    updateNovelProgress,
    setBookChapterCount,
    listOnlineBookIds
  })
  /* 小说抓取进度：推给阅读页 + 写入订阅页「同步记录」（唯一活条目带实时进度） */
  const novelLive = new Set<number>()
  setNovelProgressSink((bookId, s) => {
    mainWindow?.webContents.send('novel:progress', { ...s, bookId })
    const title = getBookTitleById(bookId) || `小说 #${bookId}`
    if (s.status === 'running' || s.status === 'paused') {
      novelLive.add(bookId)
      upsertNovelPullLog(bookId, title, {
        running: s.status === 'running',
        paused: s.status === 'paused',
        done: s.done,
        total: s.total,
        ok: true
      })
    } else if (novelLive.has(bookId)) {
      novelLive.delete(bookId)
      if (s.status !== 'error' && s.total === 0) {
        // 打开书时的自动检查没有新章节：静默，不留「没有新章节」噪音记录
        dropNovelPullLog(bookId)
      } else if (s.status === 'error') {
        upsertNovelPullLog(bookId, title, {
          running: false,
          paused: false,
          done: s.done,
          total: s.total,
          ok: false,
          error: s.error
        })
      } else {
        upsertNovelPullLog(bookId, title, {
          running: false,
          paused: false,
          done: s.done,
          total: s.total,
          ok: true,
          added: s.done
        })
      }
    } else {
      return
    }
    mainWindow?.webContents.send('sync-log:changed')
  })
  ipcMain.handle('novel:create', async (_e, tocUrl: string) => {
    try {
      const toc = await parseTocPages(tocUrl)
      if (toc.chapters.length < 3) {
        return { ok: false, error: `目录解析到 ${toc.chapters.length} 章，疑似不是目录页` }
      }
      const bookId = createNovelBook(tocUrl, toc.bookTitle, toc.author, toc.chapters.length)
      const src = getNovelSource(bookId)
      if (src && src.status !== 'running') void crawlNovel(bookId)
      return { ok: true, bookId, title: toc.bookTitle, author: toc.author, chapters: toc.chapters.length }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('novel:pause', (_e, bookId: number) => {
    pauseNovel(bookId)
    return getJob(bookId)
  })
  ipcMain.handle('novel:resume', (_e, bookId: number) => {
    const s = resumeNovel(bookId)
    return { ...s }
  })
  ipcMain.handle('novel:recrawl', (_e, bookId: number) => {
    resetNovelChapters(bookId)
    void crawlNovel(bookId).catch(() => {})
    return getJob(bookId)
  })
  ipcMain.handle('novel:status', (_e, bookId: number) => getJob(bookId))
  ipcMain.handle('novel:renameBook', (_e, bookId: number, title: string, author: string) => {
    setBookMeta(bookId, title, author)
    return true
  })
  ipcMain.handle('novel:export', async (_e, bookId: number, encoding: 'utf-8' | 'gbk') => {
    const win = BrowserWindow.getAllWindows()[0]
    const b = getShelf().books.find((x) => x.id === bookId)
    if (!b) return { canceled: true } as const
    const r = await dialog.showSaveDialog(win!, {
      title: '导出小说 txt',
      defaultPath: `${b.title}.txt`,
      filters: [
        { name: '文本文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePath) return { canceled: true } as const
    const text = exportNovelText(bookId)
    if (text === null) return { canceled: true } as const
    writeTxtFile(r.filePath, text, encoding)
    return { canceled: false, path: r.filePath } as const
  })

  /* ---------- 章节管理 ---------- */
  const shelfChanged = (): void => mainWindow?.webContents.send('shelf:changed')
  ipcMain.handle(
    'chapter:insert',
    (_e, bookId: number, atIdx: number, title: string, content: string) => {
      const idx = insertChapter(bookId, atIdx, title, content)
      shelfChanged()
      return idx
    }
  )
  ipcMain.handle('chapter:rename', (_e, bookId: number, idx: number, title: string) => {
    renameChapter(bookId, idx, title)
    return true
  })
  ipcMain.handle('chapter:delete', (_e, bookId: number, idx: number) => {
    softDeleteChapter(bookId, idx)
    shelfChanged()
    return true
  })
  ipcMain.handle('chapter:editContent', (_e, bookId: number, idx: number, content: string) => {
    editChapterContent(bookId, idx, content)
    return true
  })
  ipcMain.handle('chapter:mergeUp', (_e, bookId: number, idx: number) => {
    const ok = mergeChapterUp(bookId, idx)
    shelfChanged()
    return ok
  })
  ipcMain.handle('chapter:markDup', (_e, bookId: number) => markDuplicates(bookId))

  /* ---------- 网络代理 ---------- */
  const applyProxy = (): void => {
    const on = boolSetting('proxy_on', false)
    const url = getSetting('proxy_url') ?? ''
    if (on && url) {
      session.defaultSession
        .setProxy({ mode: 'fixed_servers', proxyRules: url })
        .catch((e) => console.log('[main] setProxy fail', String(e)))
    } else {
      session.defaultSession.setProxy({ mode: 'system' }).catch(() => undefined)
    }
  }
  if (sessionActive) applyProxy()
  ipcMain.handle('proxy:get', () => ({
    on: boolSetting('proxy_on', false),
    url: getSetting('proxy_url') ?? ''
  }))
  ipcMain.handle('proxy:save', (_e, url: string, on: boolean) => {
    setSetting('proxy_url', url.trim())
    setSetting('proxy_on', on ? '1' : '0')
    applyProxy()
    return true
  })
  ipcMain.handle('proxy:test', async () => {
    try {
      const r = await net.fetch('https://www.google.com/generate_204', {
        signal: AbortSignal.timeout(8000)
      })
      return { ok: r.status === 204 || r.ok, status: r.status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ---------- 账号与会话 ---------- */
  const onSessionReady = (): void => {
    applyProxy()
    markStaleNovelLogs()
    // 「启动时自动更新小说」：静默跑一轮全量增量检查（进度走同步记录，不打扰）
    if (boolSetting('pull_on_start', true)) void updateAllNovels().catch(() => {})
    const a = getActiveAccount()
    logEvent('app', 'info', `已进入账号「${a?.name ?? 'env'}」（v${app.getVersion()}，数据目录 ${app.getPath('userData')}）`)
  }
  const teardownSession = (): void => {
    resetNovelJobs()
    closeDb()
    deactivateAccount()
    sessionActive = false
    logEvent('app', 'info', '已退出账号，回到登录页')
  }

  ipcMain.handle('session:current', () => {
    if (bootSession.mode === 'env' || sessionActive) {
      const a = getActiveAccount()
      return {
        mode: 'app' as const,
        env: bootSession.mode === 'env',
        guest: !a && bootSession.mode !== 'env' && isGuestActive(),
        account: a ? { id: a.id, name: a.name } : null
      }
    }
    return { mode: 'login' as const, env: false, accounts: listAccounts() }
  })
  ipcMain.handle('accounts:list', () => listAccounts())
  ipcMain.handle('session:guest', () => {
    const err = activateGuest()
    if (err) return { ok: false as const, error: err }
    sessionActive = true
    onSessionReady()
    logEvent('app', 'info', '以游客身份进入（功能受限）')
    return { ok: true as const }
  })
  ipcMain.handle('session:login', (_e, id: string, password: string, remember: boolean) => {
    const err = activateAccount(id, password ?? '')
    if (err) return { ok: false as const, error: err }
    if (remember) writeRemember(id, password ?? '')
    else clearRemember(id)
    sessionActive = true
    onSessionReady()
    const a = getActiveAccount()
    return { ok: true as const, account: { id: a?.id ?? '', name: a?.name ?? '' } }
  })
  ipcMain.handle('accounts:create', (_e, name: string, password: string, remember: boolean) => {
    const err = createAndActivate(name, password ?? '')
    if (err) return { ok: false as const, error: err }
    if (remember) writeRemember(getActiveAccount()?.id ?? '', password ?? '')
    sessionActive = true
    onSessionReady()
    const a = getActiveAccount()
    return { ok: true as const, account: { id: a?.id ?? '', name: a?.name ?? '' } }
  })
  ipcMain.handle('session:logout', () => {
    /* 退出登录同时撤销本机自动登录凭据（下次启动回登录页） */
    clearRemember(getActiveAccount()?.id ?? '')
    teardownSession()
    return { ok: true as const }
  })

  /* ---------- 云同步（快照上传 / 云端恢复，全部手动触发） ---------- */
  ipcMain.handle('cloud:getConfig', () => {
    requireSession()
    return getCloudConfigView()
  })
  ipcMain.handle('cloud:saveConfig', (_e, patch: Parameters<typeof setCloudConfig>[0]) => {
    requireSession()
    setCloudConfig(patch)
    return getCloudConfigView()
  })
  ipcMain.handle('cloud:test', () => {
    requireSession()
    return testCloudConnection()
  })
  ipcMain.handle('cloud:upload', async () => {
    requireSession()
    return uploadSnapshot()
  })
  ipcMain.handle('cloud:download', async () => {
    requireSession()
    const r = await downloadSnapshot()
    if (r.ok && r.snapshot) rememberPendingRestore(r.snapshot)
    /* 只把摘要给渲染层，zip 留在主进程待确认 */
    return { ok: r.ok, message: r.message, manifest: r.snapshot?.manifest ?? null }
  })
  ipcMain.handle('cloud:applyRestore', () => {
    requireSession()
    resetNovelJobs() /* 恢复换库，旧抓取作业全部作废 */
    const r = applyPendingRestore()
    if (r.ok) shelfChanged()
    return r
  })
  ipcMain.handle('cloud:discardRestore', () => {
    discardPendingRestore()
    return true
  })
  ipcMain.handle('cloud:remoteInfo', () => {
    requireSession()
    return remoteInfo()
  })
  ipcMain.handle('cloud:phoneProgress', async () => {
    requireSession()
    return fetchPhoneProgress()
  })
  ipcMain.handle('cloud:applyPhoneProgress', (_e, picks: Array<{ bookId: number; progress: number; currentChapter: number; chapterLabel: string }>) => {
    requireSession()
    const r = applyPhoneProgress(picks ?? [])
    if (r.applied > 0) shelfChanged()
    return r
  })

  createWindow()
  createTray(() => mainWindow)

  logEvent(
    'app',
    'info',
    bootSession.mode === 'login'
      ? `墨纸启动完成（v${app.getVersion()}，等待登录）`
      : `墨纸启动完成（v${app.getVersion()}，数据目录 ${app.getPath('userData')}）`
  )

  /* 老板键：全局一键隐藏/恢复；支持自定义（存 settings 表），默认回退链 */
  initBossKey(() => mainWindow)
  registerBossIpc(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})()

app.on('before-quit', () => {
  markQuitting()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // close_to_tray=true 时 close 已被拦截，不会走到这里；走到即用户选择退出或托盘退出
  destroyTray()
  if (!sessionActive || !boolSetting('close_to_tray', true)) app.quit()
})
