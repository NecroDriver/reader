import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SQLiteProvider } from 'expo-sqlite'
import { useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ThemeProvider, usePrefs } from '../theme'
import { THEMES } from '../types'

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

export default function RootLayout(): React.JSX.Element {
  useWindowDimensions() /* 触发旋转重排 */
  return (
    <SafeAreaProvider>
      <SQLiteProvider
        databaseName="mozhi.db"
        assetSource={{ assetId: require('../../assets/mozhi.db') }}
      >
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  )
}
