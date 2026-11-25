import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Camera, CameraView } from 'expo-camera'
import { usePrefs } from '../theme'
import { THEMES, type ThemeDef } from '../types'
import { formatSyncResult, getPair, pairFromQr, pairManual, runSync, type SyncSummary } from '../lansync'

/**
 * 配对首屏：未与桌面端配对时的默认入口。
 * 配对成功 → 立即首同步 → 进书架（此后直接使用桌面端的账户数据）。
 */
export default function PairScreen(): React.JSX.Element {
  const db = useSQLiteContext()
  const { theme } = usePrefs()
  const t: ThemeDef = THEMES[theme]

  const [lanAddr, setLanAddr] = useState('')
  const [lanCode, setLanCode] = useState('')
  const [lanName, setLanName] = useState('我的手机')
  const [scanOn, setScanOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  /* 已配对（深链防御：直接打开 /pair）→ 直接进书架 */
  useEffect(() => {
    void (async () => {
      if (await getPair()) router.replace('/')
    })()
  }, [])

  function startScan(): void {
    setErr('')
    void (async () => {
      try {
        const perm = await Camera.requestCameraPermissionsAsync()
        if (perm.granted) setScanOn(true)
        else setErr('未获得相机权限——可在系统设置·应用·墨纸中开启，或改用下方手动配对')
      } catch {
        setErr('相机不可用，请改用下方手动配对')
      }
    })()
  }

  function onScanned(data: string): void {
    setScanOn(false)
    setBusy(true)
    void (async () => {
      try {
        await pairFromQr(data, lanName)
        setMsg('配对成功，正在同步书库…')
        const r: SyncSummary = await runSync(db)
        setMsg(formatSyncResult(r))
        await new Promise((res) => setTimeout(res, 600))
        router.replace('/')
      } catch (er) {
        setErr(er instanceof Error ? er.message : String(er))
      } finally {
        setBusy(false)
      }
    })()
  }

  function doPairManual(): void {
    setErr('')
    setMsg('')
    setBusy(true)
    void (async () => {
      try {
        await pairManual(lanAddr, lanCode, lanName)
        setMsg('配对成功，正在同步书库…')
        const r: SyncSummary = await runSync(db)
        setMsg(formatSyncResult(r))
        await new Promise((res) => setTimeout(res, 600))
        router.replace('/')
      } catch (er) {
        setErr(er instanceof Error ? er.message : String(er))
      } finally {
        setBusy(false)
      }
    })()
  }

  const s = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: t.bg },
    scroll: { flex: 1 },
    scrollContent: {
      padding: 24,
      paddingTop: 48,
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center'
    },
    mark: {
      width: 64,
      height: 64,
      borderRadius: 6,
      backgroundColor: t.seal,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center'
    },
    markText: { color: '#F5EFE3', fontSize: 34, fontFamily: 'serif', fontWeight: '600' },
    brandCn: {
      color: t.ink,
      fontSize: 22,
      fontWeight: '700',
      fontFamily: 'serif',
      textAlign: 'center',
      marginTop: 14
    },
    brandEn: {
      color: t.muted,
      fontSize: 10,
      letterSpacing: 3,
      textAlign: 'center',
      marginTop: 4
    },
    lead: {
      color: t.ink2,
      fontSize: 13,
      textAlign: 'center',
      marginTop: 10,
      marginBottom: 26,
      lineHeight: 19
    },
    card: {
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 10,
      backgroundColor: t.surface,
      padding: 16
    },
    cardTitle: { fontSize: 14, fontWeight: '700', color: t.ink, fontFamily: 'serif' },
    cardLine: { fontSize: 12.5, color: t.ink2, marginTop: 6, lineHeight: 19 },
    scanBox: {
      height: 240,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: '#1c1c1a',
      justifyContent: 'flex-end',
      padding: 12,
      marginTop: 10
    },
    label: { fontSize: 12.5, color: t.ink2, marginTop: 12, marginBottom: 5 },
    input: {
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
      color: t.ink,
      backgroundColor: t.bg
    },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    btnPrimary: {
      backgroundColor: t.seal,
      borderRadius: 8,
      paddingVertical: 11,
      paddingHorizontal: 18,
      opacity: busy ? 0.5 : 1
    },
    btnText: { color: '#F5EFE3', fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
    status: { fontSize: 12, color: t.muted, marginTop: 14, lineHeight: 17 },
    statusErr: { fontSize: 12, color: t.seal, marginTop: 14, lineHeight: 17 }
  })

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={s.mark}>
          <Text style={s.markText}>墨</Text>
        </View>
        <Text style={s.brandCn}>墨纸</Text>
        <Text style={s.brandEn}>MOZHI READER</Text>
        <Text style={s.lead}>
          与桌面端墨纸配对，同步你的书库。{'\n'}配对一次，离线全功能；阅读进度自动回传。
        </Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>第一步 · 在电脑上出示配对码</Text>
          <Text style={s.cardLine}>
            桌面端墨纸 → 设置 → 设备同步 → 配对新设备。屏幕会给出二维码与六位数字码（5 分钟内有效）。
          </Text>
          {Platform.OS !== 'web' && !scanOn && (
            <View style={s.btnRow}>
              <Pressable
                style={[s.btnPrimary, busy ? { opacity: 0.5 } : null]}
                disabled={busy}
                onPress={startScan}
                accessibilityLabel="扫码配对"
                accessibilityRole="button"
              >
                <Text style={s.btnText}>扫码配对</Text>
              </Pressable>
            </View>
          )}
          {scanOn && (
            <View style={s.scanBox}>
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(e) => onScanned(e.data)}
              />
              <Text style={[s.cardLine, { color: '#fff' }]}>对准桌面端的二维码</Text>
            </View>
          )}
        </View>

        <View style={[s.card, { marginTop: 14 }]}>
          <Text style={s.cardTitle}>或手动配对</Text>
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
              style={[s.btnPrimary, busy ? { opacity: 0.5 } : null]}
              disabled={busy}
              onPress={doPairManual}
              accessibilityLabel="配对并同步"
              accessibilityRole="button"
            >
              <Text style={s.btnText}>{busy ? '配对中…' : '配对并同步'}</Text>
            </Pressable>
          </View>
        </View>

        {msg !== '' && <Text style={s.status}>{msg}</Text>}
        {err !== '' && <Text style={s.statusErr}>{err}</Text>}
      </ScrollView>
    </SafeAreaView>
  )
}
