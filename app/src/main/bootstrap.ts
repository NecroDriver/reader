import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * 数据目录引导：
 * mozhi.config.json 永远放在默认 userData 位置（不随重定向移动），
 * 其中 dataDir 指向用户自定义的数据目录（含 mozhi.db 与 Chromium 缓存）。
 * app ready 前读它并 app.setPath('userData', …)，db/缓存全部跟随。
 */

const CONFIG_NAME = 'mozhi.config.json'
const DB_NAME = 'mozhi.db'

/** 模块加载即缓存：任何 setPath 之前的原始默认 userData */
const ORIGINAL_USERDATA = app.getPath('userData')

/** 默认数据目录（dev 构建加 -dev 后缀，与正式版隔离） */
export function defaultDataDir(): string {
  return ORIGINAL_USERDATA + (app.isPackaged ? '' : '-dev')
}

interface BootstrapConfig {
  dataDir?: string
}

function configPath(): string {
  return join(defaultDataDir(), CONFIG_NAME)
}

function readConfig(): BootstrapConfig {
  try {
    let text = readFileSync(configPath(), 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) /* 剥 BOM */
    return JSON.parse(text) as BootstrapConfig
  } catch {
    return {}
  }
}

/** 把旧目录的数据库（含 WAL）拷到新目录——仅当新目录还没有库时 */
function migrateDb(from: string, to: string): void {
  if (existsSync(join(to, DB_NAME))) return
  for (const suffix of ['', '-wal', '-shm']) {
    const src = join(from, DB_NAME + suffix)
    if (existsSync(src)) copyFileSync(src, join(to, DB_NAME + suffix))
  }
}

/**
 * 在 app ready / 单实例锁之前调用：解析配置、迁移数据库、重定向 userData。
 * 自定义目录失效（被删/不可写）时自动落回默认目录。
 * MOZHI_DATA_DIR 环境变量优先级最高（自动化测试用，不做数据库迁移）。
 */
export function initUserData(): { effective: string; custom: string | null } {
  const base = defaultDataDir()
  const envDir = process.env['MOZHI_DATA_DIR']?.trim()
  const dataDir = envDir || readConfig().dataDir
  let effective = base
  let custom: string | null = null
  if (dataDir) {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
      if (!envDir) migrateDb(base, dataDir)
      app.setPath('userData', dataDir)
      effective = dataDir
      custom = dataDir
    } catch {
      /* 目录不可用：留在默认目录 */
    }
  }
  if (!custom && app.getPath('userData') !== base) {
    app.setPath('userData', base)
  }
  return { effective, custom }
}

export function getDataDirInfo(): { current: string; defaultDir: string; custom: string | null } {
  return {
    current: app.getPath('userData'),
    defaultDir: defaultDataDir(),
    custom: readConfig().dataDir ?? null
  }
}

/** 设置/清除自定义数据目录（写入引导配置；重启后生效） */
export function setCustomDataDir(dir: string | null): void {
  const cfg = readConfig()
  if (dir) cfg.dataDir = dir
  else delete cfg.dataDir
  mkdirSync(defaultDataDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
