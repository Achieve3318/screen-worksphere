import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface StoredObject {
  body: Buffer
  contentType: string
}

export interface ScreenshotStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>
}

export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.startsWith('\\') ||
    path.isAbsolute(key)
  ) {
    throw new Error('Invalid storage key.')
  }
}

export function originalObjectKey(organizationId: string, screenshotId: string): string {
  return `orgs/${organizationId}/originals/${screenshotId}`
}

export function thumbnailObjectKey(organizationId: string, screenshotId: string): string {
  return `orgs/${organizationId}/thumbnails/${screenshotId}.webp`
}

type SignerPayload = { key: string; exp: number }

export function signStorageToken(payload: SignerPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyStorageToken(token: string, secret: string): SignerPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignerPayload
    if (typeof payload.key !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    assertSafeKey(payload.key)
    return payload
  } catch {
    return null
  }
}

export class LocalFilesystemStorage implements ScreenshotStorage {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
    private readonly signingSecret: string,
  ) {}

  private resolve(key: string): string {
    assertSafeKey(key)
    const full = path.resolve(this.root, key)
    const root = path.resolve(this.root)
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error('Invalid storage key.')
    }
    return full
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const full = this.resolve(key)
    await mkdir(path.dirname(full), { recursive: true })
    const temporary = `${full}.${randomUUID()}.tmp`
    await writeFile(temporary, body)
    await writeFile(`${full}.content-type`, contentType)
    const { rename } = await import('node:fs/promises')
    await rename(temporary, full)
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key)
    try {
      const [body, contentType] = await Promise.all([
        readFile(full),
        readFile(`${full}.content-type`, 'utf8').catch(() => 'application/octet-stream'),
      ])
      return { body, contentType }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key)
    await rm(full, { force: true })
    await rm(`${full}.content-type`, { force: true })
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }

  async getSignedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key)
    const token = signStorageToken(
      { key, exp: Math.floor(Date.now() / 1000) + ttlSeconds },
      this.signingSecret,
    )
    return `${this.publicBaseUrl}/api/v1/media/${token}`
  }
}

export class MemoryStorage implements ScreenshotStorage {
  readonly objects = new Map<string, StoredObject>()

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key)
    this.objects.set(key, { body: Buffer.from(body), contentType })
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key)
    const found = this.objects.get(key)
    return found ? { body: Buffer.from(found.body), contentType: found.contentType } : null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key)
  }

  async getSignedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key)
    return `memory://${key}?ttl=${ttlSeconds}`
  }
}

export class S3CompatibleStorage implements ScreenshotStorage {
  private readonly client: S3Client

  constructor(
    private readonly config: {
      endpoint?: string
      region: string
      bucket: string
      accessKeyId: string
      secretAccessKey: string
      forcePathStyle: boolean
    },
  ) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key)
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )
      const bytes = await result.Body?.transformToByteArray()
      if (!bytes) return null
      return {
        body: Buffer.from(bytes),
        contentType: result.ContentType ?? 'application/octet-stream',
      }
    } catch (error) {
      if (isMissingS3(error)) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key)
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return true
    } catch (error) {
      if (isMissingS3(error)) return false
      throw error
    }
  }

  async getSignedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key)
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    )
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isMissingS3(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? String(error.name) : ''
  const status =
    '$metadata' in error &&
    error.$metadata &&
    typeof error.$metadata === 'object' &&
    'httpStatusCode' in error.$metadata
      ? Number(error.$metadata.httpStatusCode)
      : 0
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404
}
