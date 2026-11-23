import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import EpubContent, { type EpubTocItem, type EpubApi } from './EpubContent'
import PdfContent from './PdfContent'
import TocDrawer from './TocDrawer'
import { dropTitlePara } from './chapterText'
import type { NovelJobState, OpenedBook } from './types'

type Theme = 'paper' | 'sepia' | 'green' | 'ink'
type Props = {
  bookId: number
  theme: Theme
  onThemeChange: (t: Theme) => void
  onExit: () => void
  onToast?: (text: string) => void
}

export default function ReaderView({ bookId, theme, onThemeChange, onExit, onToast }: Props) {
  const [book, setBook] = useState<OpenedBook | null>(null)
  const [chIdx, setChIdx] = useState(0)
  const [paras, setParas] = useState<string[] | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [label, setLabel] = useState('')
  const [tocOpen, setTocOpen] = useState(false)
  const [setOpen, setSetOpen] = useState(false)
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('read-size')) || 17)
  const [lh, setLh] = useState(() => localStorage.getItem('read-lh') || '1.9')
  const [pdfZoom, setPdfZoom] = useState(() => Number(localStorage.getItem('pdf-zoom')) || 1)
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([])
  const [novelJob, setNovelJob] = useState<NovelJobState | null>(null)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const epubApiRef = useRef<EpubApi | null>(null)
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef(false)
  const lastLocRef = useRef({ idx: 0, pct: 0, label: '', cfi: '' })

  const isTxt = book?.format === 'TXT' || book?.format === 'MD'
  const isEpub = book?.format === 'EPUB'
  const isPdf = book?.format === 'PDF'
  const isNovel = book?.format === 'NOVEL'
  const isChaptered = isTxt || isNovel // chapters 表驱动（含正文编辑/目录编辑）
  const canEditChapter = isChaptered // 章节内容编辑仅对库内章节开放

  const chTitle = useMemo(
    () => book?.toc.find((t) => t.idx === chIdx)?.title ?? '',
    [book, chIdx]
  )

  /* 打开书：元数据 + 恢复位置 */
  useEffect(() => {
    let alive = true
    window.mozhi?.openBook(bookId).then((b) => {
      if (!alive || !b) return
      setBook(b)
      setChIdx(b.currentChapter)
      setPct(b.progress)
      setLabel(b.toc.find((t) => t.idx === b.currentChapter)?.title ?? '')
    })
    return () => {
      alive = false
    }
  }, [bookId])

  /* 加载章内容并滚动定位（txt/md/novel） */
  useEffect(() => {
    if (!book || !isChaptered) return
    let alive = true
    window.mozhi?.getChapter(book.id, chIdx).then((ch) => {
      if (!alive || !ch) return
      if (book.format === 'MD') {
        setParas(null)
        setHtml(marked.parse(ch.content, { async: false }) as string)
      } else {
        setHtml(null)
        // 站点正文第一行常重复章题：渲染时统一去重（历史库数据同样生效，无需重抓）
        const title = book.toc.find((t) => t.idx === chIdx)?.title ?? ''
        setParas(dropTitlePara(title, ch.content.split('\n')))
      }
      // 章切换后恢复滚动：同章用 pct，新章置顶（双 rAF 等待 React 提交与布局）
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = scrollRef.current
          if (!el) return
          el.scrollTop = 0
          if (chIdx === book.currentChapter && book.progress > 0 && book.progress < 100) {
            el.scrollTop = (el.scrollHeight - el.clientHeight) * (book.progress / 100)
          }
        })
      )
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chIdx, isChaptered])

  /* 小说抓取状态：打开即静默增量检查 + 订阅更新（章数变化后刷新元数据） */
  const userUpdateRef = useRef(false)
  useEffect(() => {
    if (!isNovel) return
    let alive = true
    const baseTotal = book?.totalChapters ?? 0
    window.mozhi?.novelStatus(bookId).then((j) => {
      if (!alive) return
      if (j) setNovelJob(j)
      // 连载书：打开第一时间自动尝试拉取更新（用户暂停过的除外，静默不打扰）
      if (!j || (j.status !== 'running' && j.status !== 'paused')) {
        void window.mozhi?.resumeNovel(bookId)
      }
    })
    const off = window.mozhi?.onNovelProgress((s) => {
      if (s.bookId !== bookId) return
      setNovelJob(s)
      if (s.status === 'idle') {
        // 抓取完成：刷新书元数据与目录（保留当前章）
        window.mozhi?.openBook(bookId).then((b) => {
          if (!alive || !b) return
          setBook(b)
          const added = b.totalChapters - baseTotal
          if (baseTotal <= 0) onToast?.(`《${book?.title ?? ''}》抓取完成 · 共 ${b.totalChapters} 章`)
          else if (added > 0) onToast?.(`《${book?.title ?? ''}》更新完成 · 新增 ${added} 章`)
          else if (userUpdateRef.current) onToast?.(`《${book?.title ?? ''}》已是最新`)
          userUpdateRef.current = false
        })
      }
      if (s.status === 'error') {
        onToast?.(`《${book?.title ?? ''}》更新失败：${s.error ?? '未知错误'}（详见设置·运行日志）`)
        userUpdateRef.current = false
      }
    })
    return () => {
      alive = false
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, isNovel])

  /* 章节重载（编辑/删除/合并后）：沿用 chIdx 重新拉内容与 toc */
  const reloadChapter = useCallback(() => {
    if (!book) return
    window.mozhi?.openBook(book.id).then((b) => {
      if (!b) return
      setBook(b)
      // 若当前章已被软删/越界，跳到有效章
      if (!b.toc.some((t) => t.idx === chIdx)) {
        const next = b.toc.find((t) => t.idx >= chIdx) ?? b.toc[b.toc.length - 1]
        if (next) setChIdx(next.idx)
      }
    })
  }, [book, chIdx])

  /* 字号/行距持久化 + CSS 变量 */
  useEffect(() => {
    document.documentElement.style.setProperty('--read-size', fontSize + 'px')
    document.documentElement.style.setProperty('--read-lh', lh)
    localStorage.setItem('read-size', String(fontSize))
    localStorage.setItem('read-lh', lh)
  }, [fontSize, lh])

  useEffect(() => {
    localStorage.setItem('pdf-zoom', String(pdfZoom))
  }, [pdfZoom])

  /* 统一进度保存管道：记录最新位置 → 节流落库 */
  const flushSave = useCallback(() => {
    if (book) {
      const l = lastLocRef.current
      window.mozhi?.saveProgress(book.id, l.idx, l.pct, l.label, l.cfi)
    }
    pendingSave.current = false
  }, [book])

  const noteLoc = useCallback(
    (idx: number, p: number, lab: string, cfi = ''): void => {
      lastLocRef.current = { idx, pct: p, label: lab, cfi }
      setPct(p)
      setLabel(lab)
      pendingSave.current = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(flushSave, 1200)
    },
    [flushSave]
  )

  /* 退出时兜底保存 */
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (pendingSave.current) flushSave()
    }
  }, [flushSave])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const denom = el.scrollHeight - el.clientHeight
    const p = denom > 0 ? Math.min(100, Math.round((el.scrollTop / denom) * 100)) : 100
    noteLoc(chIdx, p, chTitle)
  }

  const goChapter = useCallback(
    (idx: number) => {
      if (!book || idx < 0 || idx > book.totalChapters - 1) return
      const t = book.toc.find((x) => x.idx === idx)?.title ?? ''
      setChIdx(idx)
      noteLoc(idx, 0, t)
      setTocOpen(false)
    },
    [book, noteLoc]
  )

  /* 键盘：←→ 翻章，↑↓ 滑屏，Esc 关弹层 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') {
        if (isChaptered) goChapter(chIdx + 1)
        else if (isEpub) epubApiRef.current?.next()
      } else if (e.key === 'ArrowLeft') {
        if (isChaptered) goChapter(chIdx - 1)
        else if (isEpub) epubApiRef.current?.prev()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        /* 小说正文页：上下键整屏滑动（90% 视口高，平滑滚动） */
        const el = scrollRef.current
        if (!el || !isChaptered) return
        e.preventDefault()
        const step = Math.round(el.clientHeight * 0.9)
        el.scrollBy({ top: e.key === 'ArrowDown' ? step : -step, behavior: 'smooth' })
      } else if (e.key === 'Escape') {
        setTocOpen(false)
        setSetOpen(false)
        setExportOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chIdx, goChapter, isChaptered, isEpub])

  /* 章节编辑：进入（载入原文）/ 保存 / 取消 */
  const startEdit = (): void => {
    if (paras === null) return
    setEditText(paras.join('\n'))
    setEditing(true)
  }
  const saveEdit = (): void => {
    if (!book) return
    void window.mozhi?.editChapterContent(book.id, chIdx, editText).then(() => {
      setEditing(false)
      setParas(editText.split('\n'))
      onToast?.('已保存本章修改')
    })
  }

  /* 小说：更新（增量抓取）/ 暂停 / 导出 */
  const novelUpdate = (): void => {
    userUpdateRef.current = true
    void window.mozhi?.resumeNovel(bookId).then((j) => {
      if (j) setNovelJob(j)
      onToast?.(j?.status === 'running' ? '正在检查更新…（目录解析中）' : '开始增量更新…')
    })
  }
  const novelPause = (): void => {
    void window.mozhi?.pauseNovel(bookId).then((j) => {
      if (j) setNovelJob(j)
      onToast?.('已暂停抓取，可随时续抓')
    })
  }
  /* 重抓本书（两击确认）：清空章节与进度，用当前解析器从头抓（修复旧数据用） */
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const t = window.setTimeout(() => setConfirmReset(false), 3000)
    return () => window.clearTimeout(t)
  }, [confirmReset])
  const novelRecrawl = (): void => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setConfirmReset(false)
    void window.mozhi?.recrawlNovel(bookId).then((j) => {
      if (j) setNovelJob(j)
      onToast?.('已清空本书章节，开始重新抓取…')
      setHtml(null)
      setParas(['正在重新抓取，请稍候…'])
      window.mozhi?.openBook(bookId).then((b) => {
        if (b) {
          setBook(b)
          setChIdx(b.currentChapter)
          setPct(b.progress)
        }
      })
    })
  }
  const novelExport = (encoding: 'utf-8' | 'gbk'): void => {
    setExportOpen(false)
    void window.mozhi?.exportNovel(bookId, encoding).then((r) => {
      if (!r.canceled) onToast?.(`已导出：${r.path}`)
    })
  }

  if (!book) {
    return (
      <section className="view reader-loading">
        <p className="stats">正在打开…</p>
      </section>
    )
  }

  const posText = isEpub
    ? `${label || '正文'} · ${pct}%`
    : isPdf
      ? `${label || '第 1 页'} · ${pct}%`
      : `${chIdx + 1} / ${book.totalChapters} · ${pct}%`

  return (
    <section className="reader">
      <header className="reader-head">
        <button className="icon-btn" onClick={onExit} title="返回书架">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
        </button>
        <div className="reader-title">
          <b>{book.title}</b>
          <span>
            {book.author ? book.author + ' · ' : ''}
            {book.format}
            {novelJob && novelJob.status === 'running'
              ? ` · 抓取中 ${novelJob.done}/${novelJob.total || '?'}`
              : ''}
            {novelJob && novelJob.status === 'paused' ? ` · 已暂停 ${novelJob.done}/${novelJob.total || '?'}` : ''}
            {novelJob && novelJob.status === 'error' ? ` · 上次抓取出错` : ''}
          </span>
        </div>
        <div className="reader-pos">{posText}</div>
        {isNovel && (
          <>
            {novelJob?.status === 'running' ? (
              <button className="icon-btn" onClick={novelPause} title="暂停抓取">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="6" y="5" width="2.6" height="10" rx="0.6" /><rect x="11.4" y="5" width="2.6" height="10" rx="0.6" /></svg>
              </button>
            ) : (
              <button className="icon-btn" onClick={novelUpdate} title="更新本书（增量抓取新章）">
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3h-3" /></svg>
              </button>
            )}
            <button className={'icon-btn' + (exportOpen ? ' on' : '')} onClick={() => setExportOpen(!exportOpen)} title="导出 txt">
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 16h12" /></svg>
            </button>
            <button
              className={'icon-btn danger' + (confirmReset ? ' on' : '')}
              onClick={novelRecrawl}
              title={confirmReset ? '再点一次确认：清空并重新抓取' : '重抓本书（清空后重新抓取全部章节）'}
            >
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M8.5 9v4M11.5 9v4" /></svg>
            </button>
          </>
        )}
        <button className={'icon-btn' + (setOpen ? ' on' : '')} onClick={() => setSetOpen(!setOpen)} title="阅读设置">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h9M15.5 6H16M4 14h1.5M8 14h8" /><circle cx="14" cy="6" r="1.8" /><circle cx="6.5" cy="14" r="1.8" /></svg>
        </button>
        {!isPdf && (
          <button className={'icon-btn' + (tocOpen ? ' on' : '')} onClick={() => setTocOpen(!tocOpen)} title="目录">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 5h12M4 10h12M4 15h8" /></svg>
          </button>
        )}
      </header>

      {isEpub ? (
        <EpubContent
          key={book.id}
          book={book}
          theme={theme}
          fontSize={fontSize}
          lh={lh}
          onRelocate={(r) => noteLoc(0, r.pct, r.label, r.cfi)}
          onReady={(toc, api) => {
            setEpubToc(toc)
            epubApiRef.current = api
          }}
        />
      ) : isPdf ? (
        <PdfContent
          key={book.id}
          book={book}
          zoom={pdfZoom}
          onPage={(p) => noteLoc(p.page, Math.round((p.page / p.total) * 100), `第 ${p.page} 页`)}
        />
      ) : (
        <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
          <article className="reader-page">
            {editing ? (
              <div className="ch-editor">
                <label className="sf-label" htmlFor="ch-edit-area">
                  正在编辑：{chTitle}（每行一个段落）
                </label>
                <textarea
                  id="ch-edit-area"
                  className="ch-edit-area"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  rows={18}
                />
                <div className="ch-edit-actions">
                  <button className="btn primary" onClick={saveEdit}>
                    保存
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="ch-title">{chTitle}</h2>
                {html !== null ? (
                  <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  (paras ?? []).map((p, i) => <p key={i} className="read-p">{p}</p>)
                )}
              </>
            )}
            <nav className="chapter-nav">
              <button className="btn ghost" disabled={chIdx <= 0} onClick={() => goChapter(chIdx - 1)}>
                上一章
              </button>
              <span className="ch-pos">
                {chIdx + 1} / {book.totalChapters}
              </span>
              {canEditChapter && !editing && (
                <button className="btn ghost" onClick={startEdit} title="编辑本章内容（清洗广告/错字）">
                  编辑本章
                </button>
              )}
              <button
                className="btn ghost"
                disabled={chIdx >= book.totalChapters - 1}
                onClick={() => goChapter(chIdx + 1)}
              >
                下一章
              </button>
            </nav>
          </article>
        </div>
      )}

      {/* 阅读设置弹层 */}
      {setOpen && (
        <div className="reader-pop" onMouseLeave={() => setSetOpen(false)}>
          <div className="pop-row">
            <span className="pop-label">主题</span>
            <div className="theme-row">
              {([['paper', '纸'], ['sepia', '暖'], ['green', '绿'], ['ink', '墨']] as const).map(([t, tLabel]) => (
                <button
                  key={t}
                  className={'theme-swatch' + (theme === t ? ' active' : '')}
                  onClick={() => onThemeChange(t as Theme)}
                >
                  <i className={'swatch swatch-' + t} />
                  {tLabel}
                </button>
              ))}
            </div>
          </div>
          {!isPdf && (
            <>
              <div className="pop-row">
                <span className="pop-label">字号</span>
                <div className="stepper">
                  <button onClick={() => setFontSize(Math.max(14, fontSize - 1))}>−</button>
                  <b>{fontSize}</b>
                  <button onClick={() => setFontSize(Math.min(24, fontSize + 1))}>＋</button>
                </div>
              </div>
              <div className="pop-row">
                <span className="pop-label">行距</span>
                <div className="seg">
                  {(['1.7', '1.9', '2.2'] as const).map((v) => (
                    <button key={v} className={lh === v ? 'active' : ''} onClick={() => setLh(v)}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {isPdf && (
            <div className="pop-row">
              <span className="pop-label">缩放</span>
              <div className="seg">
                {([[0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']] as const).map(
                  ([v, t]) => (
                    <button
                      key={v}
                      className={pdfZoom === v ? 'active' : ''}
                      onClick={() => setPdfZoom(v)}
                    >
                      {t}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 导出弹层（小说） */}
      {isNovel && exportOpen && (
        <div className="reader-pop export-pop" onMouseLeave={() => setExportOpen(false)}>
          <div className="pop-row">
            <span className="pop-label">导出 txt</span>
            <div className="seg">
              <button onClick={() => novelExport('utf-8')}>UTF-8</button>
              <button onClick={() => novelExport('gbk')}>GBK（旧设备）</button>
            </div>
          </div>
          <p className="pop-hint">合并全部未删章节导出为一个 txt 文件。</p>
        </div>
      )}

      {/* 目录抽屉（虚拟滚动，PDF 无目录） */}
      {!isPdf && (
        <TocDrawer
          open={tocOpen}
          count={isEpub ? epubToc.length : book.totalChapters}
          currentIdx={isEpub ? epubToc.findIndex((t) => t.label === label) : chIdx}
          head={isEpub ? `目录 · ${epubToc.length} 章` : `目录 · ${book.totalChapters} 章`}
          getTitle={isEpub ? (i) => epubToc[i]?.label ?? '' : (i) => book.toc[i]?.title ?? ''}
          editable={isChaptered}
          onGo={
            isEpub
              ? (i) => {
                  const t = epubToc[i]
                  if (t) epubApiRef.current?.goTo(t.href)
                  setTocOpen(false)
                }
              : (i) => goChapter(i)
          }
          onDelete={isChaptered ? (idx) => {
            if (!book) return
            void window.mozhi?.deleteChapter(book.id, idx).then(() => {
              onToast?.('已删除该章')
              reloadChapter()
            })
          } : undefined}
          onRename={isChaptered ? (idx, title) => {
            if (!book || !title.trim()) return
            void window.mozhi?.renameChapter(book.id, idx, title.trim()).then(() => {
              onToast?.('已重命名章节')
              reloadChapter()
            })
          } : undefined}
          onInsert={isChaptered ? (below, title, content) => {
            if (!book) return
            const at = chIdx + (below ? 1 : 0)
            void window.mozhi?.insertChapter(book.id, at, title, content).then((newIdx) => {
              onToast?.(`已插入章节「${title.slice(0, 20)}」`)
              window.mozhi?.openBook(book.id).then((b) => {
                if (!b) return
                setBook(b)
                setChIdx(newIdx)
                noteLoc(newIdx, 0, title)
              })
            })
          } : undefined}
          onClose={() => setTocOpen(false)}
        />
      )}
    </section>
  )
}
