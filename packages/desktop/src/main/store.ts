import { parseHTML } from 'linkedom'
import { fetchBuffer } from './novel'
import { decodeText } from './parsers'

/* ---------- 网上书城：按站点规则搜索（首站=速读谷） ----------
 * 每个站点一个 adapter：search(keyword) 返回结构化结果。
 * 抓正文/目录沿用 novel.ts 的通用管线，只有搜索是站点私有逻辑。
 */

export interface StoreResult {
  siteId: string
  siteName: string
  title: string
  author: string
  status: string
  category: string
  latestChapter: string
  tocUrl: string
  coverUrl: string
}

interface SiteAdapter {
  id: string
  name: string
  home: string
  search(keyword: string): Promise<StoreResult[]>
}

const cleanText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** 速读谷：GET /i/sor.aspx?key=（GBK 站，fetchBuffer+decodeText 处理编码） */
const suduguu: SiteAdapter = {
  id: 'suduguu',
  name: '速读谷',
  home: 'https://www.suduguu.com',
  async search(keyword: string): Promise<StoreResult[]> {
    const url = `${this.home}/i/sor.aspx?key=${encodeURIComponent(keyword)}`
    const html = decodeText(await fetchBuffer(url))
    const { document } = parseHTML(html)
    const out: StoreResult[] = []
    for (const item of Array.from(document.querySelectorAll('.item'))) {
      const el = item as HTMLElement
      const h3a = el.querySelector('.itemtxt h3 a') as HTMLAnchorElement | null
      if (!h3a) continue
      const title = cleanText(h3a.textContent)
      const href = h3a.getAttribute('href') ?? ''
      if (!title || !href || href === '/') continue
      const tocUrl = new URL(href, this.home).href
      const spans = Array.from(el.querySelectorAll('.itemtxt p span')).map((s) =>
        cleanText(s.textContent)
      )
      const authorA = el.querySelector('.itemtxt a[href*="/zuozhe/"]')
      const author = cleanText(authorA?.textContent).replace(/^作者[:：]?\s*/, '')
      const latest = el.querySelector('.itemtxt ul li a')
      const img = el.querySelector('img')
      const coverRaw = img?.getAttribute('src') ?? ''
      out.push({
        siteId: this.id,
        siteName: this.name,
        title,
        author,
        status: spans[0] ?? '',
        category: spans[1] ?? '',
        latestChapter: cleanText(latest?.textContent),
        tocUrl,
        coverUrl: coverRaw ? new URL(coverRaw, this.home).href : ''
      })
    }
    return out.slice(0, 30)
  }
}

const SITES: SiteAdapter[] = [suduguu]

export function listStoreSites(): { id: string; name: string; home: string }[] {
  return SITES.map(({ id, name, home }) => ({ id, name, home }))
}

export async function searchStore(siteId: string, keyword: string): Promise<StoreResult[]> {
  const kw = keyword.trim().replace(/\s+/g, ' ')
  if (!kw) return []
  const site = SITES.find((s) => s.id === siteId) ?? SITES[0]
  if (!site) return []
  return site.search(kw)
}
