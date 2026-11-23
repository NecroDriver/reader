import { BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { getSetting, setSetting } from './db'

/** 老板键状态：实际生效快捷键 + 是否用户自定义（false=自动回退链选中） */
export const bossKeyState = { key: '', custom: false }

/** 无自定义时的回退链：被占用自动降级 */
const FALLBACKS = ['CommandOrControl+Shift+M', 'CommandOrControl+Alt+M', 'CommandOrControl+Shift+H']

function toggleWindow(getWin: () => BrowserWindow | null): void {
  const w = getWin()
  if (!w) return
  if (w.isVisible() && w.isFocused()) {
    w.hide()
  } else {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
}

function tryRegister(accel: string, getWin: () => BrowserWindow | null): boolean {
  if (globalShortcut.isRegistered(accel)) return false
  try {
    if (!globalShortcut.register(accel, () => toggleWindow(getWin))) return false
  } catch {
    return false
  }
  return true
}

function unregisterAll(): void {
  try {
    globalShortcut.unregister(FALLBACKS[0])
    globalShortcut.unregister(FALLBACKS[1])
    globalShortcut.unregister(FALLBACKS[2])
  } catch {
    /* 未注册过时忽略 */
  }
}

/**
 * 应用老板键。
 * customKey 非空：只尝试该键，成功=自定义生效；失败=保持原键不变（返回 false）。
 * customKey 空/undefined：走回退链，第一个可用键生效（custom=false）。
 */
export function applyBossKey(
  getWin: () => BrowserWindow | null,
  customKey?: string
): { key: string; custom: boolean; ok: boolean } {
  const prevKey = bossKeyState.key
  if (customKey) {
    if (customKey === prevKey) return { key: prevKey, custom: bossKeyState.custom, ok: true }
    // 先注销全部候选，保证目标键可测
    unregisterAll()
    if (!tryRegister(customKey, getWin)) {
      // 失败：回滚到原键
      if (prevKey) tryRegister(prevKey, getWin)
      return { key: bossKeyState.key, custom: bossKeyState.custom, ok: false }
    }
    bossKeyState.key = customKey
    bossKeyState.custom = true
    return { key: customKey, custom: true, ok: true }
  }
  unregisterAll()
  for (const k of FALLBACKS) {
    if (tryRegister(k, getWin)) {
      bossKeyState.key = k
      bossKeyState.custom = false
      return { key: k, custom: false, ok: true }
    }
  }
  bossKeyState.key = ''
  bossKeyState.custom = false
  return { key: '', custom: false, ok: false }
}

/** 启动时应用：优先用户自定义键（存 settings 表 boss_key） */
export function initBossKey(getWin: () => BrowserWindow | null): void {
  const saved = getSetting('boss_key') ?? ''
  const r = applyBossKey(getWin, saved || undefined)
  console.log('[main] boss key:', r.key || 'none', r.custom ? '(custom)' : '(auto)', r.ok ? 'ok' : 'fail')
}

export function registerBossIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('boss:setKey', (_e, accel: string) => {
    if (typeof accel !== 'string' || !accel) return { ok: false, key: bossKeyState.key, custom: bossKeyState.custom }
    const r = applyBossKey(getWin, accel)
    if (r.ok) setSetting('boss_key', accel)
    return r
  })
  ipcMain.handle('boss:resetKey', () => {
    setSetting('boss_key', '')
    return applyBossKey(getWin, undefined)
  })
}
