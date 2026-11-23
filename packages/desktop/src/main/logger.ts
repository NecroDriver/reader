/**
 * 运行文件日志：写入 userData/logs/mozhi.log（随自定义数据目录走）。
 * 超过 1MB 轮转为 mozhi.old.log（只保留一代），失败静默——日志绝不能影响主流程。
 */
import { app } from 'electron'
import { mkdirSync, renameSync, statSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1024 * 1024

export function getLogDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function getLogPath(): string {
  return join(getLogDir(), 'mozhi.log')
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 记一条：logEvent('sync', 'info', 'xx 拉取成功 +3') */
export function logEvent(scope: string, level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const dir = getLogDir()
    mkdirSync(dir, { recursive: true })
    const file = getLogPath()
    try {
      if (statSync(file).size > MAX_BYTES) {
        try {
          renameSync(file, join(dir, 'mozhi.old.log'))
        } catch {
          /* 轮转失败则继续追加 */
        }
      }
    } catch {
      /* 首次写入文件不存在 */
    }
    appendFileSync(file, `${stamp()} [${level.toUpperCase()}][${scope}] ${message}\n`, 'utf8')
  } catch {
    /* 日志失败静默 */
  }
}
