/**
 * 本地图书解析：编码检测、txt 章节切分、广告过滤、md 分章。
 * 章节正则与过滤规则自原型 design/app.js 移植（已用 8.9MB 真书验证）。
 */

export interface ParsedChapter {
  idx: number
  title: string
  content: string // 段落以 \n 分隔（txt）；md 为原始文本
}

export interface ParsedBook {
  title: string
  author: string
  chapters: ParsedChapter[]
}

/** 章节标题行：第X[章节卷回部集话話]… / 序章 / 楔子 / 引子 / 尾声 / 终章 / 后记 / 番外 */
const CH_RE =
  /^\s*(第[0-9零〇一二三四五六七八九十百千万两]{1,12}[章节卷回部集话話](?:[\s:：、.．\-—·]{0,3}\S{0,26})?|序章|楔子|引子|尾声|终章|后记|番外)\s*$/

/** 全书生效的站点广告行（URL/域名/书站名/上传标记）——novel 章节抓取也复用 */
export const AD_SITE_RE =
  /https?:\/\/|www\.|[\w-]+\.(com|net|tw|cc|org|me)|爱下电子书|更多电子书|请访问|TXT下载|txt下载|用户上传之内容|本书来自|更多精彩小说/i
/** 仅开篇生效的广告行（含正文常见分隔线，避免误杀） */
const AD_OPEN_RE = new RegExp(
  `^[-=─━*·•]{5,}$|^[-=─━*·•]{4,}[^-=─━*·•]{1,30}[-=─━*·•]{4,}$|仅供欣赏|请支持正版|${AD_SITE_RE.source}`,
  'i'
)

export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gb18030').decode(buf)
  }
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/[_\-—|]?\s*txt免费下载.*$/i, '')
    .replace(/[_\-—|]?\s*免费下载.*$/i, '')
    .replace(/[(（]?\s*(全本|全集|完整版|精校版?|校对版?|无错版?)[)）]?.*$/i, '')
    .replace(/[(（[].*?(笔趣阁|顶点|飘天|书海|全文阅读|最新章节).*?[)）]\]/gi, '')
    .replace(/作者.*/, '')
    .replace(/\.(txt|md|epub|pdf)$/i, '')
    .trim()
}

/** 前 N 段里找「作者：XXX」 */
export function extractAuthor(paragraphs: string[], scan = 8): string {
  const re = /作者[:：]\s*([^\s『』〔〕\[\]\/，,。]{1,20})/
  for (const p of paragraphs.slice(0, scan)) {
    const m = p.match(re)
    if (m) return m[1].trim()
  }
  return ''
}

function isAdLine(line: string, openScope: boolean): boolean {
  if (openScope) return AD_OPEN_RE.test(line)
  return AD_SITE_RE.test(line)
}

/** 超长章按 400 段分页，避免单章 DOM 过大 */
const MAX_PARAS = 500
const SPLIT_PARAS = 400

export function parseTxt(fileName: string, text: string): ParsedBook {
  const lines = text.split(/\r?\n/)
  const title = cleanTitle(fileName)
  const chapters: ParsedChapter[] = []
  let cur: { title: string; paras: string[] } | null = null
  let openScope = true // 开篇内启用更严的广告过滤

  const flush = () => {
    if (!cur) return
    const cleaned = cur.paras.filter((p) => p && !isAdLine(p, openScope))
    if (cleaned.length > MAX_PARAS) {
      for (let i = 0; i < cleaned.length; i += SPLIT_PARAS) {
        const part = cleaned.slice(i, i + SPLIT_PARAS)
        const n = Math.floor(i / SPLIT_PARAS) + 1
        const total = Math.ceil(cleaned.length / SPLIT_PARAS)
        chapters.push({
          idx: chapters.length,
          title: total > 1 ? `${cur.title}（${n}/${total}）` : cur.title,
          content: part.join('\n')
        })
      }
    } else if (cleaned.length) {
      chapters.push({ idx: chapters.length, title: cur.title, content: cleaned.join('\n') })
    }
    openScope = false
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (line.length <= 40 && CH_RE.test(line)) {
      flush()
      cur = { title: line.replace(/\s+/g, ' ').trim(), paras: [] }
      continue
    }
    if (!line) continue
    if (!cur) cur = { title: '开篇', paras: [] }
    cur.paras.push(line)
  }
  flush()

  // 作者提取：扫描开篇与前几章首段
  const scanParas = (chapters[0]?.content ?? '').split('\n').slice(0, 8)
  const author =
    extractAuthor(scanParas) || extractAuthor((chapters[1]?.content ?? '').split('\n').slice(0, 4))

  return { title: title || '未命名', author, chapters }
}

/** md：按 1-3 级标题分章，无标题则整篇一章 */
export function parseMd(fileName: string, text: string): ParsedBook {
  const title = cleanTitle(fileName)
  const lines = text.split(/\r?\n/)
  const chapters: ParsedChapter[] = []
  let cur: { title: string; lines: string[] } = { title: title || '正文', lines: [] }

  const flush = () => {
    const content = cur.lines.join('\n').trim()
    if (content) {
      chapters.push({ idx: chapters.length, title: cur.title, content })
    }
  }

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/)
    if (m) {
      flush()
      cur = { title: m[2].trim(), lines: [] }
      continue
    }
    cur.lines.push(line)
  }
  flush()

  const author = extractAuthor(lines.slice(0, 8), 4)
  return { title: title || '未命名', author, chapters: chapters.length ? chapters : [{ idx: 0, title: title || '正文', content: text }] }
}

export function parseLocalFile(fileName: string, buf: Buffer): ParsedBook {
  if (/\.md$/i.test(fileName)) return parseMd(fileName, buf.length ? decodeText(buf) : '')
  return parseTxt(fileName, decodeText(buf))
}
