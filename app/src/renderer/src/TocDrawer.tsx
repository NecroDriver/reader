/**
 * 目录抽屉（虚拟滚动 + 章节名模糊搜索 + 行内菜单 + 新增/导入章节）。
 * 万章级书（如 3287 章网文）全量渲染目录按钮会令每次 ReaderView
 * 重渲染都对数千节点做 diff，滚动即冻结；这里只渲染可见区 ± buffer。
 * 每章右侧「⋯」按钮下拉：重命名 / 删除。
 * 头部「＋」：新增章节 / 导入 txt·md 单章（插入到当前章上方或下方）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { decodeTextFile } from './chapterText'

const ROW_H = 35
const BUF = 6

type Props = {
  open: boolean
  count: number
  currentIdx: number
  head: string
  getTitle: (idx: number) => string
  editable?: boolean
  onGo: (idx: number) => void
  onDelete?: (idx: number) => void
  onRename?: (idx: number, title: string) => void
  onInsert?: (below: boolean, title: string, content: string) => void
  onClose: () => void
}

export default function TocDrawer({
  open,
  count,
  currentIdx,
  head,
  getTitle,
  editable = false,
  onGo,
  onDelete,
  onRename,
  onInsert,
  onClose
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [first, setFirst] = useState(0)
  const [visible, setVisible] = useState(32)
  const [query, setQuery] = useState('')
  const [menuIdx, setMenuIdx] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  /* 新增章节面板 */
  const [insertOpen, setInsertOpen] = useState(false)
  const [insTitle, setInsTitle] = useState('')
  const [insContent, setInsContent] = useState('')
  const [insBelow, setInsBelow] = useState(true)
  const [insFile, setInsFile] = useState('')

  const q = query.trim().toLowerCase()
  const [desc, setDesc] = useState(() => localStorage.getItem('mozhi-toc-desc') === '1')
  const matches = useMemo(() => {
    if (!q) return null
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      if (getTitle(i).toLowerCase().includes(q)) out.push(i)
    }
    return desc ? out.reverse() : out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, count, getTitle, desc])

  const toggleDesc = (): void => {
    setDesc((d) => {
      const nd = !d
      localStorage.setItem('mozhi-toc-desc', nd ? '1' : '0')
      return nd
    })
  }

  /* 行号 r（视口内序数）→ 章节索引：搜索态查 matches，倒序态从尾数 */
  const idxAt = (r: number): number => {
    if (matches) return matches[r]
    return desc ? count - 1 - r : r
  }

  /* 每次打开定位到当前章（搜索态不动） */
  useEffect(() => {
    if (!open || q) return
    const el = listRef.current
    if (!el) return
    const row = desc ? count - 1 - currentIdx : currentIdx
    el.scrollTop = Math.max(0, row * ROW_H - el.clientHeight / 2)
    setFirst(Math.max(0, Math.floor(el.scrollTop / ROW_H) - BUF))
    setVisible(Math.ceil(el.clientHeight / ROW_H) + BUF * 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentIdx, desc])

  /* 搜索词或排序变化回顶 */
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = 0
    setFirst(0)
  }, [q, desc])

  const total = matches ? matches.length : count

  const onScroll = (): void => {
    const el = listRef.current
    if (!el) return
    setFirst(Math.max(0, Math.floor(el.scrollTop / ROW_H) - BUF))
    setVisible(Math.ceil(el.clientHeight / ROW_H) + BUF * 2)
    setMenuIdx(null)
  }

  const commitRename = (idx: number): void => {
    if (renaming === idx && renameText.trim() && onRename) onRename(idx, renameText)
    setRenaming(null)
  }

  /* 新增章节：提交（归一换行与空段）/ 导入文件（UTF-8→GBK 探测，文件名预填标题） */
  const commitInsert = (): void => {
    if (!onInsert) return
    const title = insTitle.trim()
    const content = insContent
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join('\n')
    if (!title || !content) return
    onInsert(insBelow, title, content)
    setInsertOpen(false)
    setInsTitle('')
    setInsContent('')
    setInsFile('')
  }
  const onPickFile = (f: File | undefined): void => {
    if (!f) return
    void decodeTextFile(f).then((text) => {
      setInsContent(text)
      setInsFile(f.name)
      if (!insTitle.trim()) setInsTitle(f.name.replace(/\.(txt|md)$/i, ''))
    })
  }

  const items: ReactElement[] = []
  const end = Math.min(total, first + visible)
  for (let r = first; r < end; r++) {
    const i = idxAt(r)
    if (renaming === i) {
      items.push(
        <div key={i} className="toc-item rename" style={{ position: 'absolute', top: r * ROW_H, height: ROW_H }}>
          <input
            className="toc-rename-input"
            value={renameText}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename(i)
              if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={() => commitRename(i)}
          />
        </div>
      )
      continue
    }
    items.push(
      <div
        key={i}
        className={'toc-item' + (i === currentIdx ? ' current' : '') + (menuIdx === i ? ' menu-open' : '')}
        style={{ position: 'absolute', top: r * ROW_H, height: ROW_H, zIndex: menuIdx === i ? 5 : undefined }}
      >
        <button
          className="toc-go"
          onClick={() => {
            setMenuIdx(null)
            onGo(i)
          }}
          title={getTitle(i)}
        >
          {getTitle(i)}
        </button>
        {editable && (
          <button
            className="toc-more"
            aria-label="章节操作"
            title="章节操作"
            onClick={(e) => {
              e.stopPropagation()
              setMenuIdx(menuIdx === i ? null : i)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="3" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="8" cy="13" r="1.4" />
            </svg>
          </button>
        )}
        {menuIdx === i && (
          <div className="toc-menu" onClick={(e) => e.stopPropagation()}>
            {onRename && (
              <button
                className="toc-menu-item"
                onClick={() => {
                  setMenuIdx(null)
                  setRenaming(i)
                  setRenameText(getTitle(i))
                }}
              >
                重命名
              </button>
            )}
            {onDelete && (
              <button
                className="toc-menu-item danger"
                onClick={() => {
                  setMenuIdx(null)
                  onDelete(i)
                }}
              >
                删除本章
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={'drawer-mask' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'reader-toc' + (open ? ' open' : '')} onClick={() => menuIdx !== null && setMenuIdx(null)}>
        <div className="toc-headrow">
          <p className="toc-head">{matches ? `匹配 ${matches.length} / ${count} 章` : head}</p>
          <button
            className={'toc-sort' + (desc ? ' on' : '')}
            aria-label={desc ? '切换为正序排列' : '切换为倒序排列'}
            aria-pressed={desc}
            title={desc ? '当前：倒序（最新在前）\n点击切换为正序' : '当前：正序\n点击切换为倒序'}
            onClick={toggleDesc}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4.5h7M3 8h5M3 11.5h3" />
              <path d="M12.5 6.5v6M10.5 10.5l2 2 2-2" />
            </svg>
          </button>
          {onInsert && (
            <button
              className={'toc-add' + (insertOpen ? ' on' : '')}
              aria-label="新增章节"
              title="新增章节 / 导入单章"
              onClick={() => setInsertOpen(!insertOpen)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          )}
        </div>
        {onInsert && insertOpen && (
          <div
            className="toc-insert"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setInsertOpen(false)
              }
            }}
          >
            <div className="ti-row">
              <label className="ti-label" htmlFor="ti-title">标题</label>
              <input
                id="ti-title"
                className="ti-input"
                type="text"
                value={insTitle}
                autoFocus
                placeholder="新章节标题"
                onChange={(e) => setInsTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitInsert()
                }}
              />
            </div>
            <div className="ti-row">
              <label className="ti-label" htmlFor="ti-content">正文（每行一个段落）</label>
              <textarea
                id="ti-content"
                className="ti-textarea"
                rows={4}
                value={insContent}
                placeholder="可直接输入，或点下方按钮从文件导入"
                onChange={(e) => setInsContent(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="ti-row ti-file">
              <button className="btn ghost ti-file-btn" type="button" onClick={() => fileRef.current?.click()}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5M4 16h12" />
                </svg>
                导入 txt / md
              </button>
              {insFile && (
                <span className="ti-filename" title={insFile}>
                  {insFile}
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,text/plain"
                hidden
                onChange={(e) => {
                  onPickFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            <div className="ti-row ti-pos">
              <span className="ti-label">插入位置</span>
              <div className="seg">
                <button type="button" className={insBelow ? 'active' : ''} onClick={() => setInsBelow(true)}>
                  当前章下方
                </button>
                <button type="button" className={!insBelow ? 'active' : ''} onClick={() => setInsBelow(false)}>
                  当前章上方
                </button>
              </div>
            </div>
            <div className="ti-actions">
              <button
                className="btn primary"
                type="button"
                disabled={!insTitle.trim() || !insContent.trim()}
                onClick={commitInsert}
              >
                添加
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setInsertOpen(false)
                  setInsTitle('')
                  setInsContent('')
                  setInsFile('')
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        <div className="toc-search">
          <input
            type="text"
            value={query}
            placeholder="搜索章节…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
          {query && (
            <button
              className="toc-clear"
              aria-label="清空搜索"
              title="清空搜索"
              onClick={() => setQuery('')}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="toc-list" ref={listRef} onScroll={onScroll}>
          <div style={{ position: 'relative', height: total * ROW_H }}>{items}</div>
        </div>
      </aside>
    </>
  )
}
