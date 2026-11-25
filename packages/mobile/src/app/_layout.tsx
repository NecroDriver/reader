import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SQLiteProvider } from 'expo-sqlite'
import { useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ThemeProvider, usePrefs } from '../theme'
import { THEMES } from '../types'
import { ensureSchema } from '../db'
import { migrateLegacyAccount } from '../storage'

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

/**
 * 无账号体系：mozhi.db 是唯一书库（空库起步）。未配对时首屏由 /pair 承接，
 * 配对同步后即使用桌面端的账户数据（书架/进度由桌面权威维护）。
 */
export default function RootLayout(): React.JSX.Element {
  useWindowDimensions() /* 触发旋转重排 */
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      await migrateLegacyAccount()
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!ready) return <BootScreen />

  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="mozhi.db" onInit={(db) => ensureSchema(db)}>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  )
}
