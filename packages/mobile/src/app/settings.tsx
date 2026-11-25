import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import Constants from 'expo-constants'
import { usePrefs } from '../theme'
import { THEMES, type ThemeDef } from '../types'
import { useSession } from '../session'
import {
  formatSyncResult,
  getPair,
  pairManual,
  pairFromQr,
  runSync,
  unpair,
  type LanPair
} from '../lansync'
import { loadLanCursors } from '../storage'

const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function SettingsScreen(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]
  const session = useSession()

  /* LAN 设备同步 */
  const [lanPair, setLanPair] = useState<LanPair | null>(null)
  const [lanBusy, setLanBusy] = useState(false)
  const [lanMsg, setLanMsg] = useState('')
  const [lanErr, setLanErr] = useState('')
  const [lanAddr, setLanAddr] = useState('')
  const [lanCode, setLanCode] = useState('')
  const [lanName, setLanName] = useState('我的手机')
  const [scanOn, setScanOn] = useState(false)
  const [lanLastAt, setLanLastAt] = useState<number | null>(null)
  const [confirmUnpair, setConfirmUnpair] = useState(false)

  useEffect(() => {
    void (async () => {
      setLanPair(await getPair())
      const c = await loadLanCursors()
      setLanLastAt(c.lastSyncAt ?? null)
    })()
  }, [db])

  async function doPairManual(): Promise<void> {
    setLanErr('')
    setLanBusy(true)
    try {
      const p = await pairManual(lanAddr, lanCode, lanName)
      setLanPair(p)
      setLanMsg('配对成功，正在首次同步…')
      const r = await runSync(db)
      setLanMsg(formatSyncResult(r))
      setLanLastAt(r.at)
    } catch (e) {
      setLanErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLanBusy(false)
      setScanOn(false)
    }
  }

  async function doSyncNow(): Promise<void> {
    setLanErr('')
    setLanMsg('')
    setLanBusy(true)
    try {
      const r = await runSync(db)
      setLanMsg(formatSyncResult(r))
      setLanLastAt(r.at)
    } catch (e) {
      setLanErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLanBusy(false)
    }
  }

  async function doUnpair(): Promise<void> {
    await unpair()
    setLanPair(null)
    setConfirmUnpair(false)
    setLanMsg('')
    setLanErr('')
  }

  const s = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: t.bg },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingTop: 8, maxWidth: 640, width: '100%', alignSelf: 'center' },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.line
    },
    headTitle: { fontSize: 20, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    eyebrow: { fontSize: 10, letterSpacing: 2, color: t.seal, marginTop: 2 },
    back: { fontSize: 26, color: t.ink, paddingHorizontal: 4 },
    section: { marginTop: 26 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    aboutVersion: { fontSize: 13, color: t.ink, fontFamily: 'serif', marginTop: 2 },
    sectionSub: { fontSize: 12, color: t.muted, marginTop: 3, marginBottom: 12, lineHeight: 18 },
    label: { fontSize: 12.5, color: t.ink2, marginTop: 12, marginBottom: 5 },
    input: {
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
      color: t.ink,
      backgroundColor: t.surface
    },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    btnPrimary: {
      backgroundColor: t.seal,
      borderRadius: 8,
      paddingVertical: 11,
      paddingHorizontal: 18,
      opacity: lanBusy ? 0.5 : 1
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: t.lineStrong,
      borderRadius: 8,
      paddingVertical: 11,
      paddingHorizontal: 18
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.sealFg, fontSize: 14, textAlign: 'center', fontWeight: '600' },
    btnTextGhost: { color: t.ink, fontSize: 14, textAlign: 'center' },
    card: {
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 10,
      backgroundColor: t.surface,
      padding: 14,
      marginTop: 12
    },
    cardTitle: { fontSize: 13.5, fontWeight: '700', color: t.ink },
    cardLine: { fontSize: 12.5, color: t.ink2, marginTop: 6, lineHeight: 19 },
    cardAlert: {
      fontSize: 12.5,
      color: t.ink2,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: t.line,
      lineHeight: 18
    },
    status: { fontSize: 12, color: t.muted, marginTop: 14, lineHeight: 17 },
    scanBox: { height: 260, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1c1c1a', justifyContent: 'flex-end', padding: 12, marginTop: 6 }
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
        {session !== null && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>账号</Text>
            <View style={s.card}>
              {session.isGuest ? (
                <>
                  <Text style={s.cardTitle}>当前身份：游客</Text>
                  <Text style={s.cardLine}>
                    游客仅可浏览与阅读演示书库；注册账号后可拥有独立书库并与桌面端同步。
                  </Text>
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.btnPrimary, lanBusy ? s.btnDisabled : null]}
                      disabled={lanBusy}
                      onPress={() => void session.logout()}
                      accessibilityLabel="注册或登录账号"
                    >
                      <Text style={s.btnText}>注册 / 登录账号</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.cardTitle}>{session.account.name}</Text>
                  <Text style={s.cardLine}>独立书库 · 账号级数据隔离；退出后需重新输入口令进入。</Text>
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.btnGhost, lanBusy ? s.btnDisabled : null]}
                      disabled={lanBusy}
                      onPress={() => void session.logout()}
                      accessibilityLabel="退出登录"
                    >
                      <Text style={s.btnTextGhost}>退出登录</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>设备同步（局域网）</Text>
          {lanPair === null ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>与桌面端墨纸配对</Text>
              <Text style={s.cardLine}>
                在桌面端「设置 · 设备同步」点「配对新设备」，出示二维码或六位数字码。
                手机与电脑需在同一网络；书库从桌面增量拉取，阅读进度自动回传。
              </Text>
              {Platform.OS !== 'web' && !scanOn && (
                <View style={s.btnRow}>
                  <Pressable style={s.btnPrimary} onPress={() => setScanOn(true)}>
                    <Text style={s.btnText}>扫码配对</Text>
                  </Pressable>
                </View>
              )}
              {scanOn && (
                <View style={s.scanBox}>
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={(e) => {
                      const data = e.data
                      setScanOn(false)
                      setLanBusy(true)
                      void (async () => {
                        try {
                          const p = await pairFromQr(data, lanName)
                          setLanPair(p)
                          setLanMsg('配对成功，正在首次同步…')
                          const r = await runSync(db)
                          setLanMsg(formatSyncResult(r))
                          setLanLastAt(r.at)
                        } catch (er) {
                          setLanErr(er instanceof Error ? er.message : String(er))
                        } finally {
                          setLanBusy(false)
                        }
                      })()
                    }}
                  />
                  <Text style={[s.cardLine, { color: '#fff' }]}>对准桌面端的二维码</Text>
                </View>
              )}
              <Text style={s.label}>服务器地址</Text>
              <TextInput
                style={s.input}
                value={lanAddr}
                onChangeText={setLanAddr}
                placeholder="192.168.1.100:7380"
                placeholderTextColor={t.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
              />
              <Text style={s.label}>六位数字码</Text>
              <TextInput
                style={s.input}
                value={lanCode}
                onChangeText={setLanCode}
                placeholder="123456"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Text style={s.label}>本机名称</Text>
              <TextInput
                style={s.input}
                value={lanName}
                onChangeText={setLanName}
                placeholder="我的手机"
                placeholderTextColor={t.muted}
                maxLength={24}
              />
              <View style={s.btnRow}>
                <Pressable
                  style={[s.btnPrimary, lanBusy ? s.btnDisabled : null]}
                  disabled={lanBusy}
                  onPress={() => void doPairManual()}
                >
                  <Text style={s.btnText}>{lanBusy ? '配对中…' : '手动配对并同步'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.cardTitle}>已配对 · {lanPair.deviceName}</Text>
              <Text style={s.cardLine}>服务器 {lanPair.addr}</Text>
              {lanLastAt !== null && (
                <Text style={s.cardLine}>上次同步 {fmtDate(new Date(lanLastAt).toISOString())}</Text>
              )}
              <Text style={s.cardLine}>
                书架与章节由桌面端权威维护；打开 App 会自动同步一次，阅读进度静默回传。
              </Text>
              <View style={s.btnRow}>
                <Pressable
                  style={[s.btnPrimary, lanBusy ? s.btnDisabled : null]}
                  disabled={lanBusy}
                  onPress={() => void doSyncNow()}
                >
                  <Text style={s.btnText}>{lanBusy ? '同步中…' : '立即同步'}</Text>
                </Pressable>
                <Pressable
                  style={[s.btnGhost, confirmUnpair ? s.btnDisabled : null]}
                  disabled={confirmUnpair}
                  onPress={() => setConfirmUnpair(true)}
                >
                  <Text style={s.btnTextGhost}>断开配对</Text>
                </Pressable>
              </View>
              {confirmUnpair && (
                <View style={[s.card, { borderColor: t.seal }]}>
                  <Text style={s.cardAlert}>断开后将不再自动同步；重新配对需在桌面端重新出示二维码。</Text>
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
            </View>
          )}
          {lanMsg !== '' && <Text style={s.status}>{lanMsg}</Text>}
          {lanErr !== '' && <Text style={[s.status, { color: t.seal }]}>{lanErr}</Text>}
        </View>

        <View style={[s.section, { marginBottom: 40 }]}>
          <Text style={s.sectionTitle}>关于</Text>
          <Text style={s.aboutVersion}>墨纸移动端 v{APP_VERSION}</Text>
          <Text style={s.sectionSub}>
            阅读书架 · 局域网设备同步。用「设备同步」直连桌面端获取书库，离线全功能。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
