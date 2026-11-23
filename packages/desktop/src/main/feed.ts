import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface FeedItem {
  title: string
  url: string
  author: string
  publishedAt: string
  contentHtml: string
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_ITEMS = 20

/** 去掉入库正文中的危险/噪音内容（渲染层 CSP 兜底之外的第二道闸） */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

function decode(buf: ArrayBuffer): string {
  // RSS/Atom 基本都是 UTF-8；再兜底 gb18030
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gb18030').decode(buf)
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await net.fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MozhiReader/0.1 (personal RSS reader)',
      Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8'
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return decode(await res.arrayBuffer())
}

function fmtDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const now = new Date()
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

const xp = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true
})

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && '#text' in (v as Record<string, unknown>))
    return String((v as Record<string, unknown>)['#text'] ?? '')
  return ''
}

/** 裸 & 修复：真实站点 feed 常见未转义 &（如「A&B」），fast-xml-parser 会 readTagExp 报错 */
function repairAmp(xml: string): string {
  return xml.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;')
}

/** RSS 2.0 与 Atom 通吃；返回按发布时间倒序的条目 */
function parseFeedXml(xml: string): FeedItem[] {
  let doc: Record<string, any>
  try {
    doc = xp.parse(xml) as Record<string, any>
  } catch {
    // 常见坏 feed：未转义 & / 控制字符。修一版再试；再失败才向上抛
    const cleaned = repairAmp(xml.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))
    doc = xp.parse(cleaned) as Record<string, any>
  }
  const rssItems = doc?.rss?.channel?.item
  const atomEntries = doc?.feed?.entry
  const raw: any[] = Array.isArray(rssItems)
    ? rssItems
    : Array.isArray(atomEntries)
      ? atomEntries
      : rssItems || atomEntries
        ? [rssItems ?? atomEntries]
        : []

  const items: FeedItem[] = raw.slice(0, MAX_ITEMS).map((e: any) => {
    const url =
      text(e?.link) ||
      (Array.isArray(e?.link)
        ? text((e.link as any[]).find((l) => l?.['@_href'])?.['@_href'])
        : text(e?.link?.['@_href'])) ||
      text(e?.guid) ||
      ''
    const content =
      text(e?.['content:encoded']) || text(e?.encoded) || text(e?.content) || text(e?.description) || text(e?.summary) || ''
    const date = parseDate(e?.pubDate) ?? parseDate(e?.published) ?? parseDate(e?.updated)
    return {
      title: text(e?.title).trim() || '（无标题）',
      url: url.trim(),
      author: (text(e?.author?.name) || text(e?.author) || text(e?.['dc:creator']) || text(e?.creator) || '')
        .replace(/^[\w.+-]+@[\w.-]+\s*\(([^)]+)\)\s*$/, '$1')
        .trim(),
      publishedAt: date ? fmtDate(date) : '',
      contentHtml: sanitizeHtml(content)
    }
  })
  // 无日期的条目排后面
  return items
}

/** 网页源：整页 HTML → Readability 主正文 */
function extractReadable(html: string, baseUrl: string): FeedItem {
  const dom = parseHTML(html)
  const doc = dom.document
  const abs = (u: string): string => {
    try {
      return new URL(u, baseUrl).href
    } catch {
      return ''
    }
  }
  // Readability 只认 http(s)，相对 src/href 先转绝对
  const absolutize = (tag: string, htmlIn: string): string =>
    htmlIn.replace(
      new RegExp(`(\\s${tag}\\s*=\\s*)(["'])(?!https?:|data:|#)([^"']+)\\2`, 'gi'),
      (_m, pre: string, q: string, u: string) => `${pre}${q}${abs(u)}${q}`
    )
  const art = new Readability(doc).parse()
  const title = art?.title?.trim() || doc.title?.trim() || '（无标题）'
  const contentHtml = sanitizeHtml(absolutize('src', absolutize('href', art?.content ?? '')))
  return {
    title,
    url: baseUrl,
    author: art?.byline?.replace(/^by\s+/i, '').trim() ?? '',
    publishedAt: fmtDate(new Date()),
    contentHtml
  }
}

/** 拉取一个订阅源：rss → RSS/Atom 解析；web → Readability 抽正文 */
export async function fetchSource(url: string, type: string): Promise<FeedItem[]> {
  const body = await fetchText(url)
  if (type === 'web') return [extractReadable(body, url)]
  return parseFeedXml(body)
}
