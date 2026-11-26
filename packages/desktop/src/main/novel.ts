/**
 * 在线小说引擎：目录页解析 → 逐章限速抓取 → 成书（chapters 表）→ 增量更新 → 导出 txt
 * 阅读侧完全复用 TXT 管线（books.format='NOVEL'，正文在 chapters 表）。
 */
import { createHash, randomInt } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import iconv from 'iconv-lite'
import { net } from 'electron'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import { AD_SITE_RE, decodeText } from './parsers'

export interface TocChapter {
  url: string
  title: string
}

export interface TocParseResult {
  bookTitle: string
  author: string
  chapters: TocChapter[]
  /** 目录页 og:novel:image / og:image 封面（绝对 https 地址，可能缺） */
  coverUrl?: string
}

/** 章节链接文本判定（比 CH_RE 宽：目录页允许更长标题） */
const CH_LINK_RE =
  /^\s*(第[0-9零〇一二三四五六七八九十百千万两]{1,12}[章节卷回部集话話](?:[\s:：、.．\-—·]{0,3}\S{0,30})?|序章|楔子|引子|尾声|终章|后记|番外\S{0,24}|chapter\s*\d+|第\s*\d+\s*话)\s*$/i

/** 目录页 CTA 按钮文案（「开始阅读」等按钮与真实章链同 URL，先出现会把真章名挤掉） */
const TOC_CTA_RE =
  /^(开始阅读|立即阅读|从头阅读|免费阅读|在线阅读|点击阅读|继续阅读|进入阅读|阅读全文|开始|阅读)$/

export function fetchBuffer(url: string, timeoutMs = 20000): Promise<Buffer> {
  return net
    .fetch(url, {
      headers: { 'User-Agent': MOZHI_UA, Referer: new URL(url).origin },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store' as RequestCache // 抓取/增量更新必须拿新鲜页面（Chromium 磁盘缓存会返回旧正文）
    })
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    })
}

export const MOZHI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 MozhiReader/0.1'

/** 剥 HTML 实体与空白 */
function cleanText(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析目录页 → 章节列表。通用启发式：
 * ① 文本命中章节模式的同域链接 ≥10 且占有效链接 ≥30% → 直接取命中集
 * ② 否则取「包含链接最多的公共父容器」的直系链接（纯标题型目录）
 */
export function parseTocHtml(html: string, baseUrl: string): TocParseResult {
  const { document } = parseHTML(html)
  const origin = new URL(baseUrl).origin
  const seen = new Set<string>()
  const all: TocChapter[] = []
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue
    let abs: URL
    try {
      abs = new URL(href, baseUrl)
    } catch {
      continue
    }
    if (abs.origin !== origin) continue
    const text = cleanText((a as HTMLAnchorElement).textContent ?? '')
    if (text.length < 2 || text.length > 64) continue
    if (TOC_CTA_RE.test(text)) continue
    if (seen.has(abs.href)) {
      // 同 URL 再次出现且新标题更像章名（旧的是标签文案）→ 升级标题
      const prev = all.find((c) => c.url === abs.href)
      if (prev && !CH_LINK_RE.test(prev.title) && CH_LINK_RE.test(text)) prev.title = text
      continue
    }
    seen.add(abs.href)
    all.push({ url: abs.href, title: text })
  }

  let chapters: TocChapter[] = []
  const hit = all.filter((c) => CH_LINK_RE.test(c.title))
  if (hit.length >= 10 && hit.length >= all.length * 0.3) {
    chapters = hit
  } else if (all.length >= 10) {
    // 父容器聚合：链接最多的父节点
    const counts = new Map<Element, number>()
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const p = (a as HTMLAnchorElement).parentElement
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    let best: Element | null = null
    let bestN = 0
    for (const [el, n] of counts) if (n > bestN) ((best = el), (bestN = n))
    if (best && bestN >= 10) {
      const hrefSet = new Set(all.map((c) => c.url))
      chapters = Array.from(best.querySelectorAll('a[href]'))
        .map((a) => {
          try {
            const u = new URL((a as HTMLAnchorElement).getAttribute('href') ?? '', baseUrl)
            return u.href
          } catch {
            return ''
          }
        })
        .filter((u) => hrefSet.has(u))
        .map((u) => all.find((c) => c.url === u) as TocChapter)
        .filter(Boolean)
    }
  }

  // 封面：og:novel:image 优先（小说站点标准），回退 og:image；仅收 https
  let coverUrl = ''
  const ogCover =
    document.querySelector('meta[property="og:novel:image"]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:image"]')?.getAttribute('content') ??
    ''
  if (ogCover) {
    try {
      const cu = new URL(ogCover, baseUrl)
      if (cu.protocol === 'https:') coverUrl = cu.href
    } catch {
      /* 无效封面地址 → 忽略 */
    }
  }

  // 书名/作者：优先 h1（目录页通常有书名标题）；否则 title 分段取「最长且不像站名」的段
  let bookTitle = ''
  let author = ''
  const SITE_WORD_RE =
    /(小说|阅读|文学|书城|小说网|阅读网|正版|免费|下载|首页|目录|最新章节|全文目录|全文阅读|电子书|万字|\bwww\.|\.(com|net|org)\b)/i
  // 剥「454.9万字」这类数字字数前缀（站点标题污染）
  const stripWordCount = (s: string): string => s.replace(/^[\d.,，\s]+[亿万]?万?字?/, '').trim()
  const rawTitle = cleanText(document.querySelector('title')?.textContent ?? '')
  const h1 = stripWordCount(cleanText(document.querySelector('h1')?.textContent ?? ''))
  if (h1.length >= 2 && h1.length <= 20 && !SITE_WORD_RE.test(h1)) {
    bookTitle = h1
  } else {
    const segs = rawTitle
      .split(/[_\-|·»]/)
      .map((s) => stripWordCount(cleanText(s)))
      .filter((s) => s.length >= 2)
    const good = segs.filter((s) => !SITE_WORD_RE.test(s))
    bookTitle = (good.length ? good : segs).sort((a, b) => b.length - a.length)[0] || h1 || '未命名小说'
  }
  const authorMatch = html.match(/作者[:：\s]*<\/?[^>]*>?([\u4e00-\u9fa5A-Za-z0-9·]{2,16})/)
  if (authorMatch) author = authorMatch[1]
  if (!author) {
    const body = cleanText(document.body?.textContent?.slice(0, 4000) ?? '')
    const m2 = body.match(/作者[:：\s]*([\u4e00-\u9fa5A-Za-z0-9·]{2,16})/)
    if (m2) author = m2[1]
  }
  // 作者名截断：站点 meta 常把「作者：飞天鱼 更新时间…」连排（无空白分隔）
  author = author
    .replace(/(更新时间|最新章节?|最新三章节|最后更新|发表时间|状态|分类|字数|点击|推荐|收藏|入库|连载|完结|授权|签约|来源|责编).*/,'')
    .slice(0, 16)
  return { bookTitle, author, chapters: orderChapters(chapters), coverUrl: coverUrl || undefined }
}

/* ---------- 目录排序 ---------- */

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

/** 「第一千三百三十一章 太阴南教的教主」→ 1331；非第X章式标题返回 null */
export function parseChNum(title: string): number | null {
  const m = title.match(/第\s*([0-9零〇一二三四五六七八九十百千万两]+)\s*[章节卷回部集话話]/)
  if (!m) return null
  const s = m[1]
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10)
  // 中文数字：十/百/千乘数累加，万/亿段位重置
  let total = 0
  let section = 0
  let digit: number | null = null
  for (const ch of s) {
    if (ch === '零' || ch === '〇') continue
    const d = CN_DIGIT[ch]
    if (d !== undefined) {
      digit = d
    } else if (ch === '十' || ch === '百' || ch === '千') {
      const mul = ch === '十' ? 10 : ch === '百' ? 100 : 1000
      section += (digit ?? 1) * mul
      digit = null
    } else if (ch === '万' || ch === '亿') {
      const mul = ch === '万' ? 10000 : 100000000
      total = (total + section + (digit ?? 0)) * mul
      section = 0
      digit = null
    } else {
      return null
    }
  }
  return total + section + (digit ?? 0)
}

/**
 * 目录排序修复（「最新章节」预览块导致头部乱序）：
 * ① 前缀去重：头部若干条 URL 在其后方再次出现 → 是预览块，删掉前缀（最多 8 条）
 * ② 数字排序：≥90% 章节标题可解析出第N章 → 按章号稳定升序
 */
export function orderChapters(chapters: TocChapter[]): TocChapter[] {
  if (chapters.length < 10) return chapters
  let list = [...chapters]
  for (let i = 0; i < 8 && list.length > 1; i++) {
    const again = list.findIndex((c, j) => j > 0 && c.url === list[0].url)
    if (again > 0) list = list.slice(1)
    else break
  }
  const nums = list.map((c) => parseChNum(c.title))
  const ok = nums.filter((n) => n !== null).length
  if (ok >= list.length * 0.9) {
    // 不可解析的（番外/序章等）向前填充为 前一章+0.5，保持与相邻章的相对位置
    const filled: number[] = []
    let last = 0
    for (const n of nums) {
      if (n === null) {
        filled.push(last + 0.5)
      } else {
        filled.push(n)
        last = n
      }
    }
    const idx = list.map((c, i) => ({ c, i, n: filled[i] }))
    idx.sort((a, b) => a.n - b.n || a.i - b.i)
    list = idx.map((e) => e.c)
  }
  return list
}

/** 目录分页：找「下一页」链接（全文目录常每页只列 N 章） */
export function parseNextTocUrl(html: string, baseUrl: string): string | null {
  const { document } = parseHTML(html)
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const el = a as HTMLAnchorElement
    const text = cleanText(el.textContent ?? '')
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    if (!/^(下一页|下页|下 一 页|next\s*»?|»+|⋙)$/.test(text) && rel !== 'next') continue
    const href = el.getAttribute('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue
    try {
      const u = new URL(href, baseUrl)
      if (u.href === baseUrl) continue
      return u.href
    } catch {
      /* ignore */
    }
  }
  return null
}

/** 多页目录抓取：首页解析书名/作者 + 逐页收集章节（≤30 页，每页须新增 ≥5 章） */
export async function parseTocPages(startUrl: string): Promise<TocParseResult> {
  let first: TocParseResult | null = null
  const chapters: TocChapter[] = []
  const seen = new Set<string>()
  let url: string | null = startUrl
  let raw = ''
  for (let page = 0; page < 30 && url; page++) {
    const buf = await fetchBuffer(url)
    const html = decodeText(buf)
    raw = html
    const toc = parseTocHtml(html, url)
    if (!first) first = toc
    let added = 0
    for (const c of toc.chapters) {
      if (!seen.has(c.url)) {
        seen.add(c.url)
        chapters.push(c)
        added++
      }
    }
    if (added < 5) break // 翻页没有新章节 → 不是真分页或到底了
    url = parseNextTocUrl(html, url)
  }
  if (!first) {
    // 首页都抓不到时（理论上 fetchBuffer 已抛错），兜底空解析避免崩
    first = parseTocHtml(raw || '<html></html>', startUrl)
  }
  // 多页合并后必须整体重排：各页排序结果按「到达顺序」拼接仍是乱序
  return {
    bookTitle: first.bookTitle,
    author: first.author,
    chapters: orderChapters(chapters),
    coverUrl: first.coverUrl
  }
}

/* ---------- 章内分页（一页一章的站点会把长章拆成 -1/-2/-3… 多页） ---------- */

/** 「下一页」链接文本（目录分页同款，但要求不混入「下一章」语义） */
const PAGE_NEXT_TEXT_RE = /^(下一页|下页|下 一 页|next\s*»?|»+|⋙)$/i

/** URL → { key（去掉页号的基名）, page }：末段去扩展名后剥 `-\d+`；`/6/4349488.html`→(key=…/4349488, page=1)；`-2.html`→(同 key, 2)；`?page=2` 同理 */
function pageNumParts(rawUrl: string): { key: string; page: number } | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  // 查询串形态：?page=2 / ?p=2
  const q = u.searchParams.get('page') ?? u.searchParams.get('p')
  if (q && /^\d+$/.test(q)) return { key: u.origin + u.pathname, page: Number(q) }
  const seg = u.pathname.split('/').pop() ?? ''
  if (!seg) return null
  const noExt = seg.replace(/\.[a-z0-9]+$/i, '')
  const dir = u.pathname.slice(0, u.pathname.length - seg.length)
  const m = noExt.match(/^(.+?)[-_](\d+)$/)
  if (m) return { key: u.origin + dir + m[1], page: Number(m[2]) }
  return { key: u.origin + dir + noExt, page: 1 }
}

/**
 * 章内下一页：文本=「下一页」且目标与当前 URL 同基名、页号恰好 +1。
 * 若传入全书目录（chapterUrls），落在其内的链接一律视为「下一章」拒绝——
 * 防「章节文件名本身是 base_N.html」型站点把相邻章误当分页吞并。
 */
export function parseNextChapterPageUrl(html: string, baseUrl: string, chapterUrls?: Set<string>): string | null {
  const cur = pageNumParts(baseUrl)
  if (!cur) return null
  const { document } = parseHTML(html)
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const el = a as HTMLAnchorElement
    const text = cleanText(el.textContent ?? '')
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    if (!PAGE_NEXT_TEXT_RE.test(text) && rel !== 'next') continue
    if (/[章节卷篇回]|尾页|末页/.test(text)) continue
    const href = el.getAttribute('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue
    let u: URL
    try {
      u = new URL(href, baseUrl)
    } catch {
      continue
    }
    if (u.href === baseUrl) continue
    if (chapterUrls?.has(u.href)) continue
    const nxt = pageNumParts(u.href)
    if (!nxt || nxt.key !== cur.key || nxt.page !== cur.page + 1 || nxt.page > 999) continue
    return u.href
  }
  return null
}

/** 抓单章正文（自动跟随章内分页，≤30 页；首页失败照旧抛错，后续页失败静默止步） */
export async function fetchChapterParagraphs(url: string, chapterUrls?: Set<string>): Promise<string[]> {
  const all: string[] = []
  let cur: string | null = url
  for (let page = 0; page < 30 && cur; page++) {
    let html: string
    try {
      const buf = await fetchBuffer(cur)
      html = decodeText(buf)
    } catch (e) {
      if (page === 0) throw e
      break // 后续页抓失败：保留已抓部分，不把整章作废
    }
    const paras = extractParagraphs(html)
    if (paras.length === 0 && page === 0) throw new Error('empty chapter')
    all.push(...paras)
    cur = parseNextChapterPageUrl(html, cur, chapterUrls)
  }
  return all
}

/** 单页 HTML → 正文段落（Readability → br/块级转行 → 段落清洗） */
const JUNK_LINE_RE = /^(?:\(?\s*本章完\s*\)?|（\s*本章完\s*）|最快更新.*|\d{4}-\d{2}-\d{2}\s*(?:作者|更新)[:：]?.*)$/
function extractParagraphs(html: string): string[] {
  const { document } = parseHTML(html)
  let inner = ''
  try {
    const art = new Readability(document.cloneNode(true) as Document).parse()
    inner = art?.content ?? ''
  } catch {
    inner = ''
  }
  if (!inner) inner = (document.querySelector('article, .content, #content, .txt, #txt') as HTMLElement)?.innerHTML ?? ''
  // 关键：先把 <br> / 块级结束标签转成换行，再做纯文本提取。
  // 只取 textContent 时 <br> 不产生 \n（速读谷等站正文全部挤成一段的根因）。
  inner = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article)>/gi, '\n')
  const { document: d2 } = parseHTML(`<div>${inner}</div>`)
  const text = (d2.querySelector('div') as HTMLElement)?.textContent ?? ''
  return text
    .split(/\r?\n+/)
    .map((p: string) => p.replace(/\s+/g, ' ').trim())
    .filter((p: string) => p.length > 0 && !AD_SITE_RE.test(p) && !JUNK_LINE_RE.test(p))
}

export function paragraphsToContent(paras: string[]): string {
  return paras.join('\n')
}

/** 章题与正文首段重复判定：完全一致，或章题以首段结尾（站点常剥掉「第X章」前缀只重复正题）。
 *  归一比较会剥省略号（69shuba 章题「…练习中（4k）」正文首段「…练习中……（4k）」）。 */
const normPara = (s: string): string => s.replace(/[\s…‧·]/g, '')

export function dropTitlePara(title: string, paras: string[]): string[] {
  if (paras.length === 0) return paras
  const t = normPara(title)
  const first = normPara(paras[0])
  if (!t || !first) return paras
  if (t === first || (first.length >= 2 && t.endsWith(first))) return paras.slice(1)
  return paras
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 限速间隔：1.5-3s 随机 */
export function crawlDelay(): Promise<void> {
  return sleep(randomInt(1500, 3000))
}

export function contentHash(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

/** 导出 txt：GBK 用 iconv-lite，UTF-8 带 BOM（记事本友好） */
export function writeTxtFile(path: string, text: string, encoding: 'utf-8' | 'gbk'): void {
  if (encoding === 'gbk') {
    writeFileSync(path, iconv.encode(text, 'gbk'))
  } else {
    writeFileSync(path, '\ufeff' + text, 'utf-8')
  }
}

/** 章节标题规整（去掉目录链接里常见的前缀符号） */
export function normalizeChapterTitle(t: string): string {
  return cleanText(t).replace(/^[>»›\s]+/, '')
}
