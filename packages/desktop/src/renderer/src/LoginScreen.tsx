import { useEffect, useRef, useState } from 'react'

/** 登录页数据来自 session:current / accounts:list（preload 已映射） */
export interface LoginAccount {
  id: string
  name: string
  hasPassword: boolean
  lastUsedAt: string
  active: boolean
}

const PlusIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 4v12M4 10h12" /></svg>
)
const EyeIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" /><circle cx="10" cy="10" r="2.2" /></svg>
)
const EyeOffIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l12 12M8.6 8.7a2.2 2.2 0 0 0 2.9 2.9M6.4 6.6C4.2 8 2.5 10 2.5 10s3 5.5 7.5 5.5c1.2 0 2.3-.3 3.3-.8M10 4.5c4.5 0 7.5 5.5 7.5 5.5s-.8 1.5-2.2 2.9" /></svg>
)

/**
 * 登录页「藏书印」：每个账号是一方印章，点选钤印 → 输口令进入。
 * - 账号数据目录按账号隔离（主进程 accounts.ts 保证）
 * - 失败信息就近展示在表单下方（aria-live），输入全部保留
 */
export default function LoginScreen({ onDone }: { onDone: () => void }) {
  const [accounts, setAccounts] = useState<LoginAccount[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  /* 记住我：本机留凭据，下次启动自动进入（默认开；退出登录会撤销） */
  const [remember, setRemember] = useState(true)
  /* 新建账号（可折叠） */
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newRemember, setNewRemember] = useState(true)
  const pwdRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const s = await window.mozhi.getSession()
      if (s.mode === 'login') {
        setAccounts(s.accounts)
        /* 记住账号：预选上次使用的账号 */
        const last = [...s.accounts].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0]
        if (last) setPicked(last.id)
      }
    })()
  }, [])

  useEffect(() => {
    if (picked) pwdRef.current?.focus()
  }, [picked])
  useEffect(() => {
    if (creating) nameRef.current?.focus()
  }, [creating])

  const pickedAcc: LoginAccount | null = accounts.find((a) => a.id === picked) ?? null
  const lastUsedId: string | null =
    accounts.length > 0
      ? [...accounts].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0]?.id ?? null
      : null

  const submit = async (): Promise<void> => {
    if (!pickedAcc || busy) return
    setErr('')
    if (pickedAcc.hasPassword && !pwd) {
      setErr('请输入口令')
      return
    }
    setBusy(true)
    const r = await window.mozhi.loginAccount(pickedAcc.id, pwd, remember)
    setBusy(false)
    if (!r.ok) {
      setErr(r.error)
      return
    }
    onDone()
  }

  const create = async (): Promise<void> => {
    if (busy) return
    setErr('')
    if (!newName.trim()) {
      setErr('请填写账号名')
      return
    }
    if (newPwd.length < 4) {
      setErr('口令至少 4 位')
      return
    }
    if (newPwd !== newPwd2) {
      setErr('两次输入的口令不一致')
      return
    }
    setBusy(true)
    const r = await window.mozhi.createAccount(newName.trim(), newPwd, newRemember)
    setBusy(false)
    if (!r.ok) {
      setErr(r.error)
      return
    }
    onDone()
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-brand">
          <span className="login-mark">墨</span>
          <div className="login-brand-text">
            <strong>墨纸</strong>
            <span className="login-latin">Mozhi Reader</span>
          </div>
          <p className="login-sub">选择你的藏书印，进入自己的书房</p>
        </div>

        {accounts.length > 0 && (
          <div className="seal-row" role="list" aria-label="账号列表">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                role="listitem"
                className={`seal-card${picked === a.id ? ' picked' : ''}${a.hasPassword ? '' : ' guest'}`}
                onClick={() => {
                  setPicked(a.id)
                  setPwd('')
                  setErr('')
                  setCreating(false)
                }}
              >
                <span className={`seal-name${/[\u3400-\u9fff\uF900-\uFAFF]/.test(a.name) ? ' vert' : ''}`}>{a.name}</span>
                <span className="seal-sub">{a.hasPassword ? '口令进入' : '游客 · 直接进入'}</span>
                {a.id === lastUsedId && <span className="seal-last">上次使用</span>}
              </button>
            ))}
          </div>
        )}

        {pickedAcc && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {pickedAcc.hasPassword ? (
              <div className="login-field">
                <label htmlFor="login-pwd">「{pickedAcc.name}」的口令</label>
                <div className="pwd-wrap">
                  <input
                    id="login-pwd"
                    ref={pwdRef}
                    type={showPwd ? 'text' : 'password'}
                    value={pwd}
                    autoComplete="current-password"
                    onChange={(e) => {
                      setPwd(e.target.value)
                      setErr('')
                    }}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    aria-label={showPwd ? '隐藏口令' : '显示口令'}
                    onClick={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? EyeOffIcon : EyeIcon}
                  </button>
                </div>
              </div>
            ) : (
              <p className="login-hint">该账号未设置口令（游客账号），点击「钤印进入」直接进入。</p>
            )}
            <div className="login-check">
              <input
                id="login-remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <label htmlFor="login-remember">记住我，下次启动自动进入</label>
            </div>
            <button type="submit" className="btn primary login-submit" disabled={busy}>
              {busy ? '正在进入…' : '钤印进入'}
            </button>
          </form>
        )}

        <div className="login-create">
          {!creating ? (
            <button type="button" className="btn ghost login-create-btn" onClick={() => { setCreating(true); setErr('') }}>
              {PlusIcon} 新建账号
            </button>
          ) : (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <div className="login-field">
                <label htmlFor="new-name">账号名</label>
                <input
                  id="new-name"
                  ref={nameRef}
                  type="text"
                  value={newName}
                  maxLength={24}
                  autoComplete="off"
                  onChange={(e) => {
                    setNewName(e.target.value)
                    setErr('')
                  }}
                />
              </div>
              <div className="login-field">
                <label htmlFor="new-pwd">口令（至少 4 位）</label>
                <div className="pwd-wrap">
                  <input
                    id="new-pwd"
                    type={showNew ? 'text' : 'password'}
                    value={newPwd}
                    autoComplete="new-password"
                    onChange={(e) => {
                      setNewPwd(e.target.value)
                      setErr('')
                    }}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    aria-label={showNew ? '隐藏口令' : '显示口令'}
                    onClick={() => setShowNew((v) => !v)}
                  >
                    {showNew ? EyeOffIcon : EyeIcon}
                  </button>
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="new-pwd2">确认口令</label>
                <input
                  id="new-pwd2"
                  type={showNew ? 'text' : 'password'}
                  value={newPwd2}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setNewPwd2(e.target.value)
                    setErr('')
                  }}
                />
              </div>
              <div className="login-check">
                <input
                  id="new-remember"
                  type="checkbox"
                  checked={newRemember}
                  onChange={(e) => setNewRemember(e.target.checked)}
                />
                <label htmlFor="new-remember">记住我，下次启动自动进入</label>
              </div>
              <div className="login-create-actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? '正在创建…' : '创建并进入'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                    setNewPwd('')
                    setNewPwd2('')
                    setErr('')
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="login-err" role="alert" aria-live="polite">
          {err}
        </p>

        <p className="login-foot">
          每个账号拥有独立的书库与数据目录；可在「设置 · 云同步」中配置 WebDAV / S3
          兼容存储，手动上传与恢复快照。
        </p>
      </div>
    </div>
  )
}
