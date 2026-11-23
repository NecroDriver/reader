import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenedArticle } from './types'

interface Props {
  articleId: number
  onExit: () => void
}

/** 文章阅读视图：打开即标记已读；滚动进度节流保存并支持恢复 */
export default function ArticleView({ articleId, onExit }: Props) {
  const [art, setArt] = useState<OpenedArticle | null>(null)
  const [pct, setPct] = useState(0)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingSave = useRef(false)
  const lastPctRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const flushSave = useCallback(() => {
    if (!pendingSave.current) return
    pendingSave.current = false
    window.mozhi?.saveArticleProgress(articleId, lastPctRef.current).catch(() => undefined)
  }, [articleId])

  /* 打开文章（标记已读）+ 恢复进度 */
  useEffect(() => {
    let cancelled = false
    setArt(null)
    setError('')
    window.mozhi
      ?.openArticle(articleId)
      .then((a) => {
        if (cancelled || !a) {
          if (!a && !cancelled) setError('文章不存在或已删除')
          return
        }
        setArt(a)
        setPct(a.progress)
        // 双 rAF 等 React 提交后再恢复滚动位置
        if (a.progress > 0) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el = scrollRef.current
              if (!el) return
              el.scrollTop = (a.progress / 100) * (el.scrollHeight - el.clientHeight)
            })
          )
        } else {
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = 0
          })
        }
      })
      .catch((e) => setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [articleId])

  /* 定时器清理 + 退出兜底保存 */
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      flushSave()
    }
  }, [flushSave])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    const p = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100)
    setPct(p)
    lastPctRef.current = p
    pendingSave.current = true
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => flushSave(), 1200)
  }

  return (
    <div className="reader article-reader">
      <header className="reader-head">
        <button className="icon-btn" onClick={onExit} title="返回书架" aria-label="返回书架">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
        </button>
        <div className="reader-title">
          <strong>{art?.title ?? '正在打开…'}</strong>
          <span>
            {art
              ? [art.source, art.author, art.publishedAt].filter(Boolean).join(' · ')
              : ''}
          </span>
        </div>
        <span className="reader-pos">{pct}%</span>
      </header>
      <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
        {error && <div className="reader-page">
          <p className="ch-title">无法打开</p>
          <p className="read-p">{error}</p>
        </div>}
        {art && (
          <article className="reader-page">
            <h1 className="ch-title" style={{ fontSize: 24 }}>{art.title}</h1>
            <p className="article-meta">
              {[art.source, art.author, art.publishedAt].filter(Boolean).join(' · ')}
            </p>
            <div className="md-body" dangerouslySetInnerHTML={{ __html: art.contentHtml }} />
            {art.url && (
              <p className="article-origin">
                原文：
                <a href={art.url} target="_blank" rel="noreferrer">
                  {art.url.length > 60 ? art.url.slice(0, 60) + '…' : art.url}
                </a>
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  )
}
