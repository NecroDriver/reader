/** foliate-js view.js 的最小类型面（源码为无类型纯 JS，vendored） */
export interface FoliateTocNode {
  label?: string
  href?: string
  subitems?: FoliateTocNode[]
}
export interface FoliateRelocateDetail {
  fraction?: number
  tocItem?: { label?: string; href?: string } | null
  cfi?: string
}
export interface FoliateView extends HTMLElement {
  open(book: Blob | string): Promise<void>
  init(opts?: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(target: string): Promise<unknown>
  goToFraction(frac: number): Promise<void>
  prev(distance?: number): Promise<void>
  next(distance?: number): Promise<void>
  close(): void
  book: { toc?: FoliateTocNode[]; sections?: unknown[] }
  renderer: {
    setStyles(css: string): void
    setAttribute(name: string, value: string): unknown
  }
}
