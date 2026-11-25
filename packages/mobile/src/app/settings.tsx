import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { SafeAreaView } from 'react-native-safe-area-context'
import Constants from 'expo-constants'
import { usePrefs } from '../theme'
import { THEMES, type ThemeDef } from '../types'
import { formatSyncResult, getPair, runSync, unpair, type LanPair, type SyncSummary } from '../lansync'
import { getDesktopOwner, loadLanCursors } from '../storage'

const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x: number): string => String(x).padStart(2, '0')
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function SettingsScreen(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]

  const [lanPair, setLanPair] = useState<LanPair | null>(null)
  const [owner, setOwner] = useState('')
  const [lanBusy, setLanBusy] = useState(false)
  const [lanMsg, setLanMsg] = useState('')
  const [lanErr, setLanErr] = useState('')
  const [lanLastAt, setLanLastAt] = useState<number | null>(null)
  const [confirmUnpair, setConfirmUnpair] = useState(false)

  useEffect(() => {
    void (async () => {
      setLanPair(await getPair())
      setOwner(await getDesktopOwner())
      const c = await loadLanCursors()
      setLanLastAt(c.lastSyncAt ?? null)
    })()
  }, [])

  async function doSyncNow(): Promise<void> {
    setLanErr('')
    setLanMsg('')
    setLanBusy(true)
    try {
      const r: SyncSummary = await runSync(db)
      setLanMsg(formatSyncResult(r))
      setLanLastAt(r.at)
      setOwner(await getDesktopOwner())
    } catch (e) {
      setLanErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLanBusy(false)
    }
  }

  async function doUnpair(): Promise<void> {
    await unpair()
    setConfirmUnpair(false)
    router.replace('/pair')
  }

  const s = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: t.bg },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingTop: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.line
    },
    headTitle: { fontSize: 20, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    back: { fontSize: 26, color: t.ink, paddingHorizontal: 4 },
    section: { marginTop: 22 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    aboutVersion: { fontSize: 13, color: t.ink, fontFamily: 'serif', marginTop: 2 },
    sectionSub: { fontSize: 12, color: t.muted, marginTop: 3, lineHeight: 18 },
    /* 书房 hero 卡 */
    hero: {
      borderWidth: 1,
      borderColor: t.lineStrong,
      borderRadius: 12,
      backgroundColor: t.surface,
      padding: 16,
      flexDirection: 'row',
      gap: 14,
      alignItems: 'center'
    },
    heroMark: {
      width: 52,
      height: 52,
      borderRadius: 8,
      backgroundColor: t.seal,
      alignItems: 'center',
      justifyContent: 'center'
    },
    heroMarkText: { color: t.sealFg, fontSize: 26, fontWeight: '700', fontFamily: 'serif' },
    heroBody: { flex: 1, minWidth: 0 },
    heroTitle: { fontSize: 17, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    heroSub: { fontSize: 12, color: t.muted, marginTop: 4 },
    heroStatus: { fontSize: 12, color: t.ink2, marginTop: 2 },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    btnPrimary: {
      backgroundColor: t.seal,
      borderRadius: 999,
      paddingVertical: 11,
      paddingHorizontal: 20,
      opacity: lanBusy ? 0.5 : 1
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: t.lineStrong,
      borderRadius: 999,
      paddingVertical: 11,
      paddingHorizontal: 20
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.sealFg, fontSize: 14, textAlign: 'center', fontWeight: '600' },
    btnTextGhost: { color: t.ink, fontSize: 14, textAlign: 'center' },
    heroNote: { fontSize: 12, color: t.muted, marginTop: 10, lineHeight: 17 },
    card: {
      borderWidth: 1,
      borderColor: t.seal,
      borderRadius: 12,
      backgroundColor: t.surface,
      padding: 14,
      marginTop: 12
    },
    cardAlert: { fontSize: 12.5, color: t.ink2, lineHeight: 18 },
    status: { fontSize: 12, color: t.muted, marginTop: 12, lineHeight: 17 }
  })

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
      <View style={s.head}>
        <Pressable onPress={() => router.back()} accessibilityLabel="返回">
          <Text style={s.back}>←</Text>
        </Pressable>
        <View>
          <Text style={s.headTitle}>设置</Text>
        </View>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={s.section}>
          <Text style={s.sectionTitle}>书房</Text>
          {lanPair === null ? (
            <View style={[s.hero, { borderColor: t.line, borderStyle: 'dashed' }]}>
              <View style={[s.heroMark, { backgroundColor: t.surface2 }]}>
                <Text style={{ ...s.heroMarkText, color: t.ink2 }}>墨</Text>
              </View>
              <View style={s.heroBody}>
                <Text style={s.heroTitle}>尚未与桌面端配对</Text>
                <Text style={s.heroSub}>书库由桌面端墨纸权威维护，配对后自动同步到手机</Text>
                <View style={s.btnRow}>
                  <Pressable
                    style={s.btnPrimary}
                    onPress={() => router.replace('/pair')}
                    accessibilityLabel="去配对"
                    accessibilityRole="button"
                  >
                    <Text style={s.btnText}>去配对</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: 12 }}>
              <View style={s.hero}>
                <View style={s.heroMark}>
                  <Text style={s.heroMarkText}>{(owner || '墨').slice(0, 1)}</Text>
                </View>
                <View style={s.heroBody}>
                  <Text style={s.heroTitle}>{owner ? `${owner} 的书房` : '桌面书房'}</Text>
                  <Text style={s.heroSub} numberOfLines={1}>
                    {lanPair.addr}
                    {lanLastAt !== null ? ` · 上次同步 ${fmtTime(lanLastAt)}` : ''}
                  </Text>
                  {lanBusy ? <Text style={s.heroStatus}>同步中…</Text> : null}
                </View>
              </View>
              <Text style={s.heroNote}>
                打开 App 会自动同步一次；阅读进度静默回传。书架与章节由桌面端权威维护。
              </Text>
              <View style={s.btnRow}>
                <Pressable
                  style={[s.btnPrimary, lanBusy ? s.btnDisabled : null]}
                  disabled={lanBusy}
                  onPress={() => void doSyncNow()}
                  accessibilityLabel="立即同步"
                  accessibilityRole="button"
                >
                  <Text style={s.btnText}>{lanBusy ? '同步中…' : '立即同步'}</Text>
                </Pressable>
                <Pressable
                  style={[s.btnGhost, confirmUnpair ? s.btnDisabled : null]}
                  disabled={confirmUnpair}
                  onPress={() => setConfirmUnpair(true)}
                  accessibilityLabel="断开配对"
                  accessibilityRole="button"
                >
                  <Text style={s.btnTextGhost}>断开配对</Text>
                </Pressable>
              </View>
              {confirmUnpair && (
                <View style={s.card}>
                  <Text style={s.cardAlert}>
                    断开后将不再自动同步；重新配对需在桌面端重新出示二维码。
                  </Text>
                  <View style={s.btnRow}>
                    <Pressable style={s.btnGhost} onPress={() => setConfirmUnpair(false)}>
                      <Text style={s.btnTextGhost}>取消</Text>
                    </Pressable>
                    <Pressable style={s.btnPrimary} onPress={() => void doUnpair()}>
                      <Text style={s.btnText}>确认断开</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {lanMsg !== '' ? <Text style={s.status}>{lanMsg}</Text> : null}
              {lanErr !== '' ? <Text style={[s.status, { color: t.seal }]}>{lanErr}</Text> : null}
            </View>
          )}
        </View>

        <View style={[s.section, { marginBottom: 40 }]}>
          <Text style={s.sectionTitle}>关于</Text>
          <Text style={s.aboutVersion}>墨纸移动端 v{APP_VERSION}</Text>
          <Text style={s.sectionSub}>
            阅读书架 · 局域网设备同步。与桌面端配对后离线全功能，阅读进度自动回传。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
