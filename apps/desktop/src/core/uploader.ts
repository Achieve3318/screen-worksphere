import {
  backoffMs,
  classifyHttpStatus,
  sha256Hex,
  UPLOAD_CONCURRENCY,
  UPLOAD_SESSION_ITEM_LIMIT,
} from '@screenvault/shared'
import type { LocalShot, ScreenshotQueue } from './queue.js'

export class UploadHttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`)
    this.name = 'UploadHttpError'
  }
}

export type UploadItemResult = {
  screenshotId: string
  status: 'accepted' | 'already_stored' | 'awaiting_complete'
}

export type UploadTransport = {
  createSession(items: Record<string, unknown>[]): Promise<{ items: UploadItemResult[] }>
  putContent(
    id: string,
    bytes: Buffer,
    checksum: string,
    contentType: string,
    signal: AbortSignal,
  ): Promise<void>
  complete(id: string, checksum: string, signal: AbortSignal): Promise<void>
  refreshAuth(): Promise<void>
}

export type UploadProgress = {
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
}

const PERMANENT = new Set(['integrity', 'too_large', 'conflict', 'missing_file', 'forbidden'])

export async function runUpload(options: {
  queue: ScreenshotQueue
  transport: UploadTransport
  decrypt: (encrypted: Buffer, screenshotId: string) => Buffer
  readFile: (filePath: string) => Promise<Buffer>
  signal: AbortSignal
  concurrency?: number
  sleep?: (ms: number) => Promise<void>
  onProgress?: (progress: UploadProgress) => void
}): Promise<{ uploaded: number; failed: number; cancelled: boolean; revoked: boolean }> {
  const rows = options.queue.listEligible()
  const progress: UploadProgress = {
    completedFiles: 0,
    totalFiles: rows.length,
    completedBytes: 0,
    totalBytes: rows.reduce((sum, row) => sum + row.encryptedSize, 0),
  }
  options.onProgress?.(progress)
  if (rows.length === 0) return { uploaded: 0, failed: 0, cancelled: false, revoked: false }

  let uploaded = 0
  let failed = 0
  let revoked = false
  for (let offset = 0; offset < rows.length; offset += UPLOAD_SESSION_ITEM_LIMIT) {
    if (options.signal.aborted) break
    const chunk = rows.slice(offset, offset + UPLOAD_SESSION_ITEM_LIMIT)
    const chunkResult = await uploadChunk(chunk, options, progress)
    uploaded += chunkResult.uploaded
    failed += chunkResult.failed
    if (chunkResult.revoked || chunkResult.cancelled) {
      return {
        uploaded,
        failed,
        cancelled: chunkResult.cancelled,
        revoked: chunkResult.revoked,
      }
    }
  }
  return { uploaded, failed, cancelled: options.signal.aborted, revoked }
}

async function uploadChunk(
  rows: LocalShot[],
  options: {
    queue: ScreenshotQueue
    transport: UploadTransport
    decrypt: (encrypted: Buffer, screenshotId: string) => Buffer
    readFile: (filePath: string) => Promise<Buffer>
    signal: AbortSignal
    concurrency?: number
    sleep?: (ms: number) => Promise<void>
    onProgress?: (progress: UploadProgress) => void
  },
  progress: UploadProgress,
): Promise<{ uploaded: number; failed: number; cancelled: boolean; revoked: boolean }> {
  let session: { items: UploadItemResult[] }
  try {
    session = await withRetry(
      () => options.transport.createSession(rows.map(toSessionItem)),
      options,
    )
  } catch (error) {
    if (isSessionExpired(error)) throw error
    if (isAbort(error) || options.signal.aborted)
      return { uploaded: 0, failed: 0, cancelled: true, revoked: false }
    if (error instanceof UploadHttpError && error.status === 403) {
      return { uploaded: 0, failed: rows.length, cancelled: false, revoked: true }
    }
    for (const row of rows) options.queue.markFailed(row.id, 'network')
    return { uploaded: 0, failed: rows.length, cancelled: false, revoked: false }
  }

  const byId = new Map(session.items.map((item) => [item.screenshotId, item.status]))
  let uploaded = 0
  let failed = 0
  let revoked = false
  let cursor = 0
  const workerCount = Math.min(options.concurrency ?? UPLOAD_CONCURRENCY, rows.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (!options.signal.aborted && !revoked) {
      const index = cursor
      cursor += 1
      const row = rows[index]
      if (!row) return
      options.queue.markUploading(row.id, new Date().toISOString())
      try {
        const status = byId.get(row.id) ?? 'accepted'
        if (status !== 'already_stored') {
          if (!row.encryptedFilePath) throw new UploadHttpError(422)
          const encrypted = await options.readFile(row.encryptedFilePath)
          const plaintext = options.decrypt(encrypted, row.id)
          if (sha256Hex(plaintext) !== row.checksum) {
            options.queue.markFailed(row.id, 'integrity')
            failed += 1
            continue
          }
          if (status === 'accepted') {
            await withRetry(
              () =>
                options.transport.putContent(
                  row.id,
                  plaintext,
                  row.checksum,
                  row.contentType,
                  options.signal,
                ),
              options,
            )
          }
          await withRetry(
            () => options.transport.complete(row.id, row.checksum, options.signal),
            options,
          )
        }
        options.queue.markUploaded(row.id, new Date().toISOString())
        uploaded += 1
        progress.completedFiles += 1
        progress.completedBytes += row.encryptedSize
        options.onProgress?.(progress)
      } catch (error) {
        if (isAbort(error) || options.signal.aborted) {
          options.queue.markPending(row.id)
          return
        }
        if (error instanceof UploadHttpError && error.status === 403) {
          options.queue.markPending(row.id)
          revoked = true
          return
        }
        const code = failureCode(error)
        options.queue.markFailed(row.id, code)
        failed += 1
        progress.completedFiles += 1
        options.onProgress?.(progress)
      }
    }
  })

  await Promise.all(workers)
  if (options.signal.aborted) {
    for (const row of rows) options.queue.markPending(row.id)
  }
  return { uploaded, failed, cancelled: options.signal.aborted, revoked }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    transport: UploadTransport
    signal: AbortSignal
    sleep?: (ms: number) => Promise<void>
  },
): Promise<T> {
  let refreshed = false
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (options.signal.aborted) throw abortError()
    try {
      return await operation()
    } catch (error) {
      if (isAbort(error) || options.signal.aborted) throw abortError()
      if (isSessionExpired(error)) throw error
      if (!(error instanceof UploadHttpError)) {
        if (attempt === 5) throw error
        await (options.sleep ?? delay)(backoffMs(attempt))
        continue
      }
      const kind = classifyHttpStatus(error.status)
      if (kind === 'auth' && !refreshed) {
        refreshed = true
        await options.transport.refreshAuth()
        continue
      }
      if (kind === 'forbidden' || kind === 'too_large' || kind === 'conflict' || kind === 'fatal')
        throw error
      if (attempt === 5) throw error
      await (options.sleep ?? delay)(backoffMs(attempt))
    }
  }
  throw new UploadHttpError(500)
}

function toSessionItem(row: LocalShot): Record<string, unknown> {
  return {
    screenshotId: row.id,
    captureEventId: row.captureEventId,
    displayId: row.displayId,
    displayIndex: row.displayIndex,
    displayName: row.displayName,
    width: row.width,
    height: row.height,
    originalWidth: row.originalWidth,
    originalHeight: row.originalHeight,
    scaleFactor: row.scaleFactor,
    fileSize: row.plaintextSize,
    checksum: row.checksum,
    contentType: row.contentType,
    capturedAt: row.capturedAt,
    timezone: row.timezone,
    workNote: row.workNote,
    activeApp: row.activeApp,
    activeWindow: row.activeWindow,
    idle: row.idle,
    activeMs: row.activeMs,
    intervalMs: row.intervalMs,
    encryptionVersion: row.encryptionVersion,
  }
}

function failureCode(error: unknown): string {
  if (error instanceof UploadHttpError) {
    const kind = classifyHttpStatus(error.status)
    if (kind === 'too_large') return 'too_large'
    if (kind === 'conflict') return 'conflict'
    if (kind === 'forbidden') return 'forbidden'
    return 'network'
  }
  return 'network'
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof Error && error.name === 'SessionExpiredError'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('Upload cancelled')
  error.name = 'AbortError'
  return error
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const permanentFailureCodes = PERMANENT
