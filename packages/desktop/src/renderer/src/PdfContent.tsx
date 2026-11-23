import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OpenedBook } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

type Props = {
  book: OpenedBook
  zoom: number
  onPage: (p: { page: number; total: number }) => void
}

export default function PdfContent({ book, zoom, onPage }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<{ cancel(): void | Promise<void> } | null>(null)
  const docTaskRef = useRef<{ destroy(): Promise<void> } | null>(null)
  const onPageRef = useRef(onPage)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [total, setTotal] = useState(0)
  const [pageNo, setPageNo] = useState(() =>
    book.currentChapter > 0 ? book.currentChapter : 1
  )
  const [width, setWidth] = useState(0)
  const [error, setError] = useState('')

  onPageRef.current = onPage

  /* 加载文档 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await window.mozhi?.readBookFile(book.id)
        if (!alive) return
        if (!r) {
          setError('无法读取图书文件（文件可能已被移动或删除）')
          return
        }
        const task = pdfjsLib.getDocument({
          data: new Uint8Array(r.data),
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/'
        })
        docTaskRef.current = task
        const d = await task.promise
        if (!alive) {
          void task.destroy()
          return
        }
        setDoc(d)
        setTotal(d.numPages)
        setPageNo((p) => Math.min(p, d.numPages))
      } catch (e) {
        console.error('[pdf]', e)
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
      void docTaskRef.current?.destroy().catch(() => undefined)
      docTaskRef.current = null
    }
  }, [book.id])

  /* 容器宽度监听（fit-width 渲染基准） */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* 渲染当前页 */
  useEffect(() => {
    if (!doc || !width) return
    let cancelled = false
      ; (async () => {
      try {
        const page = await doc.getPage(pageNo)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = (width / base.width) * zoom
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = Math.floor(viewport.width) + 'px'
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        try {
          taskRef.current?.cancel()
        } catch {
          /* noop */
        }
        const task = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        })
        taskRef.current = task
        await task.promise
      } catch (e) {
        // RenderingCancelledException 属正常中断
        const name = (e as { name?: string })?.name
        if (name !== 'RenderingCancelledException' && !cancelled) {
          console.error('[pdf render]', e)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNo, zoom, width])

  /* 上报页码 */
  useEffect(() => {
    if (doc && total > 0) onPageRef.current({ page: pageNo, total })
  }, [pageNo, total, doc])

  const goPage = (n: number): void => {
    if (n >= 1 && n <= total) setPageNo(n)
  }

  /* 键盘翻页 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') goPage(pageNo + 1)
      else if (e.key === 'ArrowLeft') goPage(pageNo - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="pdf-wrap" ref={wrapRef}>
      {error && (
        <article className="reader-page">
          <p className="read-p">PDF 打开失败：{error}</p>
        </article>
      )}
      <canvas ref={canvasRef} className="pdf-canvas" />
      {!error && total > 0 && (
        <nav className="chapter-nav pdf-nav">
          <button className="btn ghost" disabled={pageNo <= 1} onClick={() => goPage(pageNo - 1)}>
            上一页
          </button>
          <span className="ch-pos">
            {pageNo} / {total}
          </span>
          <button className="btn ghost" disabled={pageNo >= total} onClick={() => goPage(pageNo + 1)}>
            下一页
          </button>
        </nav>
      )}
    </div>
  )
}
