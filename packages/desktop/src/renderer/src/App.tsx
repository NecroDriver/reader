import { useCallback, useEffect, useState } from 'react'
import ReaderView from './ReaderView'
import ArticleView from './ArticleView'
import BookDetailModal, { coverSrc } from './BookDetailModal'
import LoginScreen from './LoginScreen'
import CloudSyncPanel from './CloudSyncPanel'
import { setupDevMock } from './devMock'
import type { Book, ImportOutcome, NovelJobState, PullLogEntry, PullOutcome, Shelf, SyncProgress, ViewName } from './types'

type Filter = 'all' | 'book' | 'article'
type Theme = 'paper' | 'sepia' | 'green' | 'ink'

const COVER_PALETTE = ['#221D17', '#B5402A', '#44523F', '#33424E', '#7A5C3E']

const INTERVALS: [number, string][] = [
  [15, '每 15 分钟'],
  [30, '每 30 分钟'],
  [60, '每 1 小时'],
  [180, '每 3 小时'],
  [360, '每 6 小时'],
  [720, '每 12 小时'],
  [1440, '每天'],
  [0, '手动']
]

const RssIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="5" cy="15" r="1.4" fill="currentColor" stroke="none" /><path d="M5 10.5a4.5 4.5 0 0 1 4.5 4.5M5 6a9 9 0 0 1 9 9" /></svg>
)
const WebIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.5 2.6 2.5 11.4 0 14M10 3c-2.5 2.6-2.5 11.4 0 14" /></svg>
)
const RefreshIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3h-3" /></svg>
)
const TrashIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4M11.5 9v4" /></svg>
)

const NavIcon = {
  shelf: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3.5 4.5h5v11h-5zM11.5 4.5h5v11h-5zM3.5 9.5h5M11.5 9.5h5" /></svg>
  ),
  sources: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="5" cy="14.5" r="1.2" fill="currentColor" stroke="none" /><path d="M5 10a5 5 0 0 1 5 5M5 5.5a9.5 9.5 0 0 1 9.5 9.5" /></svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></svg>
  )
}

const CollapseIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14.5 7.5 10 12 5.5M16 14.5 11.5 10 16 5.5" /></svg>
)
const ExpandIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5.5 12.5 10 8 14.5M4 5.5 8.5 10 4 14.5" /></svg>
)

function LibraryAppInner({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<ViewName>('shelf')
  const [filter, setFilter] = useState<Filter>('all')
  const [shelf, setShelf] = useState<Shelf | null>(null)
  const [navCollapsed, setNavCollapsed] = useState<boolean>(
    () => localStorage.getItem('mozhi-nav') === 'collapsed'
  )
  const toggleNav = useCallback(() => {
    setNavCollapsed((c) => {
      const next = !c
      localStorage.setItem('mozhi-nav', next ? 'collapsed' : 'expanded')
      return next
    })
  }, [])
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('mozhi-theme') as Theme | null) ?? 'paper'
  )
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem('mozhi-theme', t)
  }, [])
  const [readerBookId, setReaderBookId] = useState<number | null>(null)
  const [readerArticleId, setReaderArticleId] = useState<number | null>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [pullingId, setPullingId] = useState<number | null>(null)
  const [pullingAll, setPullingAll] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', type: 'rss', interval: 60 })
  const [formErr, setFormErr] = useState('')
  const [novelUrl, setNovelUrl] = useState('')
  const [novelErr, setNovelErr] = useState('')
  const [novelBusy, setNovelBusy] = useState(false)
  const [novelJobs, setNovelJobs] = useState<Record<number, NovelJobState>>({})
  const [proxy, setProxy] = useState({ on: false, url: '' })
  const [proxyTesting, setProxyTesting] = useState(false)
  const [pullLogs, setPullLogs] = useState<PullLogEntry[]>([])
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [settings, setSettings] = useState({ autostart: false, closeToTray: true, pullOnStart: true, bossKey: '', bossKeyCustom: false })
  const [bossRecording, setBossRecording] = useState(false)
  const [bossHint, setBossHint] = useState('')
  /* 书卡管理：⋯ 菜单 / 删除确认 */
  const [menuBookId, setMenuBookId] = useState<number | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null)
  const [detailBookId, setDetailBookId] = useState<number | null>(null)
  /* 当前账号（设置页展示；env 直通为 null） */
  const [accountName, setAccountName] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      const s = await window.mozhi?.getSession()
      if (s && s.mode === 'app') setAccountName(s.account?.name ?? null)
    })()
  }, [])

  /* 老板键录制：capture 阶段捕获组合键，Esc 取消 */
  useEffect(() => {
    if (!bossRecording) return
    setBossHint('请按下组合键（Esc 取消）')
    const normalize = (k: string): string | null => {
      if (/^[a-zA-Z0-9]$/.test(k)) return k.toUpperCase()
      if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return k
      if (k === ' ') return 'Space'
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return k
      return null
    }
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        setBossRecording(false)
        setBossHint('')
        return
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (parts.length === 0) {
        setBossHint('需按住 Ctrl / Alt / Shift 至少一个，再按主键')
        return
      }
      const main = normalize(e.key)
      if (!main) {
        setBossHint('这个键不支持，请换字母 / 数字 / F1-F24 / 方向键')
        return
      }
      const accel = `${parts.join('+')}+${main}`
      setBossRecording(false)
      setBossHint('')
      window.mozhi?.setBossKey(accel).then((r) => {
        setSettings((s) => ({ ...s, bossKey: r.key, bossKeyCustom: r.custom }))
        if (r.ok) {
          pushToast(`一键隐藏已改为 ${accel.replace('CommandOrControl', 'Ctrl')}，立即生效`)
        } else {
          pushToast(`设置失败：${accel.replace('CommandOrControl', 'Ctrl')} 已被其他程序占用`)
        }
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [bossRecording])

  const resetBossKey = useCallback(() => {
    window.mozhi?.resetBossKey().then((r) => {
      setSettings((s) => ({ ...s, bossKey: r.key, bossKeyCustom: r.custom }))
      pushToast(r.key ? `一键隐藏恢复为 ${r.key.replace('CommandOrControl', 'Ctrl')}` : '恢复失败：候选键均被占用')
    })
  }, [])
  const [confirmClear, setConfirmClear] = useState(false)
  const [dataDirInfo, setDataDirInfo] = useState<{ current: string; defaultDir: string; custom: string | null } | null>(null)
  const [logDir, setLogDir] = useState('')

  const pushToast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const reloadShelf = useCallback(() => {
    window.mozhi?.getShelf().then(setShelf).catch(console.error)
  }, [])

  /* 删除书架上的书（⋯ 菜单 → 卡片内二次确认） */
  const doDeleteBook = useCallback(
    async (b: Book) => {
      setConfirmDelId(null)
      setMenuBookId(null)
      try {
        await window.mozhi?.deleteBook(b.id)
        pushToast(`已删除《${b.title}》`)
        reloadShelf()
      } catch {
        pushToast('删除失败，请重试')
      }
    },
    [pushToast, reloadShelf]
  )

  /* ⋯ 菜单 / 删除确认：点外部或 Esc 收起 */
  useEffect(() => {
    if (menuBookId === null && confirmDelId === null) return
    const onDown = (ev: MouseEvent): void => {
      const t = ev.target as HTMLElement
      if (t.closest('.card-more') || t.closest('.card-menu') || t.closest('.card-confirm')) return
      setMenuBookId(null)
      setConfirmDelId(null)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        setMenuBookId(null)
        setConfirmDelId(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuBookId, confirmDelId])

  /* 侧栏导航：若正处于阅读态（书/文章），先退出阅读器再切视图（进度由卸载兜底保存） */
  const go = useCallback(
    (v: ViewName) => {
      setView(v)
      if (readerBookId !== null || readerArticleId !== null) {
        setReaderBookId(null)
        setReaderArticleId(null)
        reloadShelf()
      }
    },
    [readerBookId, readerArticleId, reloadShelf]
  )

  /* 设置加载 + 主进程书架变化（托盘拉取/清空文章）订阅 */
  useEffect(() => {
    window.mozhi?.getSettings().then(setSettings).catch(console.error)
    window.mozhi?.getDataDirInfo().then(setDataDirInfo).catch(console.error)
    window.mozhi?.getLogDir?.().then(setLogDir).catch(console.error)
    window.mozhi?.getProxy().then(setProxy).catch(console.error)
    window.mozhi?.getPullLogs().then(setPullLogs).catch(console.error)
    const off = window.mozhi?.onShelfChanged(() => reloadShelf())
    const offLog = window.mozhi?.onSyncLogChanged(() => {
      window.mozhi?.getPullLogs().then(setPullLogs).catch(console.error)
    })
    return () => {
      off?.()
      offLog?.()
    }
  }, [reloadShelf])

  /* 小说抓取进度：更新书卡状态，结束时刷新书架 */
  useEffect(() => {
    const off = window.mozhi?.onNovelProgress((s) => {
      setNovelJobs((j) => {
        const prev = j[s.bookId]
        // running→非 running 的边沿触发一次书架刷新（章数变了）
        if (prev && prev.status === 'running' && s.status !== 'running') reloadShelf()
        return { ...j, [s.bookId]: s }
      })
    })
    return () => off?.()
  }, [reloadShelf])

  /* 订阅同步：进度推送 + 完成后刷新记录 */
  useEffect(() => {
    const off = window.mozhi?.onSyncProgress((p) => {
      setSyncProgress(p)
      if (p.finished) {
        setSyncProgress(null)
        window.mozhi
          ?.getPullLogs()
          .then(setPullLogs)
          .catch(console.error)
      }
    })
    return () => off?.()
  }, [])

  const toggleSetting = useCallback(
    (key: 'autostart' | 'close_to_tray' | 'pull_on_start', value: boolean) => {
      setSettings((s) => ({
        ...s,
        [key === 'close_to_tray' ? 'closeToTray' : key === 'pull_on_start' ? 'pullOnStart' : 'autostart']:
          value
      }))
      window.mozhi?.setSetting(key, value).catch(console.error)
    },
    []
  )

  const handleImport = useCallback(
    (results: ImportOutcome[]) => {
      const ok = results.filter((r) => r.ok)
      if (ok.length) {
        pushToast(`已导入 ${ok.length} 本：${ok.map((r) => r.title).join('、')}`)
        reloadShelf()
      } else if (results.length) {
        pushToast('导入失败：' + (results[0].error ?? '未知错误'))
      }
    },
    [pushToast, reloadShelf]
  )

  const pickImport = useCallback(async () => {
    if (!window.mozhi) return
    handleImport(await window.mozhi.pickAndImport())
  }, [handleImport])

  /* ---------- 订阅拉取 ---------- */

  const afterPull = useCallback(
    (results: PullOutcome[]) => {
      const ok = results.filter((r) => r.ok)
      const fail = results.filter((r) => !r.ok)
      const added = ok.reduce((n, r) => n + r.added, 0)
      if (results.length === 1) {
        const r = results[0]
        pushToast(r.ok ? `${r.sourceName} · 新增 ${r.added} 篇` : `${r.sourceName} 拉取失败：${r.error}`)
      } else if (results.length === 0) {
        pushToast('当前没有启用的订阅源 — 先在「订阅源」页添加一个再拉取')
      } else if (ok.length) {
        pushToast(added > 0 ? `拉取完成 · 新增 ${added} 篇` : '拉取完成 · 暂无新内容')
      }
      if (fail.length > 1) pushToast(`${fail.length} 个源拉取失败`)
      reloadShelf()
      // 同步记录面板同步刷新（手动单源拉取也要能看到记录）
      window.mozhi?.getPullLogs().then((logs) => setPullLogs(logs))
    },
    [pushToast, reloadShelf]
  )

  const pullOne = useCallback(
    async (id: number) => {
      if (!window.mozhi || pullingId !== null) return
      setPullingId(id)
      try {
        afterPull([await window.mozhi.pullSource(id)])
      } finally {
        setPullingId(null)
      }
    },
    [afterPull, pullingId]
  )

  const pullAll = useCallback(async () => {
    if (!window.mozhi || pullingAll) return
    setPullingAll(true)
    try {
      afterPull(await window.mozhi.pullAllSources())
    } finally {
      setPullingAll(false)
    }
  }, [afterPull, pullingAll])

  const toggleSource = useCallback(
    async (id: number, enabled: boolean) => {
      await window.mozhi?.updateSource(id, { enabled })
      reloadShelf()
    },
    [reloadShelf]
  )

  const changeInterval = useCallback(
    async (id: number, intervalMinutes: number) => {
      await window.mozhi?.updateSource(id, { intervalMinutes })
      reloadShelf()
    },
    [reloadShelf]
  )

  const deleteSource = useCallback(
    async (id: number, name: string) => {
      await window.mozhi?.removeSource(id)
      pushToast(`已删除订阅源：${name}`)
      reloadShelf()
    },
    [pushToast, reloadShelf]
  )

  const submitSource = useCallback(async () => {
    if (!window.mozhi) return
    const url = form.url.trim()
    if (!url) {
      setFormErr('请填写订阅地址')
      return
    }
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const name =
      form.name.trim() ||
      full.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ||
      full
    try {
      new URL(full)
    } catch {
      setFormErr('地址格式不正确')
      return
    }
    setFormErr('')
    await window.mozhi.addSource({ name, url: full, type: form.type, intervalMinutes: form.interval })
    setForm({ name: '', url: '', type: 'rss', interval: 60 })
    pushToast(`已添加订阅源：${name}`)
    reloadShelf()
  }, [form, pushToast, reloadShelf])

  useEffect(() => {
    if (window.mozhi) {
      reloadShelf()
    } else if (import.meta.env.DEV) {
      // 浏览器直开 dev server（无 preload）：mock 完整 API，供样式与渲染管线验证
      setupDevMock()
      reloadShelf()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* 拖放导入（计数法防子元素抖动） */
  useEffect(() => {
    if (!window.mozhi) return
    let depth = 0
    const onEnter = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth++
        document.body.classList.add('dropping')
      }
    }
    const onOver = (e: DragEvent): void => e.preventDefault()
    const onLeave = (): void => {
      if (--depth <= 0) {
        depth = 0
        document.body.classList.remove('dropping')
      }
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      document.body.classList.remove('dropping')
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      const paths = files.map((f) => window.mozhi!.pathForFile(f))
      window.mozhi!.importPaths(paths).then(handleImport)
    }
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onDrop as EventListener)
    return () => {
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onDrop as EventListener)
    }
  }, [handleImport])

  const openBook = (b: { id: number; originPath: string; format: string }): void => {
    if (b.originPath || b.format === 'NOVEL') setReaderBookId(b.id)
  }

  /* ---------- 在线小说 ---------- */
  const submitNovel = useCallback(async () => {
    if (!window.mozhi || novelBusy) return
    const url = novelUrl.trim()
    if (!url) {
      setNovelErr('请填写小说目录页地址')
      return
    }
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    try {
      new URL(full)
    } catch {
      setNovelErr('地址格式不正确')
      return
    }
    setNovelErr('')
    setNovelBusy(true)
    try {
      const r = await window.mozhi.createNovel(full)
      if (r.ok && r.bookId !== undefined) {
        setNovelJobs((j) => ({
          ...j,
          [r.bookId!]: { bookId: r.bookId!, status: 'running', done: 0, total: r.chapters ?? 0, currentTitle: '' }
        }))
        // 同步记录立刻出现「抓取中」条目（不等第一章抓完的首个进度事件）
        const d0 = new Date()
        setPullLogs((ls) => [
          {
            at: `${String(d0.getHours()).padStart(2, '0')}:${String(d0.getMinutes()).padStart(2, '0')}`,
            name: r.title ?? '',
            added: 0,
            ok: true,
            kind: 'novel' as const,
            bookId: r.bookId!,
            running: true,
            done: 0,
            total: r.chapters ?? 0
          },
          ...ls
        ].slice(0, 30))
        pushToast(`开始抓取《${r.title}》· 共 ${r.chapters} 章`)
        setNovelUrl('')
      } else {
        setNovelErr(r.error ?? '创建失败')
      }
    } finally {
      setNovelBusy(false)
    }
  }, [novelBusy, novelUrl, pushToast])

  const unread = shelf?.articles.filter((a) => a.unread).length ?? 0
  const items =
    shelf === null
      ? []
      : filter === 'book'
        ? shelf.books.map((b) => ({ kind: 'book' as const, data: b }))
        : filter === 'article'
          ? shelf.articles.map((a) => ({ kind: 'article' as const, data: a }))
          : [
              ...shelf.articles.map((a) => ({ kind: 'article' as const, data: a })),
              ...shelf.books.map((b) => ({ kind: 'book' as const, data: b }))
            ]

  return (
    <div className="app">
      <aside className={'sidebar' + (navCollapsed ? ' collapsed' : '')}>
        <div className="brand">
          <span className="brand-zh">{navCollapsed ? '墨' : '墨纸'}</span>
          {!navCollapsed && <span className="brand-latin">Mozhi Reader</span>}
        </div>
        <nav className="nav">
          <button
            className={'nav-item' + (view === 'shelf' ? ' active' : '')}
            onClick={() => go('shelf')}
            title={navCollapsed ? '书架' : undefined}
          >
            {NavIcon.shelf}
            {!navCollapsed && <span>书架</span>}
            {unread > 0 && <em className="nav-badge">{unread}</em>}
          </button>
          <button
            className={'nav-item' + (view === 'sources' ? ' active' : '')}
            onClick={() => go('sources')}
            title={navCollapsed ? '订阅源' : undefined}
          >
            {NavIcon.sources}
            {!navCollapsed && <span>订阅源</span>}
          </button>
          <button
            className={'nav-item' + (view === 'settings' ? ' active' : '')}
            onClick={() => go('settings')}
            title={navCollapsed ? '设置' : undefined}
          >
            {NavIcon.settings}
            {!navCollapsed && <span>设置</span>}
          </button>
        </nav>
        <button
          className="nav-toggle"
          onClick={toggleNav}
          title={navCollapsed ? '展开侧栏' : '收起侧栏'}
        >
          {navCollapsed ? ExpandIcon : CollapseIcon}
        </button>
        {accountName &&
          (navCollapsed ? (
            <span className="side-account collapsed" title={`当前账号：${accountName}`}>
              <span className="side-account-mark">{accountName.slice(0, 1)}</span>
            </span>
          ) : (
            <div className="side-account" title={`当前账号：${accountName}`}>
              <span className="side-account-mark">{accountName.slice(0, 1)}</span>
              <span className="side-account-text">
              <strong>{accountName}</strong>
              <em>的书房</em>
              </span>
            </div>
          ))}
        {!navCollapsed && <div className="side-foot">上次同步 {shelf?.lastSyncAt ?? '—'}</div>}
      </aside>

      <main className="main">
        {readerBookId !== null ? (
          <ReaderView
            bookId={readerBookId}
            theme={theme}
            onThemeChange={setTheme}
            onToast={pushToast}
            onExit={() => {
              setReaderBookId(null)
              reloadShelf()
            }}
          />
        ) : readerArticleId !== null ? (
          <ArticleView
            articleId={readerArticleId}
            onExit={() => {
              setReaderArticleId(null)
              reloadShelf()
            }}
          />
        ) : (
          <>
        {view === 'shelf' && (
          <section className="view">
            <header className="view-head">
              <p className="eyebrow">LIBRARY · 藏书</p>
              <h1>书架</h1>
              <p className="stats">
                {shelf ? `${shelf.books.length} 本图书 · ${shelf.articles.length} 篇文章` : '正在载入…'}
              </p>
              {syncProgress && (
                <div className="sync-progress" role="status">
                  <div className="progress fetching">
                    <i
                      style={{
                        width: `${syncProgress.total ? Math.round((syncProgress.done / syncProgress.total) * 100) : 8}%`
                      }}
                    />
                  </div>
                  <span>
                    同步中 {syncProgress.done}/{syncProgress.total}
                    {syncProgress.name ? ` · ${syncProgress.name}` : ''}
                  </span>
                </div>
              )}
            </header>
            <div className="shelf-toolbar">
              <div className="tabs" id="shelf-tabs">
                {([['all', '全部'], ['book', '书籍'], ['article', '文章']] as const).map(([f, label]) => (
                  <button
                    key={f}
                    className={'tab' + (filter === f ? ' active' : '')}
                    onClick={() => setFilter(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="head-actions">
                <button className="btn ghost" onClick={pickImport}>
                  导入图书
                </button>
                <button className={'btn primary' + (pullingAll ? ' loading' : '')} onClick={pullAll} disabled={pullingAll}>
                  {pullingAll ? '正在拉取…' : '立即拉取全部'}
                </button>
              </div>
            </div>
            <div className="shelf-grid">
              {items.map((it) =>
                it.kind === 'article' ? (
                  <article
                    key={'a' + it.data.id}
                    className={'card article' + (it.data.isNew ? ' is-new' : '')}
                    tabIndex={0}
                    onClick={() => setReaderArticleId(it.data.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setReaderArticleId(it.data.id)}
                  >
                    <div className="art-head">
                      <span className="art-src">{it.data.source}</span>
                      {it.data.unread && <i className="dot" />}
                    </div>
                    <h3 className="art-title">{it.data.title}</h3>
                    <p className="card-meta">
                      {it.data.source} · {it.data.publishedAt}
                    </p>
                    {it.data.progress > 0 && it.data.progress < 100 && (
                      <div className="progress">
                        <i style={{ width: `${it.data.progress}%` }} />
                      </div>
                    )}
                  </article>
                ) : (
                  <article
                    key={'b' + it.data.id}
                    className="card book"
                    tabIndex={0}
                    onClick={() => openBook(it.data)}
                    onKeyDown={(e) => e.key === 'Enter' && openBook(it.data)}
                  >
                    <div
                      className="cover"
                      style={{ background: COVER_PALETTE[it.data.coverIdx % COVER_PALETTE.length] }}
                    >
                      {it.data.coverPath ? (
                        <img className="cover-img" src={coverSrc(it.data.coverPath)} alt="" />
                      ) : (
                        <>
                          <span className="cover-title">{it.data.title}</span>
                          <span className="cover-author">{it.data.author}</span>
                        </>
                      )}
                      <span className="cover-fmt">{it.data.format}</span>
                    </div>
                    <h3 className="card-title">{it.data.title}</h3>
                    <p className="card-meta">
                      {it.data.author || (it.data.format === 'NOVEL' ? '在线抓取' : '')}
                      {' · '}
                      {(() => {
                        const job = novelJobs[it.data.id]
                        if (job && job.status === 'running') {
                          return `抓取中 ${job.done}/${job.total || '?'}${job.currentTitle ? ' · ' + job.currentTitle : ''}`
                        }
                        if (job && job.status === 'paused') return `已暂停 · ${job.done}/${job.total || '?'} 章`
                        if (it.data.originPath || it.data.format === 'NOVEL') {
                          if (it.data.progress > 0) {
                            const unreadCh =
                              it.data.totalChapters > 0 && it.data.currentChapter >= 0
                                ? it.data.totalChapters - it.data.currentChapter - 1
                                : 0
                            return (
                              <>
                                {`${it.data.chapterLabel || ''} ${Math.round(it.data.progress)}%`}
                                {unreadCh > 0 && <span className="meta-unread"> · {unreadCh} 章未读</span>}
                              </>
                            )
                          }
                          return it.data.totalChapters > 0 ? `共 ${it.data.totalChapters} 章` : '未读'
                        }
                        return '即将支持'
                      })()}
                    </p>
                    {(novelJobs[it.data.id]?.status ?? '') === 'running' && (
                      <div className="progress fetching">
                        <i
                          style={{
                            width: `${novelJobs[it.data.id].total ? Math.min(100, Math.round((novelJobs[it.data.id].done / novelJobs[it.data.id].total) * 100)) : 8}%`
                          }}
                        />
                      </div>
                    )}
                    {(novelJobs[it.data.id]?.status ?? '') !== 'running' && it.data.progress > 0 && (
                      <div className="progress">
                        <i style={{ width: `${it.data.progress}%` }} />
                      </div>
                    )}
                    <button
                      className={'card-more' + (menuBookId === it.data.id ? ' on' : '')}
                      title="图书操作"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuBookId(menuBookId === it.data.id ? null : it.data.id)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <circle cx="3" cy="8" r="1.4" />
                        <circle cx="8" cy="8" r="1.4" />
                        <circle cx="13" cy="8" r="1.4" />
                      </svg>
                    </button>
                    {menuBookId === it.data.id && (
                      <div className="card-menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="card-menu-item"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuBookId(null)
                            setDetailBookId(it.data.id)
                          }}
                        >
                          书籍详情
                        </button>
                        <button
                          className="card-menu-item danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuBookId(null)
                            setConfirmDelId(it.data.id)
                          }}
                        >
                          删除图书
                        </button>
                      </div>
                    )}
                    {confirmDelId === it.data.id && (
                      <div className="card-confirm" onClick={(e) => e.stopPropagation()}>
                        <p className="card-confirm-title">删除《{it.data.title}》？</p>
                        <p className="card-confirm-sub">章节、抓取记录与进度将一并删除</p>
                        <div className="card-confirm-actions">
                          <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); void doDeleteBook(it.data) }}>
                            删除
                          </button>
                          <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setConfirmDelId(null) }}>
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                )
              )}
              {shelf !== null && items.length === 0 && <p className="empty">这里还没有内容</p>}
            </div>
          </section>
        )}

        {view === 'sources' && (
          <section className="view">
            <header className="view-head">
              <p className="eyebrow">SUBSCRIPTIONS · 订阅</p>
              <h1>订阅源</h1>
              <p className="stats">
                {shelf
                  ? `${shelf.sources.length} 个订阅源 · ${shelf.sources.filter((s) => s.enabled).length} 个启用`
                  : '正在载入…'}
              </p>
              {syncProgress && (
                <div className="sync-progress" role="status">
                  <div className="progress fetching">
                    <i
                      style={{
                        width: `${syncProgress.total ? Math.round((syncProgress.done / syncProgress.total) * 100) : 8}%`
                      }}
                    />
                  </div>
                  <span>
                    同步中 {syncProgress.done}/{syncProgress.total}
                    {syncProgress.name ? ` · ${syncProgress.name}` : ''}
                  </span>
                </div>
              )}
            </header>

            <div className="pull-log-card">
              <h2 className="form-title">同步记录</h2>
              {pullLogs.length === 0 ? (
                <p className="empty">暂无同步记录，点源行的刷新按钮或「立即拉取全部」试试</p>
              ) : (
                <ul className="pull-log-list">
                  {pullLogs.slice(0, 8).map((l, i) =>
                    l.kind === 'novel' ? (
                      <li key={i} className={'pull-log-row novel' + (l.ok ? '' : ' fail')}>
                        <span className="pull-log-at">{l.at}</span>
                        <span className="pull-log-name">《{l.name || '小说'}》</span>
                        {l.running || l.paused ? (
                          <span className="pull-log-res novel-live">
                            <span className="pull-log-track" aria-hidden="true">
                              <span
                                style={{
                                  width: `${l.total ? Math.min(100, Math.round(((l.done ?? 0) / l.total) * 100)) : 8}%`
                                }}
                              />
                            </span>
                            {l.paused
                              ? `已暂停 ${l.done ?? 0}/${l.total ?? 0}`
                              : l.total
                                ? `抓取中 ${l.done ?? 0}/${l.total}`
                                : '正在解析目录…'}
                          </span>
                        ) : (
                          <span className={'pull-log-res' + (l.ok && l.added > 0 ? ' added' : '')}>
                            {l.ok
                              ? l.added > 0
                                ? `抓取完成 · 共 ${l.added} 章`
                                : '没有新章节'
                              : `失败：${l.error?.slice(0, 40) ?? '未知错误'}`}
                          </span>
                        )}
                      </li>
                    ) : (
                      <li key={i} className={'pull-log-row' + (l.ok ? '' : ' fail')}>
                        <span className="pull-log-at">{l.at}</span>
                        <span className="pull-log-name">{l.name || '未命名源'}</span>
                        <span className={'pull-log-res' + (l.added > 0 ? ' added' : '')}>
                          {l.ok
                            ? l.empty
                              ? '没有启用的订阅源'
                              : l.added > 0
                                ? `新增 ${l.added} 篇`
                                : '无新文章'
                            : `失败：${l.error?.slice(0, 40) ?? '未知错误'}`}
                        </span>
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>

            <div className="source-list">
              {shelf?.sources.map((s) => {
                const pulling = pullingId === s.id
                return (
                  <div key={s.id} className={'source-row' + (s.enabled ? '' : ' off')}>
                    <span className={'source-icon' + (s.type === 'web' ? ' web' : '')}>
                      {s.type === 'web' ? WebIcon : RssIcon}
                    </span>
                    <div className="source-info">
                      <strong>{s.name}</strong>
                      <span className="source-url">{s.url}</span>
                    </div>
                    <span className="source-status">
                      {pulling
                        ? '拉取中…'
                        : `${s.lastPullAt ?? '未拉取'}${s.lastCount > 0 ? ` · 上次 +${s.lastCount}` : ''}`}
                    </span>
                    <select
                      className="interval-select"
                      value={s.intervalMinutes}
                      onChange={(e) => changeInterval(s.id, Number(e.target.value))}
                      aria-label="拉取间隔"
                    >
                      {INTERVALS.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={'switch' + (s.enabled ? ' on' : '')}
                      role="switch"
                      aria-checked={s.enabled}
                      aria-label={s.enabled ? '暂停此源' : '启用此源'}
                      onClick={() => toggleSource(s.id, !s.enabled)}
                    >
                      <i />
                    </button>
                    <button
                      className="icon-btn"
                      title="立即拉取"
                      aria-label="立即拉取"
                      disabled={pulling}
                      onClick={() => pullOne(s.id)}
                    >
                      {pulling ? (
                        <i className="mini-spin" />
                      ) : (
                        RefreshIcon
                      )}
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除订阅源"
                      aria-label="删除订阅源"
                      onClick={() => deleteSource(s.id, s.name)}
                    >
                      {TrashIcon}
                    </button>
                  </div>
                )
              })}
              {shelf !== null && shelf.sources.length === 0 && (
                <p className="empty">还没有订阅源，在下方添加一个吧</p>
              )}
            </div>

            <div className={'source-form' + (formErr ? ' error' : '')}>
              <h2 className="form-title">添加订阅源</h2>
              <div className="form-row">
                <label className="sf-field grow">
                  <span className="sf-label">名称</span>
                  <input
                    className="sf-input"
                    placeholder="留空自动取域名"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label className="sf-field grow2">
                  <span className="sf-label">地址</span>
                  <input
                    className="sf-input"
                    type="url"
                    placeholder="RSS/Atom 或网页地址"
                    value={form.url}
                    onChange={(e) => {
                      setFormErr('')
                      setForm((f) => ({ ...f, url: e.target.value }))
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && submitSource()}
                  />
                </label>
                <label className="sf-field">
                  <span className="sf-label">类型</span>
                  <select
                    className="sf-input"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  >
                    <option value="rss">RSS</option>
                    <option value="web">网页</option>
                  </select>
                </label>
                <label className="sf-field">
                  <span className="sf-label">间隔</span>
                  <select
                    className="sf-input"
                    value={form.interval}
                    onChange={(e) => setForm((f) => ({ ...f, interval: Number(e.target.value) }))}
                  >
                    {INTERVALS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn primary sf-submit" onClick={submitSource}>
                  添加
                </button>
              </div>
              {formErr && <p className="form-err">{formErr}</p>}
              <p className="form-hint">RSS 源拉取条目全文；网页源每次抓取页面主正文（Readability 提取）。</p>
            </div>

            <div className={'source-form novel' + (novelErr ? ' error' : '')}>
              <h2 className="form-title">添加小说</h2>
              <div className="form-row">
                <label className="sf-field grow2">
                  <span className="sf-label">小说目录页地址</span>
                  <input
                    className="sf-input"
                    type="url"
                    placeholder="小说目录页（章节列表）网址"
                    value={novelUrl}
                    onChange={(e) => {
                      setNovelErr('')
                      setNovelUrl(e.target.value)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && submitNovel()}
                  />
                </label>
                <button className={'btn primary sf-submit' + (novelBusy ? ' loading' : '')} onClick={submitNovel} disabled={novelBusy}>
                  {novelBusy ? '正在解析…' : '抓取整本'}
                </button>
              </div>
              {novelErr && <p className="form-err">{novelErr}</p>}
              <p className="form-hint">
                解析目录页章节列表后自动逐章抓取成书（限速 1.5-3 秒/章，可暂停续抓）；完成后在书架阅读，支持导出 txt。
              </p>
            </div>
          </section>
        )}

        {view === 'settings' && (
          <section className="view">
            <header className="view-head">
              <p className="eyebrow">SETTINGS · 设置</p>
              <h1>设置</h1>
            </header>
            <div className="settings-groups">
              <div className="settings-group">
                <p className="group-eyebrow">ACCOUNT · 账号</p>
                <div className="profile-card">
                  <span className="profile-mark">{(accountName ?? '墨').slice(0, 1)}</span>
                  <div className="profile-info">
                    <strong>{accountName ?? '环境直通（开发模式）'}</strong>
                    <span className="mono-path">
                      {dataDirInfo ? dataDirInfo.custom ?? dataDirInfo.defaultDir : ''}
                    </span>
                    <span>独立书库 · 账号级数据隔离</span>
                  </div>
                  {accountName && (
                    <button
                      type="button"
                      className="btn ghost profile-logout"
                      onClick={() => {
                        void (async () => {
                          await window.mozhi?.logout()
                          onLogout()
                        })()
                      }}
                    >
                      退出登录
                    </button>
                  )}
                </div>
              </div>

              <CloudSyncPanel onChanged={(m) => pushToast(m)} />

              <div className="settings-group">
                <p className="group-eyebrow">APPEARANCE · 外观</p>
                <h2>外观</h2>
                <div className="theme-row">
                  {([['paper', '纸'], ['sepia', '暖'], ['green', '绿'], ['ink', '墨']] as const).map(([t, label]) => (
                    <button
                      key={t}
                      className={'theme-swatch' + (theme === t ? ' active' : '')}
                      data-theme-value={t}
                      onClick={() => setTheme(t as Theme)}
                    >
                      <i className={'swatch swatch-' + t} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <p className="group-eyebrow">GENERAL · 通用</p>
                <h2>通用</h2>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>开机自动启动</strong>
                    <span>登录 Windows 时自动运行墨纸</span>
                  </div>
                  <button
                    className={'switch' + (settings.autostart ? ' on' : '')}
                    role="switch"
                    aria-checked={settings.autostart}
                    aria-label="开机自动启动"
                    onClick={() => toggleSetting('autostart', !settings.autostart)}
                  />
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>关闭窗口时</strong>
                    <span>最小化到系统托盘，后台继续定时拉取</span>
                  </div>
                  <div className="seg">
                    <button
                      className={settings.closeToTray ? 'active' : ''}
                      onClick={() => toggleSetting('close_to_tray', true)}
                    >
                      收进托盘
                    </button>
                    <button
                      className={!settings.closeToTray ? 'active' : ''}
                      onClick={() => toggleSetting('close_to_tray', false)}
                    >
                      退出应用
                    </button>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>启动时立即拉取</strong>
                    <span>打开墨纸后先同步一轮订阅源（各源到点仍会自动拉取）</span>
                  </div>
                  <button
                    className={'switch' + (settings.pullOnStart ? ' on' : '')}
                    role="switch"
                    aria-checked={settings.pullOnStart}
                    aria-label="启动时立即拉取"
                    onClick={() => toggleSetting('pull_on_start', !settings.pullOnStart)}
                  />
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>一键隐藏</strong>
                    <span>
                      {bossRecording
                        ? bossHint || '请按下组合键（Esc 取消）'
                        : `任意界面按此快捷键立即收进后台，再按一次恢复${settings.bossKeyCustom ? '（自定义）' : ''}`}
                    </span>
                  </div>
                  {bossRecording ? (
                    <span className="boss-rec">录制中…</span>
                  ) : (
                    <span className="boss-actions">
                      <kbd className="hotkey">
                        {settings.bossKey ? settings.bossKey.replace('CommandOrControl', 'Ctrl') : '不可用'}
                      </kbd>
                      <button className="btn ghost sm" onClick={() => setBossRecording(true)}>
                        修改
                      </button>
                      {settings.bossKeyCustom && (
                        <button className="btn ghost sm" onClick={resetBossKey}>
                          恢复默认
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-group">
                <p className="group-eyebrow">NETWORK · 网络</p>
                <h2>网络</h2>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>自定义代理</strong>
                    <span>部分小说/订阅站点需经代理访问；格式如 127.0.0.1:7890 或 socks5://127.0.0.1:1080</span>
                  </div>
                  <button
                    className={'switch' + (proxy.on ? ' on' : '')}
                    role="switch"
                    aria-checked={proxy.on}
                    aria-label="启用自定义代理"
                    onClick={() => {
                      const next = { ...proxy, on: !proxy.on }
                      setProxy(next)
                      void window.mozhi?.saveProxy(next.url, next.on)
                    }}
                  />
                </div>
                <div className="setting-row proxy-row">
                  <label className="sf-field grow2">
                    <span className="sf-label">代理服务器地址</span>
                    <input
                      className="sf-input"
                      placeholder="127.0.0.1:7890"
                      value={proxy.url}
                      onChange={(e) => setProxy((p) => ({ ...p, url: e.target.value }))}
                      onBlur={() => void window.mozhi?.saveProxy(proxy.url, proxy.on)}
                    />
                  </label>
                  <button
                    className={'btn ghost' + (proxyTesting ? ' loading' : '')}
                    disabled={proxyTesting}
                    onClick={() => {
                      if (!window.mozhi) return
                      setProxyTesting(true)
                      void window.mozhi
                        .saveProxy(proxy.url, proxy.on)
                        .then(() => window.mozhi!.testProxy())
                        .then((r) => {
                          pushToast(r.ok ? `代理连通（HTTP ${r.status ?? 204}）` : `代理不通：${r.error ?? '超时'}`)
                        })
                        .catch((e) => pushToast(`测试失败：${String(e)}`))
                        .finally(() => setProxyTesting(false))
                    }}
                  >
                    {proxyTesting ? '测试中…' : '保存并测试'}
                  </button>
                </div>
              </div>

              <div className="settings-group">
                <p className="group-eyebrow">DATA · 数据</p>
                <h2>数据</h2>
                <div className="setting-row dir-row">
                  <div className="setting-info">
                    <strong>数据与缓存目录</strong>
                    <span className="dir-path" title={dataDirInfo?.current}>
                      {dataDirInfo ? (dataDirInfo.custom ?? dataDirInfo.defaultDir) : '…'}
                    </span>
                    <span>书库、订阅文章与缓存存放位置；更改后重启墨纸生效</span>
                  </div>
                  <div className="dir-actions">
                    <button
                      className="btn ghost"
                      onClick={() => {
                        void window.mozhi?.pickDataDir().then((r) => {
                          if (r && !r.canceled) {
                            pushToast(`已设置数据目录，重启墨纸后生效：${r.dir}`)
                            window.mozhi?.getDataDirInfo().then(setDataDirInfo).catch(console.error)
                          }
                        })
                      }}
                    >
                      更改目录…
                    </button>
                    {dataDirInfo?.custom && (
                      <button
                        className="btn ghost"
                        onClick={() => {
                          void window.mozhi?.resetDataDir().then(() => {
                            pushToast('已恢复默认数据目录，重启墨纸后生效')
                            window.mozhi?.getDataDirInfo().then(setDataDirInfo).catch(console.error)
                          })
                        }}
                      >
                        恢复默认
                      </button>
                    )}
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <strong>清空已拉取文章</strong>
                    <span>删除全部文章与阅读进度，订阅源与本地图书保留</span>
                  </div>
                  <button
                    className="btn ghost danger"
                    onClick={() => {
                      if (confirmClear) {
                        void window.mozhi?.clearArticles()
                        pushToast('已清空已拉取文章')
                        setConfirmClear(false)
                        reloadShelf()
                      } else {
                        setConfirmClear(true)
                        window.setTimeout(() => setConfirmClear(false), 3000)
                      }
                    }}
                  >
                    {confirmClear ? '确认清空？' : '清空'}
                  </button>
                </div>
                <div className="setting-row dir-row">
                  <div className="setting-info">
                    <strong>运行日志</strong>
                    <span className="dir-path" title={logDir}>
                      {logDir || '…'}
                    </span>
                    <span>记录拉取、抓取与启动等运行事件，排查问题时查看（mozhi.log）</span>
                  </div>
                  <div className="dir-actions">
                    <button
                      className="btn ghost"
                      onClick={() => {
                        void window.mozhi?.openLogDir().then((err) => {
                          if (err) pushToast(`打开日志目录失败：${err}`)
                        })
                      }}
                    >
                      打开日志目录
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <p className="group-eyebrow">ABOUT · 关于</p>
                <h2>关于</h2>
                <p className="about-line">
                  墨纸 Mozhi Reader · 本地书架与订阅阅读 · Electron + React
                </p>
              </div>
            </div>
          </section>
        )}
          </>
        )}
      </main>

      <div className="drop-overlay">松开 · 导入本地图书</div>
      {detailBookId !== null && (
        <BookDetailModal
          bookId={detailBookId}
          onClose={() => setDetailBookId(null)}
          onChanged={() => void reloadShelf()}
        />
      )}
      <div id="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

type SessionState = 'boot' | 'login' | 'app'

/**
 * 会话门：主进程给出当前会话（env 直通 / 已激活账号 → 直接进书架；否则登录页）。
 * 退出登录回到登录页（LibraryAppInner 卸载，全部状态自然丢弃）。
 */
export default function App() {
  const [session, setSession] = useState<SessionState>('boot')

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!window.mozhi && import.meta.env.DEV) setupDevMock()
      const m = window.mozhi
      if (!m) {
        setSession('app') /* 理论不可达：无 preload 时 DEV mock 已补齐 */
        return
      }
      const s = await m.getSession()
      if (!alive) return
      setSession(s.mode === 'app' ? 'app' : 'login')
    })()
    return () => {
      alive = false
    }
  }, [])

  if (session === 'boot') {
    return (
      <div className="boot-screen" aria-busy="true">
        <span className="boot-mark">墨</span>
        <span className="boot-text">正在展开书卷…</span>
      </div>
    )
  }
  if (session === 'login') {
    return <LoginScreen onDone={() => setSession('app')} />
  }
  return <LibraryAppInner onLogout={() => setSession('login')} />
}
