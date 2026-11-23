import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, ipcMain } from 'electron'
import { join } from 'node:path'
import { getSetting, setSetting } from './db'
import { pullAllSources } from './sync'
import { bossKeyState } from './boss'

let tray: Tray | null = null
let quitting = false

/** 设置「正在退出」标志：close 事件不再拦截 */
export function markQuitting(): void {
  quitting = true
}

/** 读布尔设置（'1'/'0'），带默认值 */
export function boolSetting(key: string, dflt: boolean): boolean {
  const v = getSetting(key)
  if (v === undefined) return dflt
  return v === '1'
}

function iconPath(): string {
  // dev：resources 在工程根；打包后：resources 目录随 NSIS 安装
  return join(__dirname, '../../resources/tray.png')
}

export function createTray(getWin: () => BrowserWindow | null): void {
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')) : image)
  tray.setToolTip('墨纸 Mozhi Reader')

  const showWin = (): void => {
    const win = getWin()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const menu = Menu.buildFromTemplate([
    { label: '打开墨纸', click: showWin },
    {
      label: '立即拉取全部',
      click: () => {
        void (async () => {
          const results = await pullAllSources()
          const added = results.filter((r) => r.ok).reduce((n, r) => n + r.added, 0)
          const pad = (n: number): string => String(n).padStart(2, '0')
          const d = new Date()
          setSetting('last_sync_at', `${pad(d.getHours())}:${pad(d.getMinutes())}`)
          const win = getWin()
          if (win && !win.isDestroyed()) {
            win.webContents.send('shelf:changed')
            new Notification({ title: '墨纸 · 拉取完成', body: `新增 ${added} 篇文章` }).show()
          }
        })()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', showWin)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** 探针/测试用：托盘是否已创建 */
export function getTray(): Tray | null {
  return tray
}

/** 窗口 close 拦截：按设置最小化到托盘 */
export function bindCloseToTray(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || !boolSetting('close_to_tray', true)) return
    e.preventDefault()
    win.hide()
  })
}

/** 通知设置读写：写 autostart 时同步系统注册表 */
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:getAll', () => ({
    autostart: app.getLoginItemSettings().openAtLogin,
    closeToTray: boolSetting('close_to_tray', true),
    pullOnStart: boolSetting('pull_on_start', true),
    bossKey: bossKeyState.key,
    bossKeyCustom: bossKeyState.custom
  }))
  ipcMain.handle('settings:set', (_e, key: string, value: boolean) => {
    setSetting(key, value ? '1' : '0')
    if (key === 'autostart') {
      app.setLoginItemSettings({ openAtLogin: value })
    }
  })
}
