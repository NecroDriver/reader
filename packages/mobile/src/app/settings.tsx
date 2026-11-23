import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { SafeAreaView } from 'react-native-safe-area-context'
import { usePrefs } from '../theme'
import { THEMES, type ThemeDef } from '../types'
import {
  applySnapshotDb,
  downloadSnapshotDb,
  getRemoteManifest,
  testConnection,
  type RemoteManifest
} from '../cloud'
import {
  loadAppliedInfo,
  loadCloudConfig,
  saveAppliedInfo,
  saveCloudConfig,
  type AppliedInfo,
  type CloudConfig
} from '../storage'

type Phase = 'idle' | 'testing' | 'fetching' | 'confirm' | 'applying' | 'done'

function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

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

  const [cfg, setCfg] = useState<CloudConfig | null>(null)
  const [remote, setRemote] = useState<RemoteManifest | null>(null)
  const [applied, setApplied] = useState<AppliedInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null)

  useEffect(() => {
    void (async () => {
      setCfg(await loadCloudConfig())
      setApplied(await loadAppliedInfo())
    })()
  }, [])

  async function saveAndTest(): Promise<void> {
    if (!cfg) return
    setErr('')
    setMsg('')
    setPhase('testing')
    try {
      await saveCloudConfig(cfg)
      const r = await testConnection(cfg)
      setMsg(`${r}，配置已保存`)
      const m = await getRemoteManifest(cfg)
      setRemote(m)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      await saveCloudConfig(cfg).catch(() => undefined)
    } finally {
      setPhase('idle')
    }
  }

  async function refreshRemote(): Promise<void> {
    if (!cfg) return
    setErr('')
    try {
      setRemote(await getRemoteManifest(cfg))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function startDownload(): Promise<void> {
    if (!cfg) return
    setErr('')
    setMsg('')
    setPhase('fetching')
    try {
      const { bytes } = await downloadSnapshotDb(cfg)
      setZipBytes(bytes)
      const m = await getRemoteManifest(cfg)
      setRemote(m)
      setPhase('confirm')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  async function applyNow(): Promise<void> {
    if (!zipBytes) return
    setPhase('applying')
    try {
      // 移动端显示偏好（主题/字号/行距）在恢复前取出，恢复后写回
      const keys = ['mobile_theme', 'mobile_read_size', 'mobile_read_lh']
      const keep: Record<string, string | null> = {}
      for (const k of keys) {
        const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', k)
        keep[k] = row?.value ?? null
      }
      const r = await applySnapshotDb(db, zipBytes, keep)
      const info: AppliedInfo = { at: Date.now(), books: r.books, chapters: r.chapters }
      await saveAppliedInfo(info)
      setApplied(info)
      setZipBytes(null)
      setMsg(`已恢复 ${r.books} 本书 · ${r.chapters} 章`)
      setPhase('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  function cancelConfirm(): void {
    setZipBytes(null)
    setPhase('idle')
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
      opacity: phase === 'idle' ? 1 : 0.5
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
    msg: { fontSize: 12.5, color: t.seal, marginTop: 12, lineHeight: 18 },
    msgErr: { fontSize: 12.5, color: t.seal, marginTop: 12, lineHeight: 18 },
    status: { fontSize: 12, color: t.muted, marginTop: 14, lineHeight: 17 }
  })

  const busy = phase === 'testing' || phase === 'fetching' || phase === 'applying'
  const busyText =
    phase === 'testing' ? '正在测试连接…' : phase === 'fetching' ? '正在下载快照…（约 19 MB，请稍候）' : phase === 'applying' ? '正在写入数据库…' : ''

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
          <Text style={s.sectionTitle}>云同步 · WebDAV</Text>
          <Text style={s.sectionSub}>
            从桌面端墨纸上传的快照下载到手机。填写与桌面端相同的 WebDAV 服务、目录与账号
            （坚果云请使用「应用密码」，不是登录密码）。
          </Text>

          <Text style={s.label}>服务器地址</Text>
          <TextInput
            style={s.input}
            value={cfg?.url ?? ''}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://dav.jianguoyun.com/dav"
            placeholderTextColor={t.muted}
            editable={!busy && cfg !== null}
            onChangeText={(v): void => setCfg((c) => (c ? { ...c, url: v.trim() } : c))}
          />
          <Text style={s.label}>远程目录</Text>
          <TextInput
            style={s.input}
            value={cfg?.dir ?? ''}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="mozhi"
            placeholderTextColor={t.muted}
            editable={!busy && cfg !== null}
            onChangeText={(v): void => setCfg((c) => (c ? { ...c, dir: v.trim() } : c))}
          />
          <Text style={s.label}>账号</Text>
          <TextInput
            style={s.input}
            value={cfg?.username ?? ''}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={t.muted}
            editable={!busy && cfg !== null}
            onChangeText={(v): void => setCfg((c) => (c ? { ...c, username: v.trim() } : c))}
          />
          <Text style={s.label}>应用密码</Text>
          <TextInput
            style={s.input}
            value={cfg?.password ?? ''}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={t.muted}
            editable={!busy && cfg !== null}
            onChangeText={(v): void => setCfg((c) => (c ? { ...c, password: v } : c))}
          />

          <View style={s.btnRow}>
            <Pressable
              style={[s.btnPrimary, busy || cfg === null ? s.btnDisabled : null]}
              disabled={busy || cfg === null}
              onPress={() => void saveAndTest()}
            >
              <Text style={s.btnText}>保存并测试</Text>
            </Pressable>
          </View>
          {msg !== '' && <Text style={s.msg}>{msg}</Text>}
          {err !== '' && <Text style={s.msgErr}>⚠ {err}</Text>}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>云端快照</Text>
          {remote === null ? (
            <View style={s.card}>
              <Text style={s.cardLine}>
                {err !== '' ? '无法读取远端信息' : cfg === null ? '加载中…' : '「保存并测试」后显示远端快照信息；尚无快照时请先在桌面端上传。'}
              </Text>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.cardTitle}>{fmtDate(remote.createdAt)} 的快照</Text>
              <Text style={s.cardLine}>
                {remote.books} 本书 · {remote.chapters} 章 · {remote.articles} 篇文章 · {fmtBytes(remote.zipBytes)}
              </Text>
              <Text style={s.cardLine}>由桌面端墨纸 v{remote.app} 上传</Text>
            </View>
          )}
          {applied !== null && (
            <Text style={s.status}>
              本机上次恢复：{fmtDate(new Date(applied.at).toISOString())} · {applied.books} 本书 · {applied.chapters} 章
            </Text>
          )}
          <View style={s.btnRow}>
            <Pressable
              style={[s.btnGhost, busy ? s.btnDisabled : null]}
              disabled={busy}
              onPress={() => void refreshRemote()}
            >
              <Text style={s.btnTextGhost}>刷新远端信息</Text>
            </Pressable>
            <Pressable
              style={[s.btnPrimary, busy || remote === null ? s.btnDisabled : null]}
              disabled={busy || remote === null}
              onPress={() => void startDownload()}
            >
              <Text style={s.btnText}>下载并应用</Text>
            </Pressable>
          </View>
        </View>

        {phase === 'confirm' && (
          <View style={[s.card, { borderColor: t.seal }]}>
            <Text style={s.cardTitle}>应用云端快照？</Text>
            <Text style={s.cardAlert}>
              将用云端快照{remote ? `（${remote.books} 本书 · ${remote.chapters} 章）` : ''}替换本机书库数据。
              本机的阅读进度会被快照中的进度覆盖；主题与排版设置保留。
            </Text>
            <View style={s.btnRow}>
              <Pressable style={s.btnGhost} onPress={cancelConfirm}>
                <Text style={s.btnTextGhost}>取消</Text>
              </Pressable>
              <Pressable style={s.btnPrimary} onPress={() => void applyNow()}>
                <Text style={s.btnText}>确认应用</Text>
              </Pressable>
            </View>
          </View>
        )}

        {busy && <Text style={s.status}>{busyText}</Text>}
        {phase === 'done' && (
          <View style={s.btnRow}>
            <Pressable style={s.btnPrimary} onPress={() => router.replace('/')}>
              <Text style={s.btnText}>回到书架</Text>
            </Pressable>
          </View>
        )}

        <View style={[s.section, { marginBottom: 40 }]}>
          <Text style={s.sectionTitle}>关于</Text>
          <Text style={s.sectionSub}>
            墨纸移动端 · 阅读快照 · 与桌面端共用同一份 WebDAV 快照。移动端改动不上传，
            进度回传将在后续版本提供。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
