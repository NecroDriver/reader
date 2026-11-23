import { useEffect, useState } from 'react'

interface CloudCfgView {
  enabled: boolean
  provider: 'webdav' | 's3'
  webdav: { url: string; dir: string; username: string }
  s3: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string }
  lastUploadAt: string
  lastDownloadAt: string
  secretStored: boolean
}
export interface ManifestSummary {
  app: string
  createdAt: string
  books: number
  articles: number
  chapters: number
  sources: number
  covers: number
  zipBytes: number
}

const CloudIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 14a3 3 0 0 1-.4-5.97A4.5 4.5 0 0 1 14 7.6 3.2 3.2 0 0 1 14.8 14Z" /><path d="M7 16.5 6 18.5M10 16.5 9 18.5M13 16.5 12 18.5" /></svg>
)
const UpIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" /></svg>
)
const DownIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5v10M5.5 10.5 10 15l4.5-4.5" /></svg>
)

const fmtBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtTime = (iso: string): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

/**
 * 设置页「云同步」组：通用可开关配置（WebDAV / S3 兼容，不绑定具体厂商）。
 * 手动上传快照 / 从云端下载并确认恢复；远端摘要展示。
 */
export default function CloudSyncPanel({
  onChanged
}: {
  onChanged?: (msg: string) => void
}) {
  const [cfg, setCfg] = useState<CloudCfgView | null>(null)
  const [wd, setWd] = useState({ url: '', dir: '', username: '', password: '' })
  const [s3, setS3] = useState({ endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', secret: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [pending, setPending] = useState<ManifestSummary | null>(null)
  const [remote, setRemote] = useState<{ state: 'idle' | 'loading' | 'none' | 'ok' | 'err'; m?: ManifestSummary; msg?: string }>({ state: 'idle' })

  const loadAll = (quiet = false): void => {
    void (async () => {
      const c = (await window.mozhi.getCloudConfig()) as CloudCfgView
      setCfg(c)
      setWd((p) => ({ ...p, url: c.webdav.url, dir: c.webdav.dir, username: c.webdav.username }))
      setS3((p) => ({ ...p, endpoint: c.s3.endpoint, region: c.s3.region, bucket: c.s3.bucket, prefix: c.s3.prefix, accessKeyId: c.s3.accessKeyId }))
      if (!quiet && c.enabled) refreshRemote()
      if (quiet && c.enabled) refreshRemote()
    })()
  }

  const refreshRemote = (): void => {
    setRemote({ state: 'loading' })
    void (async () => {
      const r = await window.mozhi.cloudRemoteInfo()
      if (r.exists && r.manifest) setRemote({ state: 'ok', m: r.manifest })
      else if ('message' in r && r.message) setRemote({ state: 'err', msg: r.message })
      else setRemote({ state: 'none' })
    })()
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cfg || !window.mozhi) return null
  const dirty =
    wd.url !== cfg.webdav.url || wd.dir !== cfg.webdav.dir || wd.username !== cfg.webdav.username ||
    s3.endpoint !== cfg.s3.endpoint || s3.region !== cfg.s3.region || s3.bucket !== cfg.s3.bucket ||
    s3.prefix !== cfg.s3.prefix || s3.accessKeyId !== cfg.s3.accessKeyId || wd.password !== '' || s3.secret !== ''

  const save = async (enabledNext?: boolean): Promise<void> => {
    setSaving(true)
    setTestMsg('')
    const patch: Parameters<typeof window.mozhi.saveCloudConfig>[0] = {
      enabled: enabledNext ?? cfg.enabled,
      provider: cfg.provider,
      webdav: { url: wd.url.trim(), dir: wd.dir.trim(), username: wd.username.trim() },
      s3: { endpoint: s3.endpoint.trim(), region: s3.region.trim(), bucket: s3.bucket.trim(), prefix: s3.prefix.trim(), accessKeyId: s3.accessKeyId.trim() }
    }
    if (wd.password) patch.webdavPassword = wd.password
    if (s3.secret) patch.s3SecretAccessKey = s3.secret
    const c = (await window.mozhi.saveCloudConfig(patch)) as CloudCfgView
    setCfg(c)
    setWd((p) => ({ ...p, password: '' }))
    setS3((p) => ({ ...p, secret: '' }))
    setSaving(false)
    onChanged?.('云同步配置已保存')
    if (c.enabled) refreshRemote()
  }

  const toggleEnabled = async (): Promise<void> => {
    const next = !cfg.enabled
    await save(next)
    onChanged?.(next ? '云同步已开启' : '云同步已关闭')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg('正在连接…')
    const r = await window.mozhi.testCloud()
    setTesting(false)
    setTestMsg(r.ok ? `连接成功：${r.message}` : `连接失败：${r.message}`)
  }

  const upload = async (): Promise<void> => {
    setUploading(true)
    const r = await window.mozhi.uploadCloud()
    setUploading(false)
    if (r.ok && r.manifest) {
      onChanged?.(`已上传快照（${fmtBytes(r.manifest.zipBytes)}）`)
      refreshRemote()
    } else {
      onChanged?.(r.message || '上传失败')
    }
  }

  const download = async (): Promise<void> => {
    setDownloading(true)
    const r = await window.mozhi.downloadCloud()
    setDownloading(false)
    if (r.ok && r.manifest) {
      setPending(r.manifest)
      onChanged?.('快照已下载，请确认后应用')
    } else {
      onChanged?.(r.message || '下载失败')
    }
  }

  const apply = async (): Promise<void> => {
    setApplying(true)
    const r = await window.mozhi.applyCloudRestore()
    setApplying(false)
    setPending(null)
    onChanged?.(r.ok ? '云端快照已恢复到本地' : `恢复失败：${r.message}`)
  }

  const discard = (): void => {
    void window.mozhi.discardCloudRestore()
    setPending(null)
    onChanged?.('已放弃本次恢复')
  }

  return (
    <section className="settings-group">
      <p className="group-eyebrow">CLOUD SYNC · 云同步</p>
      <h2>
        {CloudIcon} 云同步
        <button
          type="button"
          className={`switch${cfg.enabled ? ' on' : ''}`}
          role="switch"
          aria-checked={cfg.enabled}
          aria-label="启用云同步"
          onClick={() => void toggleEnabled()}
        />
      </h2>

      {cfg.enabled ? (
        <>
          <div className="setting-row">
            <div className="setting-info">
              <strong>存储类型</strong>
              <span>WebDAV（坚果云等）或 S3 兼容（MinIO / 各云厂商）</span>
            </div>
            <div className="seg small">
              <button
                type="button"
                className={cfg.provider === 'webdav' ? 'active' : ''}
                onClick={() => setCfg({ ...cfg, provider: 'webdav' })}
              >
                WebDAV
              </button>
              <button
                type="button"
                className={cfg.provider === 's3' ? 'active' : ''}
                onClick={() => setCfg({ ...cfg, provider: 's3' })}
              >
                S3 兼容
              </button>
            </div>
          </div>

          {cfg.provider === 'webdav' ? (
            <>
              <div className="setting-row column">
                <label htmlFor="cs-wd-url">服务器地址</label>
                <input id="cs-wd-url" className="grow" type="url" placeholder="https://dav.jianguoyun.com/dav" value={wd.url} onChange={(e) => setWd({ ...wd, url: e.target.value })} />
              </div>
              <div className="setting-row column">
                <label htmlFor="cs-wd-dir">远程目录</label>
                <input id="cs-wd-dir" className="grow" type="text" placeholder="墨纸" value={wd.dir} onChange={(e) => setWd({ ...wd, dir: e.target.value })} />
              </div>
              <div className="setting-row column">
                <label htmlFor="cs-wd-user">账号</label>
                <input id="cs-wd-user" className="grow" type="text" autoComplete="username" value={wd.username} onChange={(e) => setWd({ ...wd, username: e.target.value })} />
              </div>
              <div className="setting-row column">
                <label htmlFor="cs-wd-pwd">密码 / 应用密码</label>
                <input id="cs-wd-pwd" className="grow" type="password" autoComplete="current-password" placeholder={cfg.secretStored ? '已保存（留空则不修改）' : '未设置'} value={wd.password} onChange={(e) => setWd({ ...wd, password: e.target.value })} />
              </div>
            </>
          ) : (
            <>
              <div className="setting-row column">
                <label htmlFor="cs-s3-ep">Endpoint（自建 MinIO 必填）</label>
                <input id="cs-s3-ep" className="grow" type="url" placeholder="http://127.0.0.1:9000 或留空用 AWS 默认" value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} />
              </div>
              <div className="setting-row">
                <div className="setting-row column grow2">
                  <label htmlFor="cs-s3-bucket">Bucket</label>
                  <input id="cs-s3-bucket" className="grow" type="text" value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} />
                </div>
                <div className="setting-row column grow">
                  <label htmlFor="cs-s3-region">Region</label>
                  <input id="cs-s3-region" className="grow" type="text" placeholder="us-east-1" value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} />
                </div>
              </div>
              <div className="setting-row column">
                <label htmlFor="cs-s3-prefix">路径前缀（可选）</label>
                <input id="cs-s3-prefix" className="grow" type="text" placeholder="mozhi/" value={s3.prefix} onChange={(e) => setS3({ ...s3, prefix: e.target.value })} />
              </div>
              <div className="setting-row">
                <div className="setting-row column grow2">
                  <label htmlFor="cs-s3-ak">Access Key ID</label>
                  <input id="cs-s3-ak" className="grow" type="text" autoComplete="off" value={s3.accessKeyId} onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })} />
                </div>
                <div className="setting-row column grow2">
                  <label htmlFor="cs-s3-sk">Secret Access Key</label>
                  <input id="cs-s3-sk" className="grow" type="password" autoComplete="off" placeholder={cfg.secretStored ? '已保存（留空则不修改）' : '未设置'} value={s3.secret} onChange={(e) => setS3({ ...s3, secret: e.target.value })} />
                </div>
              </div>
            </>
          )}

          <div className="setting-row">
            <div className="setting-info">
              <strong>远端最新快照</strong>
              <span className="mono-path">
                {remote.state === 'loading' && '查询中…'}
                {remote.state === 'none' && '远端暂无快照'}
                {remote.state === 'err' && remote.msg}
                {remote.state === 'ok' && remote.m && `${fmtTime(remote.m.createdAt)} · ${remote.m.books} 本书 · ${remote.m.chapters} 章 · ${fmtBytes(remote.m.zipBytes)}`}
              </span>
            </div>
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

          <div className="setting-row">
            <div className="setting-info">
              <strong>手动同步</strong>
              <span>上传当前书库快照 / 用云端快照整体替换本地（原件文件不参与同步）</span>
              <span className="cloud-times">上次上传 {fmtTime(cfg.lastUploadAt)} · 上次下载 {fmtTime(cfg.lastDownloadAt)}</span>
            </div>
            <div className="dir-actions">
              <button type="button" className="btn ghost" disabled={uploading || downloading || applying} onClick={() => void upload()}>
                {UpIcon} {uploading ? '上传中…' : '上传快照'}
              </button>
              <button type="button" className="btn ghost" disabled={uploading || downloading || applying} onClick={() => void download()}>
                {DownIcon} {downloading ? '下载中…' : '从云端下载'}
              </button>
            </div>
          </div>

          {pending && (
            <div className="restore-confirm" role="alertdialog" aria-label="确认恢复云端快照">
              <strong>用云端快照替换本地数据？</strong>
              <p>
                云端（{fmtTime(pending.createdAt)}）：{pending.books} 本书 · {pending.articles} 篇文章 · {pending.chapters} 章 · {pending.sources} 个订阅源 · {pending.covers} 张封面 ·{' '}
                {fmtBytes(pending.zipBytes)}。当前本地数据会先自动备份一份，恢复后立即生效。
              </p>
              <div className="dir-actions">
                <button type="button" className="btn danger" disabled={applying} onClick={() => void apply()}>
                  {applying ? '恢复中…' : '应用恢复'}
                </button>
                <button type="button" className="btn ghost" onClick={discard}>
                  放弃
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="setting-row">
          <div className="setting-info">
            <strong>云端快照备份</strong>
            <span>开启后可配置 WebDAV 或 S3 兼容存储，手动上传 / 恢复书库快照</span>
          </div>
        </div>
      )}
    </section>
  )
}
