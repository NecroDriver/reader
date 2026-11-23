/**
 * 云快照存储层：可插拔 provider（WebDAV / S3 兼容），统一的极小接口。
 * - WebDAV：适配坚果云等标准 WebDAV 服务（Basic Auth，PUT/GET/PROPFIND/MKCOL）。
 * - S3：AWS S3 / MinIO / Cloudflare R2 / 阿里 OSS S3 兼容端点（SigV4 由官方 SDK 处理）。
 * 凭据中的口令/密钥不进本模块的配置结构（由 cloudSync 单独落盘加密），此处只收拼装好的完整凭据。
 */
import { net } from 'electron'

export type CloudProviderType = 'webdav' | 's3'

export interface WebdavConfig {
  url: string
  dir: string
  username: string
}

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
}

export interface CloudConfig {
  provider: CloudProviderType
  webdav?: WebdavConfig
  s3?: S3Config
}

export interface CloudSecrets {
  webdavPassword: string
  s3SecretAccessKey: string
}

export interface CloudProvider {
  /** 连通性 + 权限检查，成功返回人类可读的确认信息 */
  test(): Promise<string>
  put(name: string, data: Buffer): Promise<void>
  get(name: string): Promise<Buffer>
}

export const EMPTY_SECRETS: CloudSecrets = { webdavPassword: '', s3SecretAccessKey: '' }

/* ---------------- WebDAV ---------------- */

class WebdavProvider implements CloudProvider {
  private readonly base: string
  private readonly auth: string

  constructor(cfg: WebdavConfig, password: string) {
    let url = cfg.url.trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    url = url.replace(/\/+$/, '')
    const dir = cfg.dir.trim().replace(/^\/+|\/+$/g, '')
    this.base = dir ? `${url}/${dir.split('/').map(encodeURIComponent).join('/')}` : url
    this.auth = 'Basic ' + Buffer.from(`${cfg.username.trim()}:${password}`).toString('base64')
  }

  private url(name: string): string {
    return `${this.base}/${encodeURIComponent(name)}`
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    /* 上传/下载快照可能明显大于一次试探请求，给足超时；试探类请求走短超时 */
    const isBody = init.method === 'PUT' || init.method === 'GET'
    return net.fetch(url, { ...init, signal: AbortSignal.timeout(isBody ? 120000 : 20000) })
  }

  async test(): Promise<string> {
    /* 先探测目录，404 则尝试创建 */
    let res: Response
    try {
      res = await this.request(this.base, {
        method: 'PROPFIND',
        headers: { Authorization: this.auth, Depth: '0' }
      })
    } catch (e) {
      throw new Error('无法连接：' + ((e as Error).message || '网络错误'))
    }
    if (res.status === 404) {
      const mk = await this.request(this.base, { method: 'MKCOL', headers: { Authorization: this.auth } })
      if (!mk.ok) throw new Error(`目录不存在且无法创建（HTTP ${mk.status}）`)
      return '连接正常，已创建远程目录'
    }
    if (res.status === 401) throw new Error('认证失败：账号或应用密码不正确（HTTP 401）')
    if (!res.ok && res.status !== 207) throw new Error(`连接失败（HTTP ${res.status}）`)
    return '连接正常'
  }

  async put(name: string, data: Buffer): Promise<void> {
    const res = await this.request(this.url(name), {
      method: 'PUT',
      headers: { Authorization: this.auth, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data)
    })
    if (!res.ok) throw new Error(`上传失败（HTTP ${res.status}）`)
  }

  async get(name: string): Promise<Buffer> {
    const res = await this.request(this.url(name), { method: 'GET', headers: { Authorization: this.auth } })
    if (res.status === 404) throw new Error('NOT_FOUND')
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
    return Buffer.from(await res.arrayBuffer())
  }
}

/* ---------------- S3 兼容 ---------------- */

class S3Provider implements CloudProvider {
  // 动态 import，避免渲染进程无关路径被早早拉起；类型在编译期保留
  constructor(
    private readonly cfg: S3Config,
    private readonly secretKey: string
  ) {}

  private client(): Promise<import('@aws-sdk/client-s3').S3Client> {
    return (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const endpoint = this.cfg.endpoint.trim()
      return new S3Client({
        region: this.cfg.region.trim() || 'us-east-1',
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint /* 自定义端点(MinIO/R2/oss)默认路径风格 */,
        credentials: { accessKeyId: this.cfg.accessKeyId.trim(), secretAccessKey: this.secretKey }
      })
    })()
  }

  private key(name: string): string {
    const prefix = this.cfg.prefix.trim().replace(/^\/+|\/+$/g, '')
    return prefix ? `${prefix}/${name}` : name
  }

  async test(): Promise<string> {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3')
    try {
      const c = await this.client()
      await c.send(new HeadBucketCommand({ Bucket: this.cfg.bucket.trim() }))
      return 'Bucket 可访问'
    } catch (e) {
      const err = e as Error & { name?: string; '$metadata'?: { httpStatusCode?: number } }
      const code = err.name || ''
      const http = err.$metadata?.httpStatusCode
      if (http === 404 || code === 'NotFound') throw new Error('Bucket 不存在或无权限（404）')
      if (http === 403 || code === 'AccessDenied' || code === 'SignatureDoesNotMatch') {
        throw new Error('认证失败：AccessKey / SecretKey 不正确（403）')
      }
      if (code === 'UnknownEndpoint' || code === 'EndpointProviderError' || /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(err.message)) {
        throw new Error('无法连接端点：' + (this.cfg.endpoint || '默认 AWS 端点'))
      }
      throw new Error('连接失败：' + (err.message || code || '未知错误'))
    }
  }

  async put(name: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    await c.send(new PutObjectCommand({ Bucket: this.cfg.bucket.trim(), Key: this.key(name), Body: new Uint8Array(data) }))
  }

  async get(name: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    try {
      const res = await c.send(new GetObjectCommand({ Bucket: this.cfg.bucket.trim(), Key: this.key(name) }))
      const bytes = await res.Body?.transformToByteArray()
      if (!bytes) throw new Error('下载内容为空')
      return Buffer.from(bytes)
    } catch (e) {
      const err = e as Error & { name?: string; '$metadata'?: { httpStatusCode?: number } }
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) throw new Error('NOT_FOUND')
      throw new Error('下载失败：' + (err.message || err.name || '未知错误'))
    }
  }
}

/* ---------------- 工厂 + 校验 ---------------- */

export function makeProvider(cfg: CloudConfig, secrets: CloudSecrets): CloudProvider {
  if (cfg.provider === 'webdav') {
    const w = cfg.webdav
    if (!w?.url.trim()) throw new Error('请填写 WebDAV 服务器地址')
    if (!w.username.trim()) throw new Error('请填写账号')
    if (!secrets.webdavPassword) throw new Error('请填写应用密码 / 密码')
    return new WebdavProvider(w, secrets.webdavPassword)
  }
  if (cfg.provider === 's3') {
    const s = cfg.s3
    if (!s?.bucket.trim()) throw new Error('请填写 Bucket 名称')
    if (!s.accessKeyId.trim()) throw new Error('请填写 AccessKeyId')
    if (!secrets.s3SecretAccessKey) throw new Error('请填写 SecretAccessKey')
    return new S3Provider(s, secrets.s3SecretAccessKey)
  }
  throw new Error('未选择存储类型')
}
