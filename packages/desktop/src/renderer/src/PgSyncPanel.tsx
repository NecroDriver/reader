import { useEffect, useState } from 'react'
import SliderSwitch from './SliderSwitch'

interface PgCfgView {
  enabled: boolean
  host: string
  port: number
  database: string
  user: string
  secretStored: boolean
  session: { userId: string; name: string } | null
}
type PgResult = { ok: true; view: PgCfgView } | { ok: false; error: string }

const DbIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" /><path d="M4 10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" /></svg>
)
const LoginIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3.5h2.5A1.5 1.5 0 0 1 17 5v10a1.5 1.5 0 0 1-1.5 1.5H13" /><path d="M8.5 6.5 5 10l3.5 3.5M5 10h8" /></svg>
)

/**
 * 设置页「账号云同步（PG）」组：连接配置化（换厂家只改配置）+ 自管云端账号（注册/登录）。
 * v2.1 M-A：先建立账号与连接；薄同步（书架/进度对账）在 M-B 接入。
 */
export default function PgSyncPanel({
  onChanged
}: {
  onChanged?: (msg: string) => void
}) {
  const [cfg, setCfg] = useState<PgCfgView | null>(null)
  const [form, setForm] = useState({ host: '', port: '5432', database: '', user: '', password: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [acct, setAcct] = useState({ name: '', password: '' })
  const [acctBusy, setAcctBusy] = useState(false)
  const [acctErr, setAcctErr] = useState('')

  const load = (c?: PgCfgView): void => {
    void (async () => {
      const view = c ?? ((await window.mozhi.getPgConfig()) as PgCfgView)
      setCfg(view)
      setForm((p) => ({ ...p, host: view.host, port: String(view.port), database: view.database, user: view.user }))
    })()
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cfg || !window.mozhi) return null
  const dirty =
    form.host.trim() !== cfg.host || Number(form.port) !== cfg.port ||
    form.database.trim() !== cfg.database || form.user.trim() !== cfg.user || form.password !== ''

  const save = async (enabledNext?: boolean): Promise<void> => {
    setSaving(true)
    setTestMsg('')
    const patch: Parameters<typeof window.mozhi.savePgConfig>[0] = {
      enabled: enabledNext ?? cfg.enabled,
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      user: form.user.trim()
    }
    if (form.password) patch.password = form.password
    const c = (await window.mozhi.savePgConfig(patch)) as PgCfgView
    setCfg(c)
    setForm((p) => ({ ...p, password: '' }))
    setSaving(false)
    onChanged?.('账号云同步配置已保存')
  }

  const toggleEnabled = async (): Promise<void> => {
    const next = !cfg.enabled
    await save(next)
    onChanged?.(next ? '账号云同步已开启' : '账号云同步已关闭')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg('正在连接…')
    const r = await window.mozhi.testPg()
    setTesting(false)
    setTestMsg(r.ok ? `连接成功：${r.message}` : `连接失败：${r.message}`)
  }

  const submitAcct = async (): Promise<void> => {
    setAcctBusy(true)
    setAcctErr('')
    const r: PgResult =
      mode === 'login'
        ? await window.mozhi.loginPg(acct.name, acct.password)
        : await window.mozhi.registerPg(acct.name, acct.password)
    setAcctBusy(false)
    if (r.ok) {
      load(r.view)
      setAcct({ name: '', password: '' })
      onChanged?.(mode === 'login' ? `云端账号「${r.view.session?.name}」登录成功` : `云端账号「${r.view.session?.name}」注册成功`)
    } else {
      setAcctErr(r.error)
    }
  }

  const logout = async (): Promise<void> => {
    setAcctBusy(true)
    const r = await window.mozhi.logoutPg()
    setAcctBusy(false)
    if (r.ok) {
      load(r.view)
      onChanged?.('云端账号已退出登录')
    }
  }

  return (
    <section className="settings-group">
      <p className="group-eyebrow">PG SYNC · 账号云同步</p>
      <h2>
        {DbIcon} 账号云同步
        <SliderSwitch checked={cfg.enabled} onChange={() => void toggleEnabled()} label="启用账号云同步" />
      </h2>

      {cfg.enabled ? (
        <>
          <div className="setting-row">
            <div className="setting-info">
              <strong>PostgreSQL 账本</strong>
              <span>账号与书架进度的对账中枢；连接配置化，换厂家只需改配置 + 全量重推</span>
            </div>
          </div>
          <div className="setting-row column">
            <label htmlFor="pg-host">主机</label>
            <input id="pg-host" className="grow" type="text" placeholder="192.168.2.143 或 db.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </div>
          <div className="setting-row">
            <div className="setting-row column grow">
              <label htmlFor="pg-port">端口</label>
              <input id="pg-port" className="grow" type="text" inputMode="numeric" placeholder="5432" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
            <div className="setting-row column grow2">
              <label htmlFor="pg-db">数据库</label>
              <input id="pg-db" className="grow" type="text" placeholder="reader" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row column grow2">
              <label htmlFor="pg-user">用户</label>
              <input id="pg-user" className="grow" type="text" autoComplete="username" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
            </div>
            <div className="setting-row column grow2">
              <label htmlFor="pg-pwd">口令</label>
              <input id="pg-pwd" className="grow" type="password" autoComplete="current-password" placeholder={cfg.secretStored ? '已保存（留空则不修改）' : '未设置'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info" />
            <div className="dir-actions">
              <button type="button" className="btn ghost" disabled={testing} onClick={() => void test()}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button type="button" className="btn primary" disabled={saving || !dirty} onClick={() => void save()}>
                {saving ? '保存中…' : '保存配置'}
              </button>
            </div>
          </div>
          {testMsg && (
            <p className={`cloud-test-msg${testMsg.startsWith('连接成功') ? ' ok' : ' err'}`} role="status">
              {testMsg}
            </p>
          )}

          {cfg.session ? (
            <div className="setting-row">
              <div className="setting-info">
                <strong>云端账号 · {cfg.session.name}</strong>
                <span>已登录。多端书架与进度将以此账号对账同步（M-B 起生效）</span>
              </div>
              <div className="dir-actions">
                <button type="button" className="btn ghost" disabled={acctBusy} onClick={() => void logout()}>
                  {acctBusy ? '退出中…' : '退出登录'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="setting-row">
                <div className="setting-info">
                  <strong>云端账号</strong>
                  <span>注册一次，多端共用；口令哈希（scrypt）存于你自己的数据库</span>
                </div>
                <div className="seg small">
                  <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setAcctErr('') }}>
                    登录
                  </button>
                  <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setAcctErr('') }}>
                    注册
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-row column grow2">
                  <label htmlFor="pg-acct-name">{mode === 'login' ? '账号名' : '账号名（最长 24 字）'}</label>
                  <input id="pg-acct-name" className="grow" type="text" autoComplete="username" value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} />
                </div>
                <div className="setting-row column grow2">
                  <label htmlFor="pg-acct-pwd">{mode === 'login' ? '口令' : '口令（至少 4 位）'}</label>
                  <input id="pg-acct-pwd" className="grow" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} />
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-info" />
                <div className="dir-actions">
                  <button type="button" className="btn primary" disabled={acctBusy || !acct.name || !acct.password} onClick={() => void submitAcct()}>
                    {LoginIcon} {acctBusy ? '请求中…' : mode === 'login' ? '登录' : '注册并登录'}
                  </button>
                </div>
              </div>
              {acctErr && (
                <p className="cloud-test-msg err" role="alert">
                  {acctErr}
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <div className="setting-row">
          <div className="setting-info">
            <strong>账号云同步</strong>
            <span>开启后配置 PostgreSQL 账本并注册云端账号，多端进度对账（正文走快照 / OSS 通道）</span>
          </div>
        </div>
      )}
    </section>
  )
}
