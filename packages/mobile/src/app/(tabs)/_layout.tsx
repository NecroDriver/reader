import { Tabs } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePrefs } from '../../theme'
import { THEMES, type ThemeDef } from '../../types'

/**
 * 主导航：iOS 式底部标签栏（书架 / 历史 / 设置）。
 * 图标沿用墨纸印章语言——单字阴文印（书/历/设），激活态朱砂。
 * 阅读器与配对页在 Tabs 之外（推入即整屏，标签栏自动隐藏）。
 */
const TAB_META: readonly { name: string; label: string; glyph: string }[] = [
  { name: 'index', label: '书架', glyph: '书' },
  { name: 'history', label: '历史', glyph: '历' },
  { name: 'settings', label: '设置', glyph: '设' }
]

function TabBar(props: {
  state: { index: number; routes: { key: string; name: string }[] }
  navigateToTab: (routeKey: string) => void
}): React.JSX.Element {
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]
  const insets = useSafeAreaInsets()
  const { state, navigateToTab } = props

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.line,
        paddingBottom: insets.bottom
      }}
    >
      {state.routes.map((route, i) => {
        const focused = state.index === i
        const meta = TAB_META.find((m) => m.name === route.name)
        if (!meta) return null
        return (
          <Pressable
            key={route.key}
            onPress={() => navigateToTab(route.key)}
            accessibilityRole="tab"
            accessibilityLabel={meta.label}
            accessibilityState={{ selected: focused }}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 7,
              minHeight: 48,
              opacity: focused ? 1 : 0.82
            }}
          >
            <Text
              style={{
                color: focused ? t.seal : t.muted,
                fontSize: 20,
                lineHeight: 24,
                fontFamily: 'serif',
                fontWeight: focused ? '700' : '400'
              }}
            >
              {meta.glyph}
            </Text>
            <Text
              style={{
                color: focused ? t.seal : t.muted,
                fontSize: 10,
                marginTop: 2,
                letterSpacing: 1
              }}
            >
              {meta.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="settings" />
    </Tabs>
  )
}
