import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useSQLiteContext } from 'expo-sqlite'
import { THEMES, type ThemeKey } from './types'
import { getSetting, setSetting } from './db'

interface ReaderPrefs {
  theme: ThemeKey
  setTheme: (t: ThemeKey) => void
  size: number
  setSize: (n: number) => void
  lh: number
  setLh: (n: number) => void
  ready: boolean
}

const Ctx = createContext<ReaderPrefs | null>(null)

const KEY_THEME = 'mobile_theme'
const KEY_SIZE = 'mobile_read_size'
const KEY_LH = 'mobile_read_lh'

export const MIN_SIZE = 14
export const MAX_SIZE = 26
const LH_CHOICES = [1.7, 1.9, 2.2]

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const db = useSQLiteContext()
  const [theme, setThemeState] = useState<ThemeKey>('paper')
  const [size, setSizeState] = useState(18)
  const [lh, setLhState] = useState(1.9)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const t = await getSetting(db, KEY_THEME)
        const s = await getSetting(db, KEY_SIZE)
        const l = await getSetting(db, KEY_LH)
        if (!alive) return
        if (t !== null && t in THEMES) setThemeState(t as ThemeKey)
        const sn = s !== null ? Number(s) : NaN
        if (Number.isFinite(sn) && sn >= MIN_SIZE && sn <= MAX_SIZE) setSizeState(sn)
        const ln = l !== null ? Number(l) : NaN
        if (Number.isFinite(ln) && LH_CHOICES.includes(ln)) setLhState(ln)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [db])

  const value: ReaderPrefs = {
    theme,
    size,
    lh,
    ready,
    setTheme: (t): void => {
      setThemeState(t)
      void setSetting(db, KEY_THEME, t)
    },
    setSize: (n): void => {
      const c = Math.min(MAX_SIZE, Math.max(MIN_SIZE, n))
      setSizeState(c)
      void setSetting(db, KEY_SIZE, String(c))
    },
    setLh: (n): void => {
      setLhState(n)
      void setSetting(db, KEY_LH, String(n))
    }
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs(): ReaderPrefs {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePrefs 必须在 ThemeProvider 内使用')
  return v
}

export { LH_CHOICES }
