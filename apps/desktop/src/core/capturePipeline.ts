import { randomUUID } from 'node:crypto'
import { LOCAL_STORAGE_STOP_RATIO, LOCAL_STORAGE_WARN_RATIO } from '@screenvault/shared'
import type { LocalShot, ScreenshotQueue } from './queue.js'

export type RawDisplay = {
  displayId: string
  displayIndex: number
  displayName: string | null
  isPrimary: boolean
  scaleFactor: number
  png: Buffer
}

export type EncodedImage = {
  bytes: Buffer
  contentType: 'image/webp' | 'image/jpeg'
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

export type StorageLevel = 'ok' | 'warn' | 'stop'

export function storageLevel(usedBytes: number, maxBytes: number): StorageLevel {
  if (maxBytes <= 0) return 'stop'
  if (usedBytes >= maxBytes * LOCAL_STORAGE_STOP_RATIO) return 'stop'
  if (usedBytes >= maxBytes * LOCAL_STORAGE_WARN_RATIO) return 'warn'
  return 'ok'
}

function clipLabel(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function deletionCandidates(
  rows: LocalShot[],
  policy: { deleteAfterUpload: boolean; localRetentionDays: number },
  now: Date,
): LocalShot[] {
  const maxAge = policy.localRetentionDays * 24 * 60 * 60 * 1000
  return rows.filter((row) => {
    if (row.status !== 'UPLOADED' || !row.encryptedFilePath || !row.uploadedAt) return false
    if (policy.deleteAfterUpload) return true
    return now.getTime() - new Date(row.uploadedAt).getTime() >= maxAge
  })
}

export async function persistCapture(input: {
  monitoring: boolean
  locked: boolean
  pauseWhileLocked: boolean
  captureMode: 'ALL_DISPLAYS' | 'PRIMARY_ONLY'
  foregroundApp: string | null
  activeApp?: string | null
  activeWindow: string | null
  excludedApplications: string[]
  storageUsedBytes: number
  maxBytes: number
  displays: RawDisplay[]
  deviceId: string
  timezone: string
  workNote: string | null
  idle: boolean
  activeMs: number
  intervalMs: number
  now: Date
  encoder: (png: Buffer) => Promise<EncodedImage>
  encrypt: (plaintext: Buffer, screenshotId: string) => Buffer
  checksum: (plaintext: Buffer) => string
  redact?: (plaintext: Buffer) => Promise<Buffer>
  writeAtomic: (screenshotId: string, capturedAt: Date, bytes: Buffer) => Promise<string>
  queue: ScreenshotQueue
}): Promise<{
  saved: number
  skippedReason?: string
  captureEventId?: string
  level: StorageLevel
}> {
  const level = storageLevel(input.storageUsedBytes, input.maxBytes)
  if (!input.monitoring) return { saved: 0, skippedReason: 'monitoring_stopped', level }
  if (input.locked && input.pauseWhileLocked) return { saved: 0, skippedReason: 'locked', level }
  if (level === 'stop') return { saved: 0, skippedReason: 'quota', level }
  const excluded = new Set(input.excludedApplications.map((name) => name.toLowerCase()))
  if (input.foregroundApp && excluded.has(input.foregroundApp.toLowerCase())) {
    return { saved: 0, skippedReason: 'excluded_application', level }
  }
  const displays =
    input.captureMode === 'PRIMARY_ONLY'
      ? input.displays.filter((display) => display.isPrimary)
      : input.displays
  if (displays.length === 0) return { saved: 0, skippedReason: 'no_display', level }

  const captureEventId = randomUUID()
  let saved = 0
  for (const display of displays) {
    const screenshotId = randomUUID()
    const encoded = await input.encoder(display.png)
    const redacted = input.redact ? await input.redact(encoded.bytes) : encoded.bytes
    const checksum = input.checksum(redacted)
    const encrypted = input.encrypt(redacted, screenshotId)
    const filePath = await input.writeAtomic(screenshotId, input.now, encrypted)
    const row: LocalShot = {
      id: screenshotId,
      captureEventId,
      deviceId: input.deviceId,
      displayId: display.displayId,
      displayIndex: display.displayIndex,
      displayName: display.displayName,
      width: encoded.width,
      height: encoded.height,
      originalWidth: encoded.originalWidth,
      originalHeight: encoded.originalHeight,
      scaleFactor: display.scaleFactor,
      capturedAt: input.now.toISOString(),
      timezone: input.timezone,
      encryptedFilePath: filePath,
      encryptedSize: encrypted.length,
      plaintextSize: redacted.length,
      checksum,
      contentType: encoded.contentType,
      encryptionVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      lastAttemptAt: null,
      uploadedAt: null,
      serverScreenshotId: null,
      workNote: input.workNote,
      activeApp: clipLabel(input.activeApp ?? input.foregroundApp, 128),
      activeWindow: clipLabel(input.activeWindow, 300),
      idle: input.idle,
      activeMs: Math.max(0, Math.round(input.activeMs)),
      intervalMs: Math.max(0, Math.round(input.intervalMs)),
      failureCode: null,
      createdAt: input.now.toISOString(),
    }
    input.queue.insert(row)
    saved += 1
  }
  return { saved, captureEventId, level }
}
