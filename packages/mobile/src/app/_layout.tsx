import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SQLiteProvider } from 'expo-sqlite'
import { useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ThemeProvider, usePrefs } from '../theme'
import { THEMES } from '../types'
import {
  createAccount,
  ensureSchema,
  GUEST_ACCOUNT,
  listAccounts,
  loginAccount,
  logoutAccount,
  startupSession,
  type AccountRec
} from '../accounts'
import { LoginScreen, type LoginResult } from '../LoginScreen'
import { SessionContext } from '../session'

function Shell(): React.JSX.Element {
  const { theme } = usePrefs()
  const t = THEMES[theme]
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <StatusBar style={theme === 'ink' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
          animation: 'fade'
        }}
      />
    </View>
  )
}

function BootScreen(): React.JSX.Element {
  return (
    <View style={{ flex: 1, backgroundColor: THEMES.paper.bg, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="dark" />
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 6,
          backgroundColor: THEMES.paper.seal,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <View accessibilityLiveRegion="polite" accessibilityLabel="墨纸启动中">
          <View
            style={{
              width: 34,
              height: 34,
              borderWidth: 2,
              borderColor: '#F5EFE3',
              borderRadius: 999
            }}
          />
        </View>
      </View>
    </View>
  )
}

type Phase = 'boot' | 'login' | 'ready'

function SessionGate(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('boot')
  const [accounts, setAccounts] = useState<AccountRec[]>([])
  const [account, setAccount] = useState<AccountRec | null>(null)
  const [lastUsedId, setLastUsedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const s = await startupSession()
      if (!alive) return
      if (s) {
        setAccount(s.account)
        setPhase('ready')
        return
      }
      const list = await listAccounts()
      if (!alive) return
      setAccounts(list)
      setLastUsedId(list[0]?.id ?? null)
      setPhase('login')
    })()
    return () => {
      alive = false
    }
  }, [])

  async function handleLogin(id: string, pwd: string, remember: boolean): Promise<LoginResult> {
    const r = await loginAccount(id, pwd, remember)
    if (r.ok) {
      setAccount(r.account)
      setPhase('ready')
    }
    return { ok: r.ok, error: r.ok ? undefined : r.error }
  }

  async function handleCreate(name: string, pwd: string, remember: boolean): Promise<LoginResult> {
    const r = await createAccount(name, pwd, remember)
    if (r.ok) {
      setAccount(r.account)
      setPhase('ready')
    }
    return { ok: r.ok, error: r.ok ? undefined : r.error }
  }

  function handleGuest(): void {
    setAccount(GUEST_ACCOUNT)
    setPhase('ready')
  }

  async function handleLogout(): Promise<void> {
    if (account?.id !== GUEST_ACCOUNT.id) await logoutAccount()
    setAccount(null)
    const list = await listAccounts()
    setAccounts(list)
    setLastUsedId(list[0]?.id ?? null)
    setPhase('login')
  }

  if (phase === 'boot') return <BootScreen />
  if (phase === 'login' || account === null) {
    return (
      <View style={{ flex: 1, backgroundColor: THEMES.paper.bg, paddingTop: 0 }}>
        <LoginScreen accounts={accounts} lastUsedId={lastUsedId} onLogin={handleLogin} onCreate={handleCreate} onGuest={handleGuest} />
      </View>
    )
  }

  const isGuest = account.id === GUEST_ACCOUNT.id
  /* 游客与演示库共用 mozhi.db：文件不存在时由 assetSource 播种演示书 */
  const withSeed = isGuest || account.dbName === 'mozhi.db'
  return (
    <SessionContext.Provider value={{ account, isGuest, logout: handleLogout }}>
      <SQLiteProvider
        key={account.dbName}
        databaseName={account.dbName}
        assetSource={withSeed ? { assetId: require('../../assets/mozhi.db') } : undefined}
        onInit={(db) => ensureSchema(db)}
      >
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SQLiteProvider>
    </SessionContext.Provider>
  )
}

export default function RootLayout(): React.JSX.Element {
  useWindowDimensions() /* 触发旋转重排 */
  return (
    <SafeAreaProvider>
      <SessionGate />
    </SafeAreaProvider>
  )
}
