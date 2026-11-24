import { DatabaseSync } from 'node:sqlite'

export type LocalStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED'

export type LocalShot = {
  id: string
  captureEventId: string
  deviceId: string
  displayId: string
  displayIndex: number
  displayName: string | null
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  scaleFactor: number
  capturedAt: string
  timezone: string
  encryptedFilePath: string | null
  encryptedSize: number
  plaintextSize: number
  checksum: string
  contentType: string
  encryptionVersion: number
  status: LocalStatus
  retryCount: number
  lastAttemptAt: string | null
  uploadedAt: string | null
  serverScreenshotId: string | null
  workNote: string | null
  activeApp: string | null
  activeWindow: string | null
  idle: boolean
  activeMs: number
  intervalMs: number
  failureCode: string | null
  createdAt: string
}

export class ScreenshotQueue {
  constructor(private readonly db: DatabaseSync) {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        capture_event_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        display_id TEXT NOT NULL,
        display_index INTEGER NOT NULL,
        display_name TEXT,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        original_width INTEGER NOT NULL,
        original_height INTEGER NOT NULL,
        scale_factor REAL NOT NULL,
        captured_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        encrypted_file_path TEXT,
        encrypted_size INTEGER NOT NULL,
        plaintext_size INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        content_type TEXT NOT NULL,
        encryption_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        uploaded_at TEXT,
        server_screenshot_id TEXT,
        work_note TEXT,
        idle INTEGER NOT NULL DEFAULT 0,
        failure_code TEXT,
        created_at TEXT NOT NULL
      )
    `)
    try {
      db.exec(`ALTER TABLE screenshots ADD COLUMN plaintext_size INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // Column already exists on databases created with the current schema.
    }
    try {
      db.exec(`ALTER TABLE screenshots ADD COLUMN active_app TEXT`)
    } catch {
      // Column already exists on databases created with the current schema.
    }
    try {
      db.exec(`ALTER TABLE screenshots ADD COLUMN active_window TEXT`)
    } catch {
      // Column already exists on databases created with the current schema.
    }
    try {
      db.exec(`ALTER TABLE screenshots ADD COLUMN active_ms INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // Column already exists on databases created with the current schema.
    }
    try {
      db.exec(`ALTER TABLE screenshots ADD COLUMN interval_ms INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // Column already exists on databases created with the current schema.
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        tracked_ms INTEGER NOT NULL,
        idle_ms INTEGER NOT NULL
      )
    `)
  }

  static open(path: string): ScreenshotQueue {
    return new ScreenshotQueue(new DatabaseSync(path))
  }

  close(): void {
    this.db.close()
  }

  insert(row: LocalShot): void {
    this.db
      .prepare(
        `INSERT INTO screenshots (
          id, capture_event_id, device_id, display_id, display_index, display_name, width, height,
          original_width, original_height, scale_factor, captured_at, timezone, encrypted_file_path,
          encrypted_size, plaintext_size, checksum, content_type, encryption_version, status, retry_count, last_attempt_at,
          uploaded_at, server_screenshot_id, work_note, active_app, active_window, idle, active_ms, interval_ms,
          failure_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.captureEventId,
        row.deviceId,
        row.displayId,
        row.displayIndex,
        row.displayName,
        row.width,
        row.height,
        row.originalWidth,
        row.originalHeight,
        row.scaleFactor,
        row.capturedAt,
        row.timezone,
        row.encryptedFilePath,
        row.encryptedSize,
        row.plaintextSize,
        row.checksum,
        row.contentType,
        row.encryptionVersion,
        row.status,
        row.retryCount,
        row.lastAttemptAt,
        row.uploadedAt,
        row.serverScreenshotId,
        row.workNote,
        row.activeApp,
        row.activeWindow,
        row.idle ? 1 : 0,
        row.activeMs,
        row.intervalMs,
        row.failureCode,
        row.createdAt,
      )
  }

  recoverInterrupted(): number {
    const result = this.db
      .prepare(`UPDATE screenshots SET status = 'PENDING' WHERE status = 'UPLOADING'`)
      .run()
    return Number(result.changes)
  }

  markMissingFiles(exists: (filePath: string) => boolean): number {
    let changed = 0
    for (const row of this.listByStatus(['PENDING', 'UPLOADING', 'FAILED'])) {
      if (row.failureCode === 'missing_file') continue
      if (!row.encryptedFilePath || !exists(row.encryptedFilePath)) {
        this.markFailed(row.id, 'missing_file')
        this.clearFile(row.id)
        changed += 1
      }
    }
    return changed
  }

  discardOtherDevices(deviceId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT encrypted_file_path AS path FROM screenshots
         WHERE device_id != ? AND encrypted_file_path IS NOT NULL`,
      )
      .all(deviceId) as { path: string }[]
    this.db.prepare(`DELETE FROM screenshots WHERE device_id != ?`).run(deviceId)
    return rows.map((row) => row.path)
  }

  listEligible(): LocalShot[] {
    return this.db
      .prepare(
        `SELECT * FROM screenshots
         WHERE status = 'PENDING' OR (status = 'FAILED' AND IFNULL(failure_code, '') NOT IN ('integrity', 'too_large', 'missing_file', 'conflict'))
         ORDER BY captured_at ASC`,
      )
      .all()
      .map(mapShot)
  }

  listByStatus(statuses: LocalStatus[]): LocalShot[] {
    const marks = statuses.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM screenshots WHERE status IN (${marks})`)
      .all(...statuses)
      .map(mapShot)
  }

  pendingSummary(): { count: number; bytes: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN plaintext_size > 0 THEN plaintext_size ELSE encrypted_size END), 0) AS bytes
         FROM screenshots
         WHERE status IN ('PENDING', 'UPLOADING')
            OR (status = 'FAILED' AND IFNULL(failure_code, '') NOT IN ('integrity', 'too_large', 'missing_file', 'conflict'))`,
      )
      .get() as { count: number; bytes: number }
    return { count: Number(row.count), bytes: Number(row.bytes) }
  }

  storageUsedBytes(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(encrypted_size), 0) AS bytes FROM screenshots WHERE encrypted_file_path IS NOT NULL`,
      )
      .get() as { bytes: number }
    return Number(row.bytes)
  }

  lastCapturedAt(): string | null {
    const row = this.db
      .prepare(`SELECT captured_at FROM screenshots ORDER BY captured_at DESC LIMIT 1`)
      .get() as { captured_at: string } | undefined
    return row?.captured_at ?? null
  }

  markUploading(id: string, at: string): void {
    this.db
      .prepare(`UPDATE screenshots SET status = 'UPLOADING', last_attempt_at = ? WHERE id = ?`)
      .run(at, id)
  }

  markPending(id: string): void {
    this.db
      .prepare(`UPDATE screenshots SET status = 'PENDING' WHERE id = ? AND status = 'UPLOADING'`)
      .run(id)
  }

  markUploaded(id: string, at: string): void {
    this.db
      .prepare(
        `UPDATE screenshots SET status = 'UPLOADED', uploaded_at = ?, server_screenshot_id = id, failure_code = NULL WHERE id = ?`,
      )
      .run(at, id)
  }

  clearFile(id: string): void {
    this.db
      .prepare(`UPDATE screenshots SET encrypted_file_path = NULL, encrypted_size = 0 WHERE id = ?`)
      .run(id)
  }

  markFailed(id: string, code: string): void {
    this.db
      .prepare(
        `UPDATE screenshots SET status = 'FAILED', failure_code = ?, retry_count = retry_count + 1, last_attempt_at = ? WHERE id = ?`,
      )
      .run(code, new Date().toISOString(), id)
  }

  get(id: string): LocalShot | null {
    const row = this.db.prepare(`SELECT * FROM screenshots WHERE id = ?`).get(id)
    return row ? mapShot(row) : null
  }

  retryFailed(): number {
    const result = this.db
      .prepare(
        `UPDATE screenshots SET status = 'PENDING', failure_code = NULL
         WHERE status = 'FAILED' AND IFNULL(failure_code, '') NOT IN ('integrity', 'too_large', 'missing_file', 'conflict')`,
      )
      .run()
    return Number(result.changes)
  }

  recordSession(id: string, startedAt: string, trackedMs: number, idleMs: number): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, started_at, ended_at, tracked_ms, idle_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET tracked_ms = excluded.tracked_ms, idle_ms = excluded.idle_ms, ended_at = excluded.ended_at`,
      )
      .run(id, startedAt, new Date().toISOString(), trackedMs, idleMs)
  }

  listSessions(sinceIso: string): {
    id: string
    startedAt: string
    endedAt: string
    trackedMs: number
    idleMs: number
  }[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, ended_at, tracked_ms, idle_ms FROM sessions
         WHERE started_at >= ? ORDER BY started_at`,
      )
      .all(sinceIso) as {
      id: string
      started_at: string
      ended_at: string | null
      tracked_ms: number
      idle_ms: number
    }[]
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? row.started_at,
      trackedMs: Number(row.tracked_ms),
      idleMs: Number(row.idle_ms),
    }))
  }

  totalsBetween(startIso: string, endIso: string): { trackedMs: number; idleMs: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tracked_ms), 0) AS tracked, COALESCE(SUM(idle_ms), 0) AS idle
         FROM sessions WHERE started_at >= ? AND started_at < ?`,
      )
      .get(startIso, endIso) as { tracked: number; idle: number }
    return { trackedMs: Number(row.tracked), idleMs: Number(row.idle) }
  }
}

function mapShot(row: unknown): LocalShot {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    captureEventId: String(value.capture_event_id),
    deviceId: String(value.device_id),
    displayId: String(value.display_id),
    displayIndex: Number(value.display_index),
    displayName: value.display_name == null ? null : String(value.display_name),
    width: Number(value.width),
    height: Number(value.height),
    originalWidth: Number(value.original_width),
    originalHeight: Number(value.original_height),
    scaleFactor: Number(value.scale_factor),
    capturedAt: String(value.captured_at),
    timezone: String(value.timezone),
    encryptedFilePath: value.encrypted_file_path == null ? null : String(value.encrypted_file_path),
    encryptedSize: Number(value.encrypted_size),
    plaintextSize: Number(value.plaintext_size ?? value.encrypted_size),
    checksum: String(value.checksum),
    contentType: String(value.content_type),
    encryptionVersion: Number(value.encryption_version),
    status: String(value.status) as LocalStatus,
    retryCount: Number(value.retry_count),
    lastAttemptAt: value.last_attempt_at == null ? null : String(value.last_attempt_at),
    uploadedAt: value.uploaded_at == null ? null : String(value.uploaded_at),
    serverScreenshotId:
      value.server_screenshot_id == null ? null : String(value.server_screenshot_id),
    workNote: value.work_note == null ? null : String(value.work_note),
    activeApp: value.active_app == null ? null : String(value.active_app),
    activeWindow: value.active_window == null ? null : String(value.active_window),
    idle: Number(value.idle) === 1,
    activeMs: Number(value.active_ms ?? 0),
    intervalMs: Number(value.interval_ms ?? 0),
    failureCode: value.failure_code == null ? null : String(value.failure_code),
    createdAt: String(value.created_at),
  }
}
