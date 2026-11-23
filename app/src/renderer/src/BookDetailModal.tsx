import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { BookDetail } from './types'

/** 封面 src：mozhi-cover: 协议（Electron）；devMock 直接用 http 路径 */
export function coverSrc(coverPath: string): string {
  if (/^(https?:|\/|data:)/.test(coverPath)) return coverPath
  /* opaque path 形式：非 standard scheme，pathname 即文件名 */
  return `mozhi-cover:${coverPath}`
}

interface Props {
  bookId: number
  onClose: () => void
  /** 保存成功后通知书架刷新 */
  onChanged: () => void
}

const COVER_PALETTE = ['#221D17', '#B5402A', '#44523F', '#33424E', '#7A5C3E']

/** 书籍详情：编辑书名/作者、设置封面、查看来源与下载地址 */
export default function BookDetailModal({ bookId, onClose, onChanged }: Props): JSX.Element {
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [copyHint, setCopyHint] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void window.mozhi?.getBookDetail(bookId).then((d) => {
      if (!alive || !d) return
      setDetail(d)
      setTitle(d.title)
      setAuthor(d.author)
      setDownloadUrl(d.downloadUrl)
      setCoverPath(d.coverPath)
    })
    return () => {
      alive = false
    }
  }, [bookId])

  /* 打开即聚焦书名（无障碍：焦点进入对话框） */
  useEffect(() => {
    if (detail) titleRef.current?.focus()
  }, [detail])

  /* Esc 关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!detail) {
    return (
      <div className="dialog-mask" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <p className="dialog-loading">加载中…</p>
        </div>
      </div>
    )
  }

  const dirty =
    title !== detail.title ||
    author !== detail.author ||
    downloadUrl !== detail.downloadUrl ||
    coverPath !== detail.coverPath

  const save = (): void => {
    if (!title.trim()) {
      setErr('书名不能为空')
      return
    }
    setErr('')
    setSaving(true)
    void window.mozhi
      ?.updateBook(bookId, { title, author, downloadUrl })
      .then((ok) => {
        setSaving(false)
        if (!ok) {
          setErr('保存失败，请重试')
          return
        }
        onChanged()
        onClose()
      })
      .catch(() => {
        setSaving(false)
        setErr('保存失败，请重试')
      })
  }

  const pickCover = (): void => {
    void window.mozhi?.pickCover(bookId).then((r) => {
      if (r.ok && r.name) {
        setCoverPath(r.name)
        onChanged()
      } else if (r.error === 'format') {
        setErr('不支持的图片格式（请用 jpg/png/webp/bmp/gif）')
      }
    })
  }

  const clearCover = (): void => {
    void window.mozhi?.clearCover(bookId).then(() => {
      setCoverPath('')
      onChanged()
    })
  }

  const copyText = (t: string): void => {
    void navigator.clipboard?.writeText(t).then(() => {
      setCopyHint('已复制')
      window.setTimeout(() => setCopyHint(''), 1500)
    })
  }

  const srcKind = detail.tocUrl
    ? '网页抓取'
    : detail.originPath
      ? '本地文件'
      : detail.format === 'NOVEL'
        ? '在线书籍'
        : '内置'
  const srcPath = detail.tocUrl || detail.originPath || ''

  return (
    <div
      className="dialog-mask"
      onClick={() => {
        onClose()
      }}
    >
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <span className="dialog-eyebrow">DETAILS · 书籍详情</span>
          <button className="dialog-close" onClick={onClose} title="关闭" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </header>

        <div className="detail-body">
          <div className="detail-cover-col">
            <button
              className={'detail-cover' + (coverPath ? ' has-img' : '')}
              onClick={pickCover}
              title="点击更换封面图片"
            >
              {coverPath ? (
                <img className="detail-cover-img" src={coverSrc(coverPath)} alt="封面" />
              ) : (
                <span
                  className="detail-cover-fallback"
                  style={{ background: COVER_PALETTE[detail.coverIdx % COVER_PALETTE.length] }}
                >
                  <span className="cover-title">{detail.title}</span>
                  <span className="cover-author">{detail.author}</span>
                </span>
              )}
              <span className="detail-cover-veil">
                {coverPath ? '更换封面' : '设置封面'}
                <small>jpg / png / webp</small>
              </span>
            </button>
            {coverPath && (
              <button className="detail-cover-reset" onClick={clearCover}>
                恢复默认封面
              </button>
            )}
          </div>

          <div className="detail-form">
            <div className="form-row">
              <label htmlFor="bd-title">书名</label>
              <input
                id="bd-title"
                ref={titleRef}
                className="sf-input grow"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="书名"
              />
            </div>
            <div className="form-row">
              <label htmlFor="bd-author">作者</label>
              <input
                id="bd-author"
                className="sf-input grow"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="作者（可留空）"
              />
            </div>
            <div className="form-row">
              <label htmlFor="bd-url">下载地址</label>
              <input
                id="bd-url"
                className="sf-input grow"
                type="url"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="有下载地址时填写，可一键打开"
              />
              {/^https?:\/\//.test(downloadUrl.trim()) && (
                <a
                  className="icon-btn"
                  href={downloadUrl.trim()}
                  target="_blank"
                  rel="noreferrer"
                  title="在浏览器打开"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M6 3H3v10h10v-3" />
                    <path d="M9 3h4v4M13 3L7 9" />
                  </svg>
                </a>
              )}
            </div>

            <dl className="detail-meta">
              <div className="meta-line">
                <dt>格式</dt>
                <dd>
                  {detail.format}
                  {detail.chapterCount > 0 && ` · ${detail.chapterCount} 章`}
                </dd>
              </div>
              <div className="meta-line">
                <dt>来源</dt>
                <dd>
                  <span className="src-badge">{srcKind}</span>
                </dd>
              </div>
              {srcPath && (
                <div className="meta-line">
                  <dt>{detail.tocUrl ? '目录页' : '文件路径'}</dt>
                  <dd className="mono-path">
                    <span className="path-text">{srcPath}</span>
                    <button className="mini-copy" onClick={() => copyText(srcPath)} title="复制">
                      {copyHint || '复制'}
                    </button>
                  </dd>
                </div>
              )}
              <div className="meta-line">
                <dt>进度</dt>
                <dd>
                  {detail.progress > 0
                    ? `${Math.round(detail.progress)}%${detail.chapterLabel ? ` · ${detail.chapterLabel}` : ''}`
                    : '未开始'}
                </dd>
              </div>
              <div className="meta-line">
                <dt>导入时间</dt>
                <dd>{detail.createdAt || '—'}</dd>
              </div>
            </dl>
          </div>
        </div>

        {err && <p className="form-err">{err}</p>}

        <footer className="dialog-foot">
          <span className={'dirty-hint' + (dirty ? ' show' : '')}>有未保存的修改</span>
          <button className="btn sm ghost" onClick={onClose}>
            取消
          </button>
          <button className={'btn sm' + (dirty ? ' primary' : '')} disabled={saving || !dirty} onClick={save}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}
