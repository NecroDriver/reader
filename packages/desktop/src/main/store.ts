import { parseHTML } from 'linkedom'
import iconv from 'iconv-lite'
import { fetchBuffer } from './novel'
import { decodeText } from './parsers'

/* ---------- 网上书城：按站点规则搜索（速读谷 / 69书吧） ----------
 * 每个站点一个 adapter：
 *  - searchable=true：search(keyword) 直连返回结构化结果（速读谷）。
 *  - searchable=false：搜索接口有人机验证（69书吧 search.php 被 Cloudflare Turnstile 拦，
 *    Electron 内 widget 不渲染、token 永不下发）——改走「浏览器搜索 + 粘贴目录页链接解析」：
 *    parseBookUrl(url) 落地页 og:novel 元数据 → 同一结果卡入架。
 * 抓正文/目录沿用 novel.ts 的通用管线，只有搜索/链接解析是站点私有逻辑。
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
  /** 应用内直连搜索可用（速读谷）；false=浏览器辅助模式 */
  searchable: boolean
  search?(keyword: string): Promise<StoreResult[]>
  /** 浏览器辅助模式：粘贴目录页/落地页链接 → 解析成结果卡 */
  parseBookUrl?(url: string): Promise<StoreResult>
  /** 浏览器辅助模式：带关键词打开站点搜索页（GBK 查询串编码） */
  searchOpenUrl?(keyword: string): string
}

const cleanText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** 中文关键词 → GBK 百分号编码（69书吧等 GBK 站的查询串） */
export function gbkUrlEncode(s: string): string {
  const bytes = iconv.encode(s, 'gbk')
  let out = ''
  for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
  return out
}

/** 速读谷：GET /i/sor.aspx?key=（GBK 站，fetchBuffer+decodeText 处理编码） */
const suduguu: SiteAdapter = {
  id: 'suduguu',
  name: '速读谷',
  home: 'https://www.suduguu.com',
  searchable: true,
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

/** 69书吧：全站只有 search.php 有 Turnstile 门，书页/目录/章节直连可用。
 *  parseBookUrl 接受落地页 /book/<id>.htm 或目录页 /book/<id>/，一律归一到目录页。 */
const shuba69: SiteAdapter = {
  id: '69shuba',
  name: '69书吧',
  home: 'https://www.69shuba.com',
  searchable: false,
  searchOpenUrl(keyword: string): string {
    const kw = keyword.trim()
    return kw
      ? `${this.home}/modules/article/search.php?searchkey=${gbkUrlEncode(kw)}`
      : `${this.home}/modules/article/search.php`
  },
  async parseBookUrl(url: string): Promise<StoreResult> {
    const u = url.trim()
    const m = /^https?:\/\/(?:www\.)?69shuba\.com\/book\/(\d+)(?:\.html?|\/)?/i.exec(u)
    if (!m) throw new Error('不是 69书吧 的书目链接（形如 https://www.69shuba.com/book/90442/）')
    const bookId = m[1]
    const tocUrl = `${this.home}/book/${bookId}/`
    // 落地页 og:novel 元数据（无门）
    const html = decodeText(await fetchBuffer(`${this.home}/book/${bookId}.htm`))
    const { document } = parseHTML(html)
    const meta = (name: string): string =>
      cleanText(document.querySelector(`meta[property="${name}"]`)?.getAttribute('content'))
    const title = meta('og:novel:book_name')
    if (!title) throw new Error('书目信息解析失败，请确认链接指向 69书吧 的书页')
    return {
      siteId: this.id,
      siteName: this.name,
      title,
      author: meta('og:novel:author'),
      status: meta('og:novel:status') === '连载中' ? '连载中' : meta('og:novel:status') || '完结',
      category: meta('og:novel:category'),
      latestChapter: meta('og:novel:latest_chapter_name'),
      tocUrl,
      coverUrl: meta('og:image')
    }
  }
}

const SITES: SiteAdapter[] = [suduguu, shuba69]

export function listStoreSites(): { id: string; name: string; home: string; searchable: boolean }[] {
  return SITES.map(({ id, name, home, searchable }) => ({ id, name, home, searchable }))
}

export async function searchStore(siteId: string, keyword: string): Promise<StoreResult[]> {
  const kw = keyword.trim().replace(/\s+/g, ' ')
  if (!kw) return []
  const site = SITES.find((s) => s.id === siteId) ?? SITES[0]
  if (!site?.search) return []
  return site.search(kw)
}

/** 浏览器辅助模式：粘贴链接解析成结果卡 */
export async function parseStoreBookUrl(siteId: string, url: string): Promise<StoreResult> {
  const site = SITES.find((s) => s.id === siteId)
  if (!site?.parseBookUrl) throw new Error('该站点不支持链接解析')
  return site.parseBookUrl(url)
}

/** 浏览器辅助模式：生成站点搜索页 URL（应用外浏览器打开） */
export function storeSearchOpenUrl(siteId: string, keyword: string): string {
  const site = SITES.find((s) => s.id === siteId)
  if (!site?.searchOpenUrl) throw new Error('该站点支持应用内搜索')
  return site.searchOpenUrl(keyword)
}
