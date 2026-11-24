import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { THEMES, type ThemeDef } from './types'
import { hasPwd, type AccountRec } from './accounts'

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

function sealText(name: string): { text: string; vertical: boolean } {
  return CJK.test(name) ? { text: name.slice(0, 4).split('').join('\n'), vertical: true } : { text: name.slice(0, 8), vertical: false }
}

export interface LoginResult {
  ok: boolean
  error?: string
}

export function LoginScreen({
  accounts,
  lastUsedId,
  onLogin,
  onCreate,
  onGuest
}: {
  accounts: AccountRec[]
  lastUsedId: string | null
  onLogin: (id: string, pwd: string, remember: boolean) => Promise<LoginResult>
  onCreate: (name: string, pwd: string, remember: boolean) => Promise<LoginResult>
  onGuest: () => void
}): React.JSX.Element {
  const t: ThemeDef = THEMES.paper
  const [pickedId, setPickedId] = useState<string | null>(
    lastUsedId && accounts.some((a) => a.id === lastUsedId) ? lastUsedId : (accounts[0]?.id ?? null)
  )
  const picked = accounts.find((a) => a.id === pickedId) ?? null

  /* 退出登录瞬间账号列表尚未就位时 pickedId 可能失效：渲染期回退选中第一个（无需 effect） */
  const activePicked =
    picked ?? (accounts.length > 0 ? accounts[0] : null)
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [cName, setCName] = useState('')
  const [cPwd, setCPwd] = useState('')
  const [cRemember, setCRemember] = useState(true)

  const s = useMemo(
    () =>
      StyleSheet.create({
        wrap: { flex: 1, backgroundColor: t.bg },
        scroll: { flex: 1 },
        scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 28, maxWidth: 420, width: '100%', alignSelf: 'center' },
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
        brand: { textAlign: 'center', color: t.ink, fontSize: 24, fontWeight: '700', fontFamily: 'serif', marginTop: 14 },
        latin: { textAlign: 'center', color: t.seal, fontSize: 10, letterSpacing: 3, marginTop: 4 },
        sub: { textAlign: 'center', color: t.muted, fontSize: 12.5, marginTop: 8, marginBottom: 26 },
        sealRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
        sealCard: {
          width: 76,
          minHeight: 96,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: t.lineStrong,
          backgroundColor: t.surface,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 10,
          paddingHorizontal: 4
        },
        sealCardPicked: { borderColor: t.seal, backgroundColor: 'rgba(181,64,42,.08)' },
        sealCardGuest: { borderStyle: 'dashed', borderColor: t.line },
        sealName: { color: t.ink, fontSize: 15, fontWeight: '600', fontFamily: 'serif', textAlign: 'center', lineHeight: 22 },
        sealKind: { color: t.muted, fontSize: 10, marginTop: 6 },
        sealLast: { color: t.seal, fontSize: 9, marginTop: 3 },
        pwdPanel: { marginTop: 24 },
        label: { fontSize: 12.5, color: t.ink2, marginBottom: 6 },
        pwdWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.lineStrong, borderRadius: 8, backgroundColor: t.surface },
        pwdInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: t.ink },
        pwdToggle: { paddingHorizontal: 12, paddingVertical: 10 },
        pwdToggleText: { color: t.seal, fontSize: 12.5 },
        checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
        checkBox: {
          width: 17,
          height: 17,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: remember ? t.seal : t.lineStrong,
          backgroundColor: remember ? t.seal : 'transparent',
          alignItems: 'center',
          justifyContent: 'center'
        },
        checkMark: { color: '#F5EFE3', fontSize: 11, lineHeight: 13 },
        checkLabel: { color: t.ink2, fontSize: 12.5 },
        btnPrimary: {
          backgroundColor: t.seal,
          borderRadius: 8,
          paddingVertical: 12,
          alignItems: 'center',
          marginTop: 18,
          opacity: busy ? 0.55 : 1
        },
        btnPrimaryText: { color: '#F5EFE3', fontSize: 14.5, fontWeight: '600' },
        btnGhost: {
          borderWidth: 1,
          borderColor: t.lineStrong,
          borderRadius: 8,
          paddingVertical: 11,
          alignItems: 'center',
          marginTop: 12
        },
        btnGhostText: { color: t.ink, fontSize: 13.5 },
        err: { color: t.seal, fontSize: 12.5, marginTop: 12, minHeight: 18 },
        createPanel: { marginTop: 12 },
        createInput: {
          borderWidth: 1,
          borderColor: t.lineStrong,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          color: t.ink,
          backgroundColor: t.surface,
          marginTop: 8
        },
        foot: { color: t.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 30 },
        guestLink: { marginTop: 26, alignSelf: 'center' },
        guestLinkText: { color: t.ink2, fontSize: 13, textDecorationLine: 'underline' },
        guestHint: { color: t.muted, fontSize: 10.5, lineHeight: 15, textAlign: 'center', marginTop: 6 }
      }),
    [t, remember, busy]
  )

  async function doLogin(): Promise<void> {
    if (!activePicked) return
    setErr('')
    if (hasPwd(activePicked) && pwd === '') {
      setErr('请输入口令')
      return
    }
    setBusy(true)
    const r = await onLogin(activePicked.id, pwd, remember)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '进入失败')
  }

  async function doCreate(): Promise<void> {
    setErr('')
    setBusy(true)
    const r = await onCreate(cName.trim(), cPwd, cRemember)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '创建失败')
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.scrollContent}>
      <View style={s.mark}>
        <Text style={s.markText}>墨</Text>
      </View>
      <Text style={s.brand}>墨纸</Text>
      <Text style={s.latin}>MOZHI READER</Text>
      <Text style={s.sub}>选择你的藏书印，进入自己的书房</Text>

      <View style={s.sealRow}>
        {accounts.map((a) => {
          const st = sealText(a.name)
          const isPicked = a.id === activePicked?.id
          const guest = !hasPwd(a)
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}，${guest ? '游客账号，直接进入' : '需要口令'}`}
              style={[s.sealCard, isPicked ? s.sealCardPicked : null, guest ? s.sealCardGuest : null, { opacity: busy ? 0.55 : 1 }]}
              disabled={busy}
              onPress={() => {
                setPickedId(a.id)
                setPwd('')
                setErr('')
              }}
            >
              <Text style={[s.sealName, st.vertical ? { letterSpacing: 2 } : null]}>{st.text}</Text>
              <Text style={s.sealKind}>{guest ? '游客 · 直接进入' : '口令进入'}</Text>
              {a.id === lastUsedId && <Text style={s.sealLast}>上次使用</Text>}
            </Pressable>
          )
        })}
      </View>

      {activePicked !== null && hasPwd(activePicked) && (
        <View style={s.pwdPanel}>
          <Text style={s.label}>「{activePicked.name}」的口令</Text>
          <View style={s.pwdWrap}>
            <TextInput
              style={s.pwdInput}
              value={pwd}
              onChangeText={(v): void => {
                setPwd(v)
                setErr('')
              }}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={`「${activePicked.name}」的口令`}
              onSubmitEditing={() => void doLogin()}
            />
            <Pressable style={s.pwdToggle} onPress={() => setShowPwd((v) => !v)} accessibilityRole="button" accessibilityLabel={showPwd ? '隐藏口令' : '显示口令'}>
              <Text style={s.pwdToggleText}>{showPwd ? '隐藏' : '显示'}</Text>
            </Pressable>
          </View>
          <Pressable style={s.checkRow} onPress={() => setRemember((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: remember }}>
            <View style={s.checkBox}>{remember ? <Text style={s.checkMark}>✓</Text> : null}</View>
            <Text style={s.checkLabel}>记住我，下次启动自动进入</Text>
          </Pressable>
        </View>
      )}

      {activePicked !== null && (
        <Pressable style={[s.btnPrimary, busy ? { opacity: 0.55 } : null]} disabled={busy} onPress={() => void doLogin()} accessibilityRole="button">
          <Text style={s.btnPrimaryText}>{hasPwd(activePicked) ? '钤印进入' : '直接进入'}</Text>
        </Pressable>
      )}

      <Text accessibilityLiveRegion="polite" style={s.err}>
        {err}
      </Text>

      {!creating ? (
        <Pressable style={s.btnGhost} disabled={busy} onPress={() => { setCreating(true); setErr('') }} accessibilityRole="button">
          <Text style={s.btnGhostText}>＋ 注册新账号</Text>
        </Pressable>
      ) : (
        <View style={s.createPanel}>
          <TextInput
            style={s.createInput}
            value={cName}
            onChangeText={(v): void => {
              setCName(v)
              setErr('')
            }}
            placeholder="账号名（12 字内）"
            placeholderTextColor={t.muted}
            maxLength={12}
            accessibilityLabel="新账号名"
          />
          <TextInput
            style={s.createInput}
            value={cPwd}
            onChangeText={(v): void => {
              setCPwd(v)
              setErr('')
            }}
            placeholder="口令（至少 4 位）"
            placeholderTextColor={t.muted}
            secureTextEntry={!showPwd}
            accessibilityLabel="新账号口令"
          />
          <Pressable style={s.checkRow} onPress={() => setCRemember((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: cRemember }}>
            <View style={[s.checkBox, { borderColor: cRemember ? t.seal : t.lineStrong, backgroundColor: cRemember ? t.seal : 'transparent' }]}>
              {cRemember ? <Text style={s.checkMark}>✓</Text> : null}
            </View>
            <Text style={s.checkLabel}>记住我，下次启动自动进入</Text>
          </Pressable>
          <Pressable style={[s.btnPrimary, busy ? { opacity: 0.55 } : null]} disabled={busy} onPress={() => void doCreate()} accessibilityRole="button">
            <Text style={s.btnPrimaryText}>创建并进入</Text>
          </Pressable>
          <Pressable style={s.btnGhost} disabled={busy} onPress={() => { setCreating(false); setErr('') }}>
            <Text style={s.btnGhostText}>取消</Text>
          </Pressable>
        </View>
      )}

      <Text style={s.foot}>账号为本机独立账号，不与桌面端互通；桌面端的书库，登录后在「设置 · 云同步」配置 WebDAV 下载快照即可获得。</Text>

      <Pressable
        style={s.guestLink}
        disabled={busy}
        onPress={onGuest}
        accessibilityRole="button"
        accessibilityLabel="游客进入，功能受限"
      >
        <Text style={s.guestLinkText}>先逛逛 · 游客进入</Text>
      </Pressable>
      <Text style={s.guestHint}>游客仅可浏览与阅读演示书库；云同步等功能需注册账号。</Text>
    </ScrollView>
  )
}
