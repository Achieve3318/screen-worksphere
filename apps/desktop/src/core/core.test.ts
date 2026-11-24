import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { decryptScreenshot, encryptScreenshot, screenshotAad, sha256Hex } from '@screenvault/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveActivity } from './activity.js'
import { policyTransition } from './desktopState.js'
import { deletionCandidates, persistCapture, storageLevel } from './capturePipeline.js'
import { ScreenshotQueue, type LocalShot } from './queue.js'
import { runUpload, UploadHttpError, type UploadTransport } from './uploader.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sv-desktop-'))
  directories.push(dir)
  return dir
}

function sampleRow(overrides: Partial<LocalShot> = {}): LocalShot {
  return {
    id: randomUUID(),
    captureEventId: randomUUID(),
    deviceId: randomUUID(),
    displayId: 'd1',
    displayIndex: 0,
    displayName: 'Primary',
    width: 2,
    height: 2,
    originalWidth: 2,
    originalHeight: 2,
    scaleFactor: 1,
    capturedAt: new Date().toISOString(),
    timezone: 'UTC',
    encryptedFilePath: null,
    encryptedSize: 10,
    plaintextSize: 4,
    checksum: sha256Hex(Buffer.from('shot')),
    contentType: 'image/webp',
    encryptionVersion: 1,
    status: 'PENDING',
    retryCount: 0,
    lastAttemptAt: null,
    uploadedAt: null,
    serverScreenshotId: null,
    workNote: null,
    activeApp: null,
    activeWindow: null,
    idle: false,
    activeMs: 60_000,
    intervalMs: 60_000,
    failureCode: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('organization policy', () => {
  it('stops capture when the organization turns it off and reschedules when the interval changes', () => {
    expect(
      policyTransition(
        { captureEnabled: true, screenshotIntervalSeconds: 60 },
        { captureEnabled: false, screenshotIntervalSeconds: 60 },
        true,
      ),
    ).toEqual({ stop: true, reschedule: false })
    expect(
      policyTransition(
        { captureEnabled: true, screenshotIntervalSeconds: 60 },
        { captureEnabled: true, screenshotIntervalSeconds: 30 },
        true,
      ),
    ).toEqual({ stop: false, reschedule: true })
    expect(
      policyTransition(null, { captureEnabled: true, screenshotIntervalSeconds: 30 }, false),
    ).toEqual({ stop: false, reschedule: false })
  })
})

describe('activity', () => {
  it('prefers upload and offline over a quiet monitoring state', () => {
    expect(
      deriveActivity({
        uploading: true,
        syncing: false,
        online: false,
        uploadFailed: false,
        pending: 1,
        capturing: true,
        monitoring: true,
      }),
    ).toBe('uploading')
    expect(
      deriveActivity({
        uploading: false,
        syncing: false,
        online: false,
        uploadFailed: false,
        pending: 4,
        capturing: false,
        monitoring: true,
      }),
    ).toBe('offline')
    expect(
      deriveActivity({
        uploading: false,
        syncing: false,
        online: true,
        uploadFailed: false,
        pending: 0,
        capturing: false,
        monitoring: true,
      }),
    ).toBe('up_to_date')
  })
})

describe('local queue and capture', () => {
  it('recovers interrupted uploads and refuses capture while stopped or over quota', async () => {
    const queue = ScreenshotQueue.open(':memory:')
    const row = sampleRow({ status: 'UPLOADING' })
    queue.insert(row)
    expect(queue.recoverInterrupted()).toBe(1)
    expect(queue.get(row.id)?.status).toBe('PENDING')

    const stopped = await persistCapture({
      monitoring: false,
      locked: false,
      pauseWhileLocked: true,
      captureMode: 'ALL_DISPLAYS',
      foregroundApp: null,
      activeWindow: null,
      excludedApplications: [],
      storageUsedBytes: 0,
      maxBytes: 1000,
      displays: [],
      deviceId: row.deviceId,
      timezone: 'UTC',
      workNote: null,
      idle: false,
      activeMs: 60_000,
      intervalMs: 60_000,
      now: new Date(),
      encoder: async () => {
        throw new Error('should not encode')
      },
      encrypt: () => Buffer.from('no'),
      checksum: () => '00',
      writeAtomic: async () => 'nope',
      queue,
    })
    expect(stopped.skippedReason).toBe('monitoring_stopped')
    expect(storageLevel(960, 1000)).toBe('stop')
    queue.close()
  })

  it('stores one encrypted file per display under a shared capture event', async () => {
    const dir = await tempDir()
    const queue = ScreenshotQueue.open(path.join(dir, 'local.sqlite'))
    const key = randomBytes(32)
    const now = new Date('2026-10-01T12:00:00.000Z')
    const result = await persistCapture({
      monitoring: true,
      locked: false,
      pauseWhileLocked: true,
      captureMode: 'ALL_DISPLAYS',
      foregroundApp: 'Code',
      activeWindow: 'ScreenVault — README.md',
      excludedApplications: ['1Password'],
      storageUsedBytes: 10,
      maxBytes: 50_000_000,
      displays: [
        {
          displayId: 'a',
          displayIndex: 0,
          displayName: 'Left',
          isPrimary: true,
          scaleFactor: 1.25,
          png: Buffer.from('left'),
        },
        {
          displayId: 'b',
          displayIndex: 1,
          displayName: 'Right',
          isPrimary: false,
          scaleFactor: 1,
          png: Buffer.from('right'),
        },
      ],
      deviceId: randomUUID(),
      timezone: 'Asia/Shanghai',
      workNote: 'Spec review',
      idle: false,
      activeMs: 20_000,
      intervalMs: 60_000,
      now,
      encoder: async (png) => ({
        bytes: png,
        contentType: 'image/webp',
        width: 8,
        height: 8,
        originalWidth: 16,
        originalHeight: 16,
      }),
      encrypt: (plaintext, screenshotId) =>
        encryptScreenshot(plaintext, key, screenshotAad(screenshotId)),
      checksum: sha256Hex,
      writeAtomic: async (screenshotId, capturedAt, bytes) => {
        const file = path.join(
          dir,
          `${capturedAt.toISOString().slice(0, 10)}-${screenshotId}.svault`,
        )
        await writeFile(file, bytes)
        return file
      },
      queue,
    })
    expect(result.saved).toBe(2)
    const rows = queue.listEligible()
    expect(rows[0]?.activeMs).toBe(20_000)
    expect(rows[0]?.intervalMs).toBe(60_000)
    expect(new Set(rows.map((item) => item.captureEventId)).size).toBe(1)
    expect(rows[0]?.activeApp).toBe('Code')
    expect(rows[0]?.activeWindow).toBe('ScreenVault — README.md')
    const file = await readFile(rows[0]!.encryptedFilePath!)
    expect(file.subarray(0, 7).toString('utf8')).toBe('SVAULT1')
    expect(file.includes(Buffer.from('left')) || file.includes(Buffer.from('right'))).toBe(false)
    const plain = decryptScreenshot(file, key, screenshotAad(rows[0]!.id))
    expect(['left', 'right']).toContain(plain.toString('utf8'))
    const uploaded = sampleRow({
      status: 'UPLOADED',
      encryptedFilePath: rows[0]!.encryptedFilePath,
      uploadedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(
      deletionCandidates([uploaded], { deleteAfterUpload: false, localRetentionDays: 14 }, now),
    ).toHaveLength(1)
    expect(
      deletionCandidates([sampleRow()], { deleteAfterUpload: true, localRetentionDays: 14 }, now),
    ).toHaveLength(0)
    queue.close()
  })
})

describe('uploader', () => {
  it('uploads with bounded concurrency, refreshes once on 401, and keeps the queue intact when cancelled', async () => {
    const queue = ScreenshotQueue.open(':memory:')
    const key = randomBytes(32)
    const rows = [sampleRow(), sampleRow(), sampleRow()]
    for (const row of rows) {
      const encrypted = encryptScreenshot(Buffer.from('shot'), key, screenshotAad(row.id))
      row.checksum = sha256Hex(Buffer.from('shot'))
      row.plaintextSize = 4
      row.encryptedSize = encrypted.length
      row.encryptedFilePath = row.id
      queue.insert(row)
    }
    let inFlight = 0
    let maxInFlight = 0
    let refreshes = 0
    let unauthorized = true
    const transport: UploadTransport = {
      async createSession(items) {
        return {
          items: items.map((item, index) => ({
            screenshotId: String(item.screenshotId),
            status: index === 0 ? 'already_stored' : 'accepted',
          })),
        }
      },
      async putContent() {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 30))
        inFlight -= 1
        if (unauthorized) {
          unauthorized = false
          throw new UploadHttpError(401)
        }
      },
      async complete() {
        return undefined
      },
      async refreshAuth() {
        refreshes += 1
      },
    }
    const first = await runUpload({
      queue,
      transport,
      decrypt: (encrypted, id) => decryptScreenshot(encrypted, key, screenshotAad(id)),
      readFile: async (filePath) =>
        encryptScreenshot(Buffer.from('shot'), key, screenshotAad(filePath)),
      signal: new AbortController().signal,
      concurrency: 2,
      sleep: async () => undefined,
    })
    expect(first.uploaded).toBe(3)
    expect(refreshes).toBe(1)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(queue.pendingSummary().count).toBe(0)

    const extra = sampleRow()
    const encrypted = encryptScreenshot(Buffer.from('shot'), key, screenshotAad(extra.id))
    extra.checksum = sha256Hex(Buffer.from('shot'))
    extra.encryptedFilePath = extra.id
    extra.encryptedSize = encrypted.length
    queue.insert(extra)
    const controller = new AbortController()
    const hanging: UploadTransport = {
      async createSession() {
        controller.abort()
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
      },
      async putContent() {
        return undefined
      },
      async complete() {
        return undefined
      },
      async refreshAuth() {
        return undefined
      },
    }
    const cancelled = await runUpload({
      queue,
      transport: hanging,
      decrypt: (bytes, id) => decryptScreenshot(bytes, key, screenshotAad(id)),
      readFile: async () => encrypted,
      signal: controller.signal,
      sleep: async () => undefined,
    })
    expect(cancelled.cancelled).toBe(true)
    expect(queue.get(extra.id)?.status).toBe('PENDING')
    queue.close()
  })

  it('sends upload sessions in batches of 50', async () => {
    const queue = ScreenshotQueue.open(':memory:')
    for (let index = 0; index < 51; index += 1) queue.insert(sampleRow())
    const sizes: number[] = []
    const uploaded = await runUpload({
      queue,
      transport: {
        async createSession(items) {
          sizes.push(items.length)
          return {
            items: items.map((item) => ({
              screenshotId: String(item.screenshotId),
              status: 'already_stored' as const,
            })),
          }
        },
        async putContent() {
          return undefined
        },
        async complete() {
          return undefined
        },
        async refreshAuth() {
          return undefined
        },
      },
      decrypt: (bytes) => bytes,
      readFile: async () => Buffer.from('unused'),
      signal: new AbortController().signal,
      sleep: async () => undefined,
    })
    expect(sizes).toEqual([50, 1])
    expect(uploaded.uploaded).toBe(51)
    expect(queue.pendingSummary().count).toBe(0)
    queue.close()
  })

  it('ignores deleted screenshots and another account’s queue', () => {
    const queue = ScreenshotQueue.open(':memory:')
    const mine = sampleRow({ deviceId: 'daniel', plaintextSize: 20, encryptedSize: 30 })
    const deleted = sampleRow({
      deviceId: 'daniel',
      status: 'FAILED',
      failureCode: 'missing_file',
      plaintextSize: 900,
      encryptedFilePath: 'gone.svault',
    })
    const other = sampleRow({
      deviceId: 'angel',
      plaintextSize: 500,
      encryptedFilePath: 'angel.svault',
    })
    queue.insert(mine)
    queue.insert(deleted)
    queue.insert(other)
    expect(queue.pendingSummary()).toEqual({ count: 2, bytes: 520 })
    expect(queue.discardOtherDevices('daniel')).toEqual(['angel.svault'])
    expect(queue.pendingSummary()).toEqual({ count: 1, bytes: 20 })
    expect(queue.get(other.id)).toBeNull()
    queue.close()
  })
})
