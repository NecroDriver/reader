import { useEffect, useState } from 'react'
import SliderSwitch from './SliderSwitch'

interface LanCfg {
  enabled: boolean
  port: number
  lanIp: string
  running: boolean
  devices: { id: string; name: string; createdAt: number; lastSyncAt: number }[]
}
interface PairView {
  ip: string
  port: number
  code: string
  expiresAt: number
  qrSvg: string
  payload: string
}

const DeviceIcon = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2.5" width="8" height="15" rx="1.5" /><path d="M9 15h2" /></svg>
)

const fmtTime = (ms: number): string => {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return String(ms)
  }
}

/** 设置页「设备同步」组：局域网直连手机（扫码配对 → 行级增量同步，无需任何云服务）。 */
export default function LanSyncPanel({ onChanged }: { onChanged?: (msg: string) => void }) {
  const [cfg, setCfg] = useState<LanCfg | null>(null)
  const [pair, setPair] = useState<PairView | null>(null)
  const [pairing, setPairing] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const load = (): void => {
    void (async () => {
      const c = (await window.mozhi.getLanConfig()) as LanCfg
      setCfg(c)
    })()
  }
  useEffect(() => {
    load()
  }, [])

  /* 配对码倒计时 */
  useEffect(() => {
    if (!pair) return
    const t = setInterval(() => {
      setCountdown(Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)))
    }, 1000)
    setCountdown(Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)))
    return () => clearInterval(t)
  }, [pair])

  /* 设备出现后自动刷新列表（简化：配对激活期间轮询） */
  useEffect(() => {
    if (!pair) return
    const t = setInterval(() => {
      void (async () => {
        const c = (await window.mozhi.getLanConfig()) as LanCfg
        if (c.devices.length > (cfg?.devices.length ?? 0)) {
          setCfg(c)
          setPair(null)
          onChanged?.(`配对成功：${c.devices[c.devices.length - 1]?.name ?? '新设备'}`)
        }
      })()
    }, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, cfg?.devices.length])

  if (!cfg || !window.mozhi) return null

  const toggleEnabled = async (): Promise<void> => {
    const next = !cfg.enabled
    const c = (await window.mozhi.saveLanConfig({ enabled: next })) as LanCfg
    setCfg(c)
    setPair(null)
    onChanged?.(next ? `设备同步已开启（${c.lanIp}:${c.port}）` : '设备同步已关闭')
  }

  const startPair = async (): Promise<void> => {
    setPairing(true)
    const p = (await window.mozhi.startLanPair()) as PairView
    setPairing(false)
    setPair(p)
  }

  const revoke = async (id: string): Promise<void> => {
    const c = (await window.mozhi.revokeLanDevice(id)) as LanCfg
    setCfg(c)
    onChanged?.('已移除该设备的同步权限')
  }

  return (
    <section className="settings-group">
      <p className="group-eyebrow">DEVICE SYNC · 设备同步</p>
      <h2>
        {DeviceIcon} 设备同步
        <SliderSwitch checked={cfg.enabled} onChange={() => void toggleEnabled()} label="启用局域网设备同步" />
      </h2>

      {cfg.enabled ? (
        <>
          <div className="setting-row">
            <div className="setting-info">
              <strong>本机同步地址</strong>
              <span className="mono-path">
                {cfg.lanIp}:{cfg.port}
                {cfg.running ? '' : '（服务未运行，保存配置后重试）'}
              </span>
              <span>手机与电脑连同一 Wi-Fi，在手机 App「设置 · 设备同步」扫码配对</span>
            </div>
            <div className="dir-actions">
              <button type="button" className="btn primary" disabled={pairing} onClick={() => void startPair()}>
                {pairing ? '生成中…' : '配对新设备'}
              </button>
            </div>
          </div>

          {pair && (
            <div className="pair-card" role="group" aria-label="设备配对">
              <div className="pair-left">
                <div
                  className="pair-qr"
                  /* qrcode 库生成的受控 SVG（本机生成，非远端内容） */
                  dangerouslySetInnerHTML={{ __html: pair.qrSvg || '<svg/>' }}
                />
              </div>
              <div className="pair-right">
                <strong>手机扫码配对</strong>
                <p className="pair-hint">或手动输入六位数字码</p>
                <p className="pair-code" aria-label="配对数字码">{pair.code}</p>
                <p className="pair-countdown">{countdown > 0 ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')} 后失效` : '已过期，请重新生成'}</p>
              </div>
            </div>
          )}

          <div className="setting-row column">
            <label className="setting-info-label">已配对设备（{cfg.devices.length}）</label>
            {cfg.devices.length === 0 ? (
              <p className="pair-hint">还没有配对设备——点上方「配对新设备」开始。</p>
            ) : (
              <ul className="device-list">
                {cfg.devices.map((d) => (
                  <li key={d.id} className="device-row">
                    <div className="setting-info">
                      <strong>{d.name}</strong>
                      <span>配对于 {fmtTime(d.createdAt)} · 最后同步 {fmtTime(d.lastSyncAt)}</span>
                    </div>
                    <button type="button" className="btn ghost danger" onClick={() => void revoke(d.id)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="setting-row">
            <div className="setting-info">
              <strong>同步规则</strong>
              <span>电脑是书架的唯一权威：加书 / 删书 / 抓更新只在电脑上做；手机推送阅读进度，按书以较新时间为准</span>
            </div>
          </div>
        </>
      ) : (
        <div className="setting-row">
          <div className="setting-info">
            <strong>手机直连同步</strong>
            <span>开启后，手机 App 在同一局域网内扫码配对，直接与电脑同步书库与进度（不经任何云服务）</span>
          </div>
        </div>
      )}
    </section>
  )
}
