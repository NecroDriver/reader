import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { usePrefs } from '../theme'
import { THEMES, type ThemeDef } from '../types'
import { useSession } from '../session'
import {
  applySnapshotDb,
  downloadSnapshotDb,
  getRemoteManifest,
  testConnection,
  type RemoteManifest
} from '../cloud'
import {
  countReadBooks,
  loadProgressUploadedAt,
  uploadPhoneProgress
} from '../progress'
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
import {
  loadAppliedInfo,
  loadCloudConfig,
  saveAppliedInfo,
  saveCloudConfig,
  type AppliedInfo,
  type CloudConfig
} from '../storage'

type Phase = 'idle' | 'testing' | 'fetching' | 'confirm' | 'applying' | 'done' | 'uploadingProg'

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
  const session = useSession()

  const [cfg, setCfg] = useState<CloudConfig | null>(null)
  const [remote, setRemote] = useState<RemoteManifest | null>(null)
  const [applied, setApplied] = useState<AppliedInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null)
  const [readCount, setReadCount] = useState(0)
  const [progUploadedAt, setProgUploadedAt] = useState<number | null>(null)

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
      setCfg(await loadCloudConfig())
      setApplied(await loadAppliedInfo())
      setReadCount(await countReadBooks(db))
      setProgUploadedAt(await loadProgressUploadedAt())
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

  async function uploadProgress(): Promise<void> {
    if (!cfg) return
    setErr('')
    setMsg('')
    setPhase('uploadingProg')
    try {
      const n = await uploadPhoneProgress(db, cfg)
      setProgUploadedAt(Date.now())
      setMsg(`已上传 ${n} 本书的阅读进度`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPhase('idle')
    }
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
    status: { fontSize: 12, color: t.muted, marginTop: 14, lineHeight: 17 },
    scanBox: { height: 260, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1c1c1a', justifyContent: 'flex-end', padding: 12, marginTop: 6 }
  })

  const busy = phase === 'testing' || phase === 'fetching' || phase === 'applying' || phase === 'uploadingProg'
  const busyText =
    phase === 'testing' ? '正在测试连接…' : phase === 'fetching' ? '正在下载快照…（约 19 MB，请稍候）' : phase === 'applying' ? '正在写入数据库…' : phase === 'uploadingProg' ? '正在上传阅读进度…' : ''

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
                    游客仅可浏览与阅读演示书库；云同步、云端恢复与进度回传需要注册账号，注册后拥有独立书库。
                  </Text>
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.btnPrimary, busy ? s.btnDisabled : null]}
                      disabled={busy}
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
                      style={[s.btnGhost, busy ? s.btnDisabled : null]}
                      disabled={busy}
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

        {session !== null && session.isGuest && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>云同步 · WebDAV</Text>
            <View style={s.card}>
              <Text style={s.cardTitle}>游客模式下不可用</Text>
              <Text style={s.cardLine}>
                云端书库恢复、快照下载与进度回传均需要注册账号。注册后可与桌面端共用同一份 WebDAV 快照。
              </Text>
            </View>
          </View>
        )}

        {!(session !== null && session.isGuest) && (
          <>
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
                {remote.books} 本书 · {remote.chapters} 章 · {fmtBytes(remote.zipBytes)}
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

        <View style={s.section}>
          <Text style={s.sectionTitle}>进度回传</Text>
          <View style={s.card}>
            <Text style={s.cardTitle}>{readCount} 本书有阅读进度</Text>
            <Text style={s.cardLine}>
              把手机上的阅读进度上传到云端（不上传书库本体）。在桌面端墨纸的
              「设置 · 云同步 · 手机进度」里检查并吸收。
            </Text>
            {progUploadedAt !== null && (
              <Text style={s.cardLine}>上次上传：{fmtDate(new Date(progUploadedAt).toISOString())}</Text>
            )}
            <View style={s.btnRow}>
              <Pressable
                style={[s.btnPrimary, phase === 'uploadingProg' || cfg === null ? s.btnDisabled : null]}
                disabled={phase === 'uploadingProg' || cfg === null}
                onPress={() => void uploadProgress()}
              >
                <Text style={s.btnText}>{phase === 'uploadingProg' ? '上传中…' : '上传阅读进度'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
          </>
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
          <Text style={s.sectionSub}>
            墨纸移动端 · 阅读书架。推荐用「设备同步（局域网）」直连桌面端获取书库；
            也可用「云同步」下载桌面端上传的 WebDAV 快照作为备份通道。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
