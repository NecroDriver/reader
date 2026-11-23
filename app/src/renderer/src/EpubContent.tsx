import { useEffect, useRef, useState } from 'react'
// 副作用 import：注册 <foliate-view> custom element
import './vendor/foliate/view.js'
import type { FoliateView, FoliateTocNode, FoliateRelocateDetail } from './vendor/foliate/view'
import type { OpenedBook } from './types'

export interface EpubTocItem {
  label: string
  href: string
}
export interface EpubApi {
  prev(): void
  next(): void
  goTo(href: string): void
}
type Props = {
  book: OpenedBook
  theme: string
  fontSize: number
  lh: string
  onRelocate: (r: { pct: number; label: string; cfi: string }) => void
  onReady: (toc: EpubTocItem[], api: EpubApi) => void
}

function flattenToc(nodes: FoliateTocNode[] | undefined, out: EpubTocItem[]): void {
  for (const n of nodes ?? []) {
    const label = (n.label ?? '').trim()
    if (label && n.href) out.push({ label, href: n.href })
    if (n.subitems?.length) flattenToc(n.subitems, out)
  }
}

export default function EpubContent({
  book,
  theme,
  fontSize,
  lh,
  onRelocate,
  onReady
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const onRelocateRef = useRef(onRelocate)
  const onReadyRef = useRef(onReady)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  onRelocateRef.current = onRelocate
  onReadyRef.current = onReady

  /* 生命周期：创建 view → open → scrolled 模式 → 恢复位置 */
  useEffect(() => {
    let alive = true
    let view: FoliateView | null = null
    setReady(false)
    setError('')
    ;(async () => {
      try {
        const r = await window.mozhi?.readBookFile(book.id)
        if (!alive) return
        if (!r) {
          setError('无法读取图书文件（文件可能已被移动或删除）')
          return
        }
        const v = document.createElement('foliate-view') as FoliateView
        view = v
        viewRef.current = v
        v.style.height = '100%'
        v.style.display = 'block'
        hostRef.current?.appendChild(v)
        v.addEventListener('relocate', (e) => {
          const d = ((e as CustomEvent).detail ?? {}) as FoliateRelocateDetail
          onRelocateRef.current({
            pct: Math.round((d.fraction ?? 0) * 100),
            label: (d.tocItem?.label ?? '').slice(0, 40),
            cfi: d.cfi ?? ''
          })
        })
        // view.js 依 file.name 分发格式，必须用 File 而非 Blob
        await v.open(
          new File([r.data], `book-${book.id}.epub`, { type: 'application/epub+zip' })
        )
        if (!alive) return
        // 连续滚动模式：与 txt 阅读体验一致
        v.renderer.setAttribute('flow', 'scrolled')
        const toc: EpubTocItem[] = []
        flattenToc(v.book.toc, toc)
        const vv = v
        onReadyRef.current(toc, {
          prev: () => void vv.prev(),
          next: () => void vv.next(),
          goTo: (href: string) => void vv.goTo(href)
        })
        setReady(true)
        if (book.cfi) {
          await v.init({ lastLocation: book.cfi })
        } else if (book.progress > 0 && book.progress < 100) {
          await v.init({})
          await v.goToFraction(book.progress / 100)
        } else {
          await v.init({})
        }
      } catch (e) {
        console.error('[epub]', e)
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
      // 先让已排队的 ResizeObserver 回调跑完（view 仍完整），再销毁，
      // 规避 vendor 在 destroy 后仍触发 render 抛 null 的竞态
      const v = view
      requestAnimationFrame(() => {
        try {
          v?.close()
        } catch {
          /* noop */
        }
        v?.remove()
      })
      viewRef.current = null
    }
  }, [book.id])

  /* 主题/字号/行距 → 注入 iframe 样式 */
  useEffect(() => {
    const v = viewRef.current
    if (!v?.renderer || !ready) return
    const cs = getComputedStyle(document.documentElement)
    const bg = cs.getPropertyValue('--bg').trim() || '#F5EFE3'
    const ink = cs.getPropertyValue('--ink').trim() || '#211B12'
    const seal = cs.getPropertyValue('--seal').trim() || '#B5402A'
    v.renderer.setStyles(
      [
        `html,body{background:${bg}}`,
        `body{color:${ink};font-family:'Noto Serif SC','Source Han Serif SC','SimSun',serif;`,
        `font-size:${fontSize}px;line-height:${lh};padding:12px 8px}`,
        `a{color:${seal}}`,
        `img,svg{max-width:100%;height:auto}`
      ].join('')
    )
  }, [theme, fontSize, lh, ready])

  return (
    <div className="epub-host" ref={hostRef}>
      {error && (
        <article className="reader-page">
          <p className="read-p">EPUB 打开失败：{error}</p>
        </article>
      )}
    </div>
  )
}
