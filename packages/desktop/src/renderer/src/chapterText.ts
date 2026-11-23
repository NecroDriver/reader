/**
 * 渲染层章文工具：章题首段去重 + 文本文件解码。
 * 与主进程 novel.ts 的 dropTitlePara / parsers.ts 的 decodeText 同规则（跨进程边界各持一份小实现）。
 */

/** 归一化：去掉全部空白后比较 */
const normPara = (s: string): string => s.replace(/\s+/g, '')

/**
 * 章题与正文首段重复判定（速读谷等站正文第一行重复章题）：
 * 完全一致，或章题以首段结尾（站点常剥掉「第X章」前缀只重复正题）。
 * 首段归一后不足 2 字不吞，防止误删正文。
 */
export function dropTitlePara(title: string, paras: string[]): string[] {
  if (paras.length === 0) return paras
  const t = normPara(title)
  const first = normPara(paras[0])
  if (!t || !first) return paras
  if (t === first || (first.length >= 2 && t.endsWith(first))) return paras.slice(1)
  return paras
}

/** 读文本文件：UTF-8 严格探测失败 → GBK/gb18030（与导入图书同策略） */
export async function decodeTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gb18030').decode(buf)
  }
}
