import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, platform, release, uptime } from 'node:os'
import path from 'node:path'
import {
  app,
  desktopCapturer,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
} from 'electron'
import {
  brand,
  decryptScreenshot,
  effectiveIntervalSeconds,
  encryptScreenshot,
  isTrustedApiUrl,
  screenshotAad,
  sha256Hex,
} from '@screenvault/shared'
import { errorCodes, policySchema } from '@screenvault/types'
import { activityLabels, deriveActivity } from '../core/activity.js'
import { splitActiveTime } from '../core/activityTime.js'
import { deletionCandidates, persistCapture, storageLevel } from '../core/capturePipeline.js'
import {
  appVersion,
  defaultSettings,
  policyTransition,
  type DesktopState,
  type LocalSettings,
  type PolicyView,
  type ReportAnswer,
} from '../core/desktopState.js'
import { atomicWriteFile } from '../core/files.js'
import { redactSensitiveRegions } from '../core/redaction.js'
import { ScreenshotQueue } from '../core/queue.js'
import { runUpload, UploadHttpError } from '../core/uploader.js'
import { encodeImage } from './encode.js'
import { detectMeteredNetwork, foregroundWindow } from './probes.js'

type Profile = {
  userName: string
  userEmail: string
  userRole: string
  organizationName: string
  deviceId: string
  deviceName: string
}

export class DesktopRuntime {
  private queue!: ScreenshotQueue
  private settings: LocalSettings = defaultSettings()
  private profile: Profile | null = null
  private accessToken: string | null = null
  private policy: PolicyView | null = null
  private monitoring = false
  private capturing = false
  private uploading = false
  private syncing = false
  private online = true
  private uploadFailed = false
  private revoked = false
  private locked = false
  private message: string | null = null
  private workNote = ''
  private lastSyncAt: string | null = null
  private uploadProgress: DesktopState['upload'] = null
  private captureTimer: NodeJS.Timeout | null = null
  private uploadAbort: AbortController | null = null
  private refreshInflight: Promise<void> | null = null
  private sessionId: string | null = null
  private segmentStartedAt: number | null = null
  private accumulatedTrackedMs = 0
  private accumulatedIdleMs = 0
  private lastAutoUpload = 0
  private hooks: Array<NodeJS.Timeout> = []
  private reportFieldsKey = ''
  private lastDailyNotice = 0
  private weeklyNoticeKey = ''
  private reminding = false
  private chatWatching = false
  private receiveChecking = false
  private pendingReceiveUpload = false
  private chatNoticeReady = false
  private readonly chatSeen = new Map<string, string>()
  private dailySubmitted = false
  private weeklySubmitted = false
  private dailyConfirmed = false
  private weeklyConfirmed = false
  private dailyAnswers: ReportAnswer[] = []
  private weeklyAnswers: ReportAnswer[] = []

  constructor(
    private readonly userData: string,
    private readonly publish: () => void,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.userData, { recursive: true })
    await mkdir(path.join(this.userData, 'screenshots'), { recursive: true })
    this.settings = await this.readSettings()
    const note = await this.readJson<{ workNote?: string }>(this.notePath)
    this.workNote = note?.workNote ?? ''
    this.queue = ScreenshotQueue.open(path.join(this.userData, 'queue.sqlite'))
    this.queue.recoverInterrupted()
    this.queue.markMissingFiles((file) => existsSync(file))
    await this.sweepTemporaryFiles(path.join(this.userData, 'screenshots'))
    powerMonitor.on('lock-screen', () => {
      this.locked = true
      this.flushSegment()
      this.publish()
    })
    powerMonitor.on('unlock-screen', () => {
      this.locked = false
      if (this.monitoring && !this.segmentStartedAt) this.segmentStartedAt = Date.now()
      this.publish()
    })
    powerMonitor.on('suspend', () => {
      this.flushSegment({ pause: true })
    })
    powerMonitor.on('resume', () => {
      this.locked = false
      if (this.monitoring && !this.segmentStartedAt) this.segmentStartedAt = Date.now()
      this.publish()
    })
    const device = await this.readJson<{ deviceId: string; deviceName: string }>(this.devicePath)
    if (device && (await this.readRefreshToken())) {
      try {
        await this.refreshSession()
        await this.reportPreviousExit()
        await this.markRunning()
        await this.syncPolicy()
        await this.syncSessions()
        await this.enablePersistentSession()
        await this.resumeMonitoring()
      } catch (error) {
        this.message = error instanceof Error ? error.message : 'Sign-in could not be restored.'
      }
    }
    this.hooks.push(setInterval(() => void this.health(), 15_000))
    this.hooks.push(setInterval(() => void this.watchChat(), 4_000))
    this.hooks.push(setInterval(() => void this.watchReceive(), 4_000))
    this.hooks.push(
      setInterval(() => {
        if (!this.profile || !this.accessToken || this.revoked) return
        void this.syncPolicy().catch((error: unknown) => {
          console.error('Organization policy could not be refreshed.', error)
        })
      }, 10_000),
    )
    this.hooks.push(setInterval(() => void this.periodic(), 60_000))
    this.publish()
  }

  shutdown(): void {
    this.stopTimers()
    for (const timer of this.hooks) clearInterval(timer)
    this.flushSegment()
    this.queue.close()
  }

  snapshot(): DesktopState {
    const pending = this.queue.pendingSummary()
    const used = this.queue.storageUsedBytes()
    const max = (this.policy?.maxLocalStorageGB ?? 5) * 1024 * 1024 * 1024
    const level = storageLevel(used, max)
    const activity = deriveActivity({
      uploading: this.uploading,
      syncing: this.syncing,
      online: this.online,
      uploadFailed: this.uploadFailed,
      pending: pending.count,
      capturing: this.capturing,
      monitoring: this.monitoring,
    })
    const today = this.todayTotals()
    const live = this.openSegmentSplit()
    return {
      signedIn: Boolean(this.profile && this.accessToken),
      userName: this.profile?.userName ?? null,
      userEmail: this.profile?.userEmail ?? null,
      userRole: this.profile?.userRole ?? null,
      organizationName: this.profile?.organizationName ?? null,
      deviceName: this.profile?.deviceName ?? null,
      deviceId: this.profile?.deviceId ?? null,
      revoked: this.revoked,
      activity,
      activityLabel:
        activity === 'offline'
          ? `Offline — ${pending.count} screenshots waiting to upload`
          : activityLabels[activity],
      monitoring: this.monitoring,
      segmentStartedAt: this.segmentStartedAt,
      accumulatedTrackedMs: this.accumulatedTrackedMs,
      accumulatedIdleMs: this.accumulatedIdleMs,
      todayTrackedMs: today.trackedMs + live.activeMs,
      todayIdleMs: today.idleMs + live.inactiveMs,
      weekDays: this.weekTotals(),
      systemIdleSeconds: powerMonitor.getSystemIdleTime(),
      pendingCount: pending.count,
      pendingBytes: pending.bytes,
      lastScreenshotAt: this.queue.lastCapturedAt(),
      lastSyncAt: this.lastSyncAt,
      workNote: this.workNote,
      upload: this.uploadProgress,
      storageWarning:
        level === 'stop'
          ? 'Local storage is full. New screenshots are paused until uploads free space.'
          : level === 'warn'
            ? 'Local screenshot storage is nearly full.'
            : null,
      message: this.message,
      settings: this.settings,
      policy: this.policy,
      reports: {
        dailySubmitted: this.dailySubmitted,
        weeklySubmitted: this.weeklySubmitted,
        dailyConfirmed: this.dailyConfirmed,
        weeklyConfirmed: this.weeklyConfirmed,
        dailyAnswers: this.dailyAnswers,
        weeklyAnswers: this.weeklyAnswers,
      },
      storageUsedBytes: used,
      appVersion,
    }
  }

  async listTeams(): Promise<{ id: string; name: string; organizationName: string }[]> {
    if (!isTrustedApiUrl(this.settings.apiUrl)) {
      throw new Error('The server address must use HTTPS, except on localhost or a private network.')
    }
    const response = await this.request('/api/v1/auth/teams', { anonymous: true })
    const body = (await response.json().catch(() => null)) as {
      items?: { id: string; name: string; organizationName: string }[]
    }
    if (!response.ok) throw await errorFrom(response, body)
    return body?.items ?? []
  }

  async register(name: string, email: string, password: string, teamId: string): Promise<void> {
    if (!isTrustedApiUrl(this.settings.apiUrl)) {
      throw new Error('The server address must use HTTPS, except on localhost or a private network.')
    }
    const response = await this.request('/api/v1/auth/register', {
      method: 'POST',
      json: { name, email, password, teamId },
      anonymous: true,
    })
    const body = (await response.json().catch(() => null)) as unknown
    if (!response.ok) throw await errorFrom(response, body)
    await this.login(email, password)
  }

  async login(email: string, password: string): Promise<void> {
    if (!isTrustedApiUrl(this.settings.apiUrl)) {
      throw new Error('The server address must use HTTPS, except on localhost or a private network.')
    }
    const device = await this.readJson<{ deviceId: string; deviceName: string }>(this.devicePath)
    const response = await this.request('/api/v1/devices/enroll', {
      method: 'POST',
      json: {
        email,
        password,
        deviceId: device?.deviceId,
        device: {
          name: device?.deviceName || hostname(),
          platform: currentPlatform(),
          osVersion: release(),
          appVersion,
        },
      },
      anonymous: true,
    })
    const body = (await response.json()) as {
      accessToken: string
      refreshToken: string
      deviceId: string
      user: { name: string; email: string; role: string; organization: { name: string } }
    }
    if (!response.ok) throw await errorFrom(response, body)
    await this.writeRefreshToken(body.refreshToken)
    await writeFile(
      this.devicePath,
      JSON.stringify({ deviceId: body.deviceId, deviceName: device?.deviceName || hostname() }),
    )
    this.accessToken = body.accessToken
    this.profile = {
      userName: body.user.name,
      userEmail: body.user.email,
      userRole: body.user.role,
      organizationName: body.user.organization.name,
      deviceId: body.deviceId,
      deviceName: device?.deviceName || hostname(),
    }
    this.revoked = false
    this.message = null
    await this.ensureKey()
    await this.forgetOtherAccounts()
    this.noteMissingFiles()
    await this.syncPolicy()
    await this.enablePersistentSession()
    await this.reportPreviousExit()
    await this.markRunning()
    await this.resumeMonitoring()
    this.publish()
  }

  async logout(): Promise<void> {
    this.stop()
    const refresh = await this.readRefreshToken()
    if (refresh) {
      await this.request('/api/v1/auth/logout', {
        method: 'POST',
        json: { refreshToken: refresh },
        anonymous: true,
      }).catch(() => undefined)
    }
    await rm(this.refreshPath, { force: true })
    this.accessToken = null
    this.profile = null
    this.policy = null
    this.message = null
    this.reportFieldsKey = ''
    this.weeklyNoticeKey = ''
    this.lastDailyNotice = 0
    this.dailySubmitted = false
    this.weeklySubmitted = false
    this.dailyConfirmed = false
    this.weeklyConfirmed = false
    this.dailyAnswers = []
    this.weeklyAnswers = []
    this.chatSeen.clear()
    this.chatNoticeReady = false
    this.publish()
  }

  async start(): Promise<void> {
    if (!this.profile || !this.accessToken) throw new Error('Sign in before monitoring.')
    if (this.revoked) throw new Error('This device was revoked and needs reauthorization.')
    if (!this.policy?.captureEnabled)
      throw new Error('Screenshot capture is disabled by your organization.')
    if (this.monitoring) return
    this.monitoring = true
    this.sessionId = randomUUID()
    this.segmentStartedAt = Date.now()
    this.accumulatedTrackedMs = 0
    this.accumulatedIdleMs = 0
    this.message = 'Screenshot monitoring is on.'
    this.scheduleCapture()
    this.publish()
  }

  stop(): void {
    this.monitoring = false
    this.capturing = false
    if (this.captureTimer) clearTimeout(this.captureTimer)
    this.captureTimer = null
    this.flushSegment()
    this.sessionId = null
    this.segmentStartedAt = null
    this.message = 'Screenshot monitoring is off.'
    this.publish()
  }

  async uploadNow(): Promise<void> {
    if (this.policy && !this.policy.manualUploadAllowed) {
      throw new Error('Manual upload is turned off by your organization.')
    }
    await this.upload(false)
  }

  cancelUpload(): void {
    this.uploadAbort?.abort()
  }

  async setWorkNote(note: string): Promise<void> {
    this.workNote = note.slice(0, 500)
    await writeFile(this.notePath, JSON.stringify({ workNote: this.workNote }))
    this.publish()
  }

  async updateSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
    if (patch.apiUrl && !isTrustedApiUrl(patch.apiUrl)) {
      throw new Error('The server address must use HTTPS, except on localhost or a private network.')
    }
    this.settings = {
      ...this.settings,
      ...patch,
      launchOnStartup: true,
      startMonitoringOnLaunch: true,
      minimizeToTray: true,
      shortcutEnabled: false,
    }
    await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2))
    app.setLoginItemSettings({ openAtLogin: true })
    this.publish()
    return this.settings
  }

  async retryFailed(): Promise<void> {
    this.queue.retryFailed()
    await this.upload(false)
  }

  async reportsCall(pathname: string): Promise<unknown> {
    if (!this.accessToken) throw new Error('Sign in before opening reports.')
    if (!pathname.startsWith('/api/v1/reports/mine') || pathname.includes('..')) {
      throw new Error('Invalid report request.')
    }
    const response = await this.request(pathname)
    const text = await response.text()
    const body: unknown = text ? JSON.parse(text) : {}
    if (!response.ok) throw await errorFrom(response, body)
    return body
  }

  async chatCall(method: string, pathname: string, json?: unknown): Promise<unknown> {
    if (!this.accessToken) throw new Error('Sign in before using chat.')
    if (!pathname.startsWith('/api/v1/chat') || pathname.includes('..')) {
      throw new Error('Invalid chat request.')
    }
    const response = await this.request(pathname, {
      method,
      ...(json === undefined ? {} : { json }),
    })
    const text = await response.text()
    const body: unknown = text ? JSON.parse(text) : {}
    if (!response.ok) throw await errorFrom(response, body)
    return body
  }

  async paymentsCall(method: string, pathname: string, json?: unknown): Promise<unknown> {
    if (!this.accessToken) throw new Error('Sign in before using payments.')
    if (!pathname.startsWith('/api/v1/payments') || pathname.includes('..')) {
      throw new Error('Invalid payment request.')
    }
    const response = await this.request(pathname, {
      method,
      ...(json === undefined ? {} : { json }),
    })
    const text = await response.text()
    const body: unknown = text ? JSON.parse(text) : {}
    if (!response.ok) throw await errorFrom(response, body)
    return body
  }

  async refreshPolicy(): Promise<void> {
    if (!this.profile || !this.accessToken) return
    await this.syncPolicy()
  }

  async uploadReportImage(
    contentType: string,
    data: string,
  ): Promise<{ id: string; path: string }> {
    if (!this.accessToken) throw new Error('Sign in before adding an image.')
    const response = await this.request('/api/v1/reports/images', {
      method: 'POST',
      json: { contentType, data },
    })
    const body = (await response.json().catch(() => null)) as { id?: string; path?: string }
    if (!response.ok) throw await errorFrom(response, body)
    if (!body?.id || !body.path) throw new Error('The image could not be saved.')
    return { id: body.id, path: body.path }
  }

  async readReportImage(pathname: string): Promise<{ contentType: string; data: string }> {
    if (!this.accessToken) throw new Error('Sign in before opening an image.')
    if (!/^\/api\/v1\/reports\/images\/[0-9a-f-]{36}$/i.test(pathname)) {
      throw new Error('Invalid image.')
    }
    const response = await this.request(pathname)
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw await errorFrom(response, body)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      contentType: response.headers.get('content-type') || 'image/png',
      data: bytes.toString('base64'),
    }
  }

  async submitReport(kind: 'DAILY' | 'WEEKLY', answers: ReportAnswer[]): Promise<void> {
    if (!this.profile || !this.accessToken) throw new Error('Sign in before uploading a report.')
    if (kind === 'DAILY' ? this.dailyConfirmed : this.weeklyConfirmed) {
      throw new Error('An admin confirmed this report, so it can no longer be edited.')
    }
    const periodKey = kind === 'DAILY' ? localDateKey() : weekStartKey()
    const response = await this.request('/api/v1/reports', {
      method: 'POST',
      json: { kind, periodKey, answers },
    })
    const body: unknown = await response.json()
    if (!response.ok) throw await errorFrom(response, body)
    if (kind === 'DAILY') {
      this.dailySubmitted = true
      this.dailyAnswers = answers
    } else {
      this.weeklySubmitted = true
      this.weeklyAnswers = answers
    }
    this.message = kind === 'DAILY' ? 'Daily report uploaded.' : 'Weekly report uploaded.'
    this.publish()
  }

  private async periodic(): Promise<void> {
    if (this.profile && this.accessToken && !this.revoked) {
      void this.remindReports()
      await this.request('/api/v1/devices/heartbeat', {
        method: 'POST',
        json: { appVersion },
      }).catch(() => undefined)
    }
    this.flushSegment()
    await this.syncSessions()
    await this.applyRetention()
    if (!this.policy?.automaticUploadEnabled || this.uploading || !this.online) return
    const interval = this.policy.automaticUploadIntervalMinutes * 60 * 1000
    if (Date.now() - this.lastAutoUpload < interval) return
    if (this.policy.uploadOnlyOnUnmeteredNetwork && (await detectMeteredNetwork()) === 'metered')
      return
    if (this.queue.pendingSummary().count === 0) return
    this.lastAutoUpload = Date.now()
    await this.upload(true)
  }

  private async upload(automatic: boolean): Promise<boolean> {
    if (this.uploading || !this.accessToken || this.revoked) return false
    if (!this.online) {
      this.message = 'Offline — screenshots stay encrypted on this computer.'
      this.publish()
      return false
    }
    this.uploading = true
    this.uploadFailed = false
    this.message = null
    this.uploadAbort = new AbortController()
    this.publish()
    let result: { uploaded: number; failed: number; cancelled: boolean; revoked: boolean }
    try {
      result = await runUpload({
        queue: this.queue,
        signal: this.uploadAbort.signal,
        concurrency: 3,
        decrypt: (encrypted, id) => decryptScreenshot(encrypted, this.key(), screenshotAad(id)),
        readFile: (file) => readFile(file),
        onProgress: (progress) => {
          this.uploadProgress = progress
          this.publish()
        },
        transport: {
          createSession: async (items) => {
            const response = await this.request('/api/v1/upload-sessions', {
              method: 'POST',
              json: { items },
              signal: this.uploadAbort?.signal,
            })
            const body = (await response.json()) as {
              items: {
                screenshotId: string
                status: 'accepted' | 'already_stored' | 'awaiting_complete'
              }[]
            }
            if (!response.ok) throw await httpError(response, body)
            return body
          },
          putContent: async (id, bytes, checksum, contentType, signal) => {
            const response = await this.request(`/api/v1/screenshots/${id}/content`, {
              method: 'PUT',
              body: bytes,
              headers: { 'content-type': contentType, 'x-checksum-sha256': checksum },
              signal,
            })
            if (!response.ok) throw await httpError(response)
          },
          complete: async (id, checksum, signal) => {
            const response = await this.request(`/api/v1/screenshots/${id}/complete`, {
              method: 'POST',
              json: { checksum },
              signal,
            })
            if (!response.ok) throw await httpError(response)
          },
          refreshAuth: () => this.refreshSession(),
        },
      })
    } catch (error) {
      this.uploading = false
      this.uploadProgress = null
      this.uploadAbort = null
      this.message = error instanceof Error ? error.message : 'Screenshots could not be uploaded.'
      this.publish()
      await this.followPendingReceiveUpload()
      return false
    }
    this.uploading = false
    this.uploadProgress = null
    if (result.revoked) {
      this.revoked = true
      this.stop()
      this.message = 'This device was revoked and needs reauthorization.'
    } else if (result.cancelled) {
      this.message = 'Upload cancelled. Pending screenshots are still queued.'
    } else if (result.failed > 0) {
      this.uploadFailed = true
      this.message = automatic
        ? 'Automatic upload needs another try.'
        : 'Some screenshots failed to upload.'
    } else if (result.uploaded > 0) {
      this.lastSyncAt = new Date().toISOString()
      this.message = 'Screenshots uploaded.'
    }
    const succeeded = !result.revoked && !result.cancelled && result.failed === 0
    await this.applyRetention()
    this.publish()
    await this.followPendingReceiveUpload()
    return succeeded
  }

  private async enablePersistentSession(): Promise<void> {
    this.settings = {
      ...this.settings,
      launchOnStartup: true,
      startMonitoringOnLaunch: true,
      minimizeToTray: true,
      shortcutEnabled: false,
    }
    await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), { mode: 0o600 })
    app.setLoginItemSettings({ openAtLogin: true })
  }

  private async resumeMonitoring(): Promise<void> {
    if (!this.policy?.captureEnabled || this.revoked || this.monitoring) return
    try {
      await this.start()
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Screenshot monitoring could not start.'
    }
  }

  private async followPendingReceiveUpload(): Promise<void> {
    if (!this.pendingReceiveUpload || this.uploading) return
    this.pendingReceiveUpload = false
    await this.upload(false)
  }

  async reportShutdown(): Promise<void> {
    // Persist locally first — Windows may kill the process before the network call finishes.
    this.writeRunStateSync({ running: false, reason: 'shutdown', reported: false })
    if (!this.profile || !this.accessToken || this.revoked) return
    const ok = await this.reportDeviceExit('shutdown')
    this.writeRunStateSync({ running: false, reason: 'shutdown', reported: ok })
  }

  private async reportPreviousExit(): Promise<void> {
    if (!this.profile || !this.accessToken || this.revoked) return
    const state = await this.readRunState()
    if (!state) return
    if (state.running) {
      const reason = uncleanExitReason(state.markedAt)
      const ok = await this.reportDeviceExit(reason)
      this.writeRunStateSync({ running: false, reason, reported: ok })
      return
    }
    if (
      (state.reason === 'shutdown' || state.reason === 'force_quit') &&
      state.reported === false
    ) {
      const ok = await this.reportDeviceExit(state.reason)
      if (!ok) return
      this.writeRunStateSync({ running: false, reason: state.reason, reported: true })
    }
  }

  private async markRunning(): Promise<void> {
    this.writeRunStateSync({ running: true, markedAt: new Date().toISOString() })
  }

  private async reportDeviceExit(reason: 'force_quit' | 'shutdown'): Promise<boolean> {
    try {
      const response = await this.request('/api/v1/devices/exit', {
        method: 'POST',
        json: { reason },
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async readRunState(): Promise<RunState | null> {
    return this.readJson(this.runStatePath)
  }

  private writeRunStateSync(state: RunState): void {
    writeFileSync(this.runStatePath, JSON.stringify(state), { mode: 0o600 })
  }

  private scheduleCapture(): void {
    if (this.captureTimer) clearTimeout(this.captureTimer)
    const seconds = effectiveIntervalSeconds(this.policy?.screenshotIntervalSeconds ?? 60)
    this.captureTimer = setTimeout(() => void this.captureTick(), seconds * 1000)
  }

  private async captureTick(): Promise<void> {
    if (!this.monitoring) return
    this.capturing = true
    this.publish()
    try {
      const foreground = await foregroundWindow()
      const displays = await this.captureDisplays()
      const idleSeconds = powerMonitor.getSystemIdleTime()
      const idle =
        Boolean(this.policy?.idleDetectionEnabled) &&
        idleSeconds >= (this.policy?.idleThresholdMinutes ?? 5) * 60
      const intervalMs =
        effectiveIntervalSeconds(this.policy?.screenshotIntervalSeconds ?? 60) * 1000
      const activeMs = splitActiveTime(intervalMs, idleSeconds).activeMs
      const result = await persistCapture({
        monitoring: this.monitoring,
        locked: this.locked,
        pauseWhileLocked: this.policy?.pauseCaptureWhileLocked ?? true,
        captureMode: this.policy?.captureMode ?? 'ALL_DISPLAYS',
        foregroundApp: foreground.processName,
        activeApp: foreground.app,
        activeWindow: foreground.title,
        excludedApplications: this.policy?.excludedApplications ?? [],
        storageUsedBytes: this.queue.storageUsedBytes(),
        maxBytes: (this.policy?.maxLocalStorageGB ?? 5) * 1024 * 1024 * 1024,
        displays,
        deviceId: this.profile?.deviceId ?? 'unknown',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        workNote: this.workNote || null,
        idle,
        activeMs,
        intervalMs,
        now: new Date(),
        encoder: (png) =>
          encodeImage(png, {
            format: this.policy?.format ?? 'WEBP',
            quality: this.policy?.quality ?? 70,
            maxWidth: this.policy?.maxWidth ?? null,
          }),
        encrypt: (plaintext, screenshotId) =>
          encryptScreenshot(plaintext, this.key(), screenshotAad(screenshotId)),
        checksum: sha256Hex,
        redact: redactSensitiveRegions,
        writeAtomic: async (screenshotId, capturedAt, bytes) => {
          const day = capturedAt.toISOString().slice(0, 10)
          const file = path.join(
            this.userData,
            'screenshots',
            day,
            `${screenshotId}.${brand.fileExtension}`,
          )
          await atomicWriteFile(file, bytes)
          return file
        },
        queue: this.queue,
      })
      if (
        result.saved > 0 &&
        this.message &&
        /could not be captured|could be captured/.test(this.message)
      ) {
        this.message = null
      }
      if (result.saved > 0 && this.settings.showCaptureNotifications) {
        try {
          new Notification({
            title: brand.productName,
            body: 'A screenshot was captured and encrypted on this computer.',
          }).show()
        } catch {
          // Notifications are optional and must never block capture.
        }
      }
      if (result.skippedReason === 'quota') {
        this.message = 'Capture paused because local storage reached its limit.'
      }
    } catch (error) {
      if (this.monitoring) {
        this.message = error instanceof Error ? error.message : 'Screenshot capture failed.'
      }
    } finally {
      this.capturing = false
      if (this.monitoring) this.scheduleCapture()
      this.publish()
    }
  }

  private async captureDisplays() {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    const width = Math.min(
      3840,
      Math.max(
        1,
        ...displays.map((display) => Math.round(display.size.width * display.scaleFactor)),
      ),
    )
    const height = Math.min(
      2160,
      Math.max(
        1,
        ...displays.map((display) => Math.round(display.size.height * display.scaleFactor)),
      ),
    )
    const request = {
      types: ['screen'] as ('screen' | 'window')[],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    }
    let sources = await desktopCapturer.getSources(request)
    if (displays.length > 0 && sources.every((source) => source.thumbnail.isEmpty())) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (!this.monitoring) return []
      sources = await desktopCapturer.getSources(request)
    }
    const captured = []
    for (const [index, display] of displays.entries()) {
      const source =
        sources.find((item) => item.display_id !== '' && item.display_id === String(display.id)) ??
        sources[index]
      if (!source || source.thumbnail.isEmpty()) continue
      captured.push({
        displayId: String(display.id),
        displayIndex: index,
        displayName:
          'label' in display && typeof display.label === 'string' && display.label
            ? display.label
            : `Display ${index + 1}`,
        isPrimary: display.id === primaryId,
        scaleFactor: display.scaleFactor,
        png: source.thumbnail.toPNG(),
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
        workArea: {
          x: display.workArea.x,
          y: display.workArea.y,
          width: display.workArea.width,
          height: display.workArea.height,
        },
      })
    }
    if (captured.length === 0) {
      throw new Error(
        this.locked
          ? 'The screen could not be captured while it was locked or signing out.'
          : 'No displays could be captured. Check screen recording permission.',
      )
    }
    return captured
  }

  private async syncPolicy(): Promise<void> {
    this.syncing = true
    this.publish()
    let fieldsChanged = false
    try {
      const response = await this.request('/api/v1/policy')
      const body: unknown = await response.json()
      if (!response.ok) throw await errorFrom(response, body)
      const parsed = policySchema.parse(body)
      const fieldsKey = JSON.stringify({
        daily: parsed.dailyReportFields,
        weekly: parsed.weeklyReportFields,
      })
      fieldsChanged = fieldsKey !== this.reportFieldsKey
      this.reportFieldsKey = fieldsKey
      if (fieldsChanged) this.weeklyNoticeKey = ''
      const previous = this.policy
      this.policy = parsed
      this.lastSyncAt = new Date().toISOString()
      const effect = policyTransition(previous, parsed, this.monitoring)
      if (effect.stop) {
        this.stop()
        this.message = 'Screenshot capture was turned off by your organization.'
      } else if (effect.reschedule) {
        this.scheduleCapture()
      }
    } finally {
      this.syncing = false
      this.publish()
    }
    if (fieldsChanged) void this.remindReports()
  }

  private async remindReports(): Promise<void> {
    if (this.reminding || !this.profile || !this.accessToken || this.revoked || !this.policy) return
    const dailyFields = this.policy.dailyReportFields ?? []
    const weeklyFields = this.policy.weeklyReportFields ?? []
    if (dailyFields.length === 0 && weeklyFields.length === 0) return
    this.reminding = true
    try {
      const daily = localDateKey()
      const weekly = weekStartKey()
      const response = await this.request(`/api/v1/reports/status?daily=${daily}&weekly=${weekly}`)
      const body = (await response.json()) as {
        dailySubmitted?: boolean
        weeklySubmitted?: boolean
        dailyConfirmed?: boolean
        weeklyConfirmed?: boolean
        dailyAnswers?: ReportAnswer[]
        weeklyAnswers?: ReportAnswer[]
      }
      if (!response.ok) return
      this.dailySubmitted = Boolean(body.dailySubmitted)
      this.weeklySubmitted = Boolean(body.weeklySubmitted)
      this.dailyConfirmed = Boolean(body.dailyConfirmed)
      this.weeklyConfirmed = Boolean(body.weeklyConfirmed)
      this.dailyAnswers = Array.isArray(body.dailyAnswers) ? body.dailyAnswers : []
      this.weeklyAnswers = Array.isArray(body.weeklyAnswers) ? body.weeklyAnswers : []
      const now = Date.now()
      if (
        dailyFields.length > 0 &&
        !this.dailySubmitted &&
        now - this.lastDailyNotice >= 5 * 60 * 1000
      ) {
        this.notify("Please upload today's daily report.")
        this.lastDailyNotice = now
      }
      if (weeklyFields.length > 0 && !this.weeklySubmitted && this.weeklyNoticeKey !== weekly) {
        this.notify("Please upload this week's report.")
        this.weeklyNoticeKey = weekly
      }
      this.publish()
    } catch {
      // A missed reminder retries on the next check.
    } finally {
      this.reminding = false
    }
  }

  private async watchChat(): Promise<void> {
    if (this.chatWatching || !this.profile || !this.accessToken || this.revoked) return
    this.chatWatching = true
    try {
      const response = await this.request('/api/v1/chat/inbox')
      const body = (await response.json().catch(() => null)) as {
        items?: {
          id?: string
          name?: string
          incomingBody?: string | null
          incomingAt?: string | null
        }[]
      } | null
      if (!response.ok || !body?.items) return
      if (!this.chatNoticeReady) {
        for (const person of body.items) {
          if (person.id && person.incomingAt) this.chatSeen.set(person.id, person.incomingAt)
        }
        this.chatNoticeReady = true
        return
      }
      for (const person of body.items) {
        if (!person.id || !person.incomingAt || !person.incomingBody || !person.name) continue
        if (this.chatSeen.get(person.id) === person.incomingAt) continue
        this.chatSeen.set(person.id, person.incomingAt)
        const text = person.incomingBody.trim()
        if (!text) continue
        this.notify(text.length > 240 ? `${text.slice(0, 237)}...` : text, person.name)
      }
    } catch {
      // The next check retries a missed chat notification.
    } finally {
      this.chatWatching = false
    }
  }

  private async watchReceive(): Promise<void> {
    if (this.receiveChecking || !this.profile || !this.accessToken || this.revoked) return
    this.receiveChecking = true
    try {
      const response = await this.request('/api/v1/screenshot-receives/pending')
      const body = (await response.json().catch(() => null)) as {
        request?: { id?: string; requestedByName?: string } | null
      } | null
      const requestId = body?.request?.id
      if (!response.ok || !requestId) return
      const ack = await this.request(`/api/v1/screenshot-receives/${requestId}/respond`, {
        method: 'POST',
        json: { accepted: true },
      })
      const ackBody = (await ack.json().catch(() => null)) as { accepted?: boolean } | null
      if (!ack.ok || ackBody?.accepted !== true) {
        this.message = 'The upload request is no longer waiting.'
        this.publish()
        return
      }
      this.message = 'Uploading screenshots for your administrator.'
      this.publish()
      if (this.uploading) this.pendingReceiveUpload = true
      else await this.upload(false)
    } catch {
      // The next check retries if the request is still waiting.
    } finally {
      this.receiveChecking = false
    }
  }

  private notify(body: string, title = brand.productName): void {
    try {
      new Notification({ title, body }).show()
    } catch {
      // Notifications are optional and must never block the app.
    }
  }

  private async health(): Promise<void> {
    try {
      const response = await fetch(new URL('/health', this.settings.apiUrl), {
        signal: AbortSignal.timeout(4000),
      })
      this.online = response.ok
    } catch {
      this.online = false
    }
    this.noteMissingFiles()
    this.publish()
  }

  private noteMissingFiles(): void {
    this.queue.markMissingFiles((file) => existsSync(file))
  }

  private async forgetOtherAccounts(): Promise<void> {
    const deviceId = this.profile?.deviceId
    if (!deviceId) return
    const files = this.queue.discardOtherDevices(deviceId)
    await Promise.all(files.map((file) => rm(file, { force: true })))
  }

  private async applyRetention(): Promise<void> {
    if (!this.policy) return
    const rows = this.queue.listByStatus(['UPLOADED'])
    for (const row of deletionCandidates(rows, this.policy, new Date())) {
      if (row.encryptedFilePath) await rm(row.encryptedFilePath, { force: true })
      this.queue.clearFile(row.id)
    }
  }

  private refreshSession(): Promise<void> {
    if (!this.refreshInflight) {
      this.refreshInflight = this.performRefresh().finally(() => {
        this.refreshInflight = null
      })
    }
    return this.refreshInflight
  }

  private async performRefresh(): Promise<void> {
    const refreshToken = await this.readRefreshToken()
    if (!refreshToken) throw sessionExpired()
    const response = await this.request('/api/v1/auth/refresh', {
      method: 'POST',
      json: { refreshToken },
      anonymous: true,
    })
    const body = (await response.json()) as {
      accessToken?: string
      refreshToken?: string
      error?: { code?: string; message?: string }
    }
    if (response.status === 403 && body.error?.code === errorCodes.DEVICE_REVOKED) {
      this.revoked = true
      this.stop()
      throw new Error(body.error.message || 'This device was revoked.')
    }
    if (response.status === 429) {
      throw new Error(body.error?.message || 'Too many requests. Try again shortly.')
    }
    if (!response.ok || !body.accessToken || !body.refreshToken) {
      await rm(this.refreshPath, { force: true })
      this.accessToken = null
      throw sessionExpired()
    }
    this.accessToken = body.accessToken
    await this.writeRefreshToken(body.refreshToken)
    if (!this.profile) {
      const me = await this.request('/api/v1/auth/me')
      const profile = (await me.json()) as {
        name: string
        email: string
        role: string
        organization: { name: string }
        device: { id: string; name: string } | null
      }
      this.profile = {
        userName: profile.name,
        userEmail: profile.email,
        userRole: profile.role,
        organizationName: profile.organization.name,
        deviceId: profile.device?.id ?? '',
        deviceName: profile.device?.name ?? hostname(),
      }
      await this.forgetOtherAccounts()
      this.noteMissingFiles()
    }
  }

  private async request(
    pathname: string,
    init: {
      method?: string
      json?: unknown
      body?: Buffer
      headers?: Record<string, string>
      signal?: AbortSignal
      anonymous?: boolean
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'x-screenvault-client': 'desktop',
      'user-agent': `${brand.userAgent}/${appVersion}`,
      ...init.headers,
    }
    if (!init.anonymous && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`
    let body: BodyInit | undefined
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    } else if (init.body) {
      body = new Uint8Array(init.body)
    }
    const response = await fetch(new URL(pathname, this.settings.apiUrl), {
      method: init.method ?? 'GET',
      headers,
      body,
      signal: requestSignal(init.signal),
    })
    if (response.status === 401 && !init.anonymous && this.accessToken && !this.refreshInflight) {
      await this.refreshSession()
      if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`
      return fetch(new URL(pathname, this.settings.apiUrl), {
        method: init.method ?? 'GET',
        headers,
        body,
        signal: requestSignal(init.signal),
      })
    }
    return response
  }

  private key(): Buffer {
    const encrypted = readFileSync(this.keyPath)
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'The operating system secure store is unavailable, so screenshots cannot be encrypted.',
      )
    }
    const encoded = safeStorage.decryptString(encrypted)
    return Buffer.from(encoded, 'base64')
  }

  private async ensureKey(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'The operating system secure store is unavailable, so screenshots cannot be encrypted.',
      )
    }
    try {
      await readFile(this.keyPath)
    } catch {
      const key = randomBytes(32).toString('base64')
      await atomicWriteFile(this.keyPath, safeStorage.encryptString(key))
    }
  }

  private async syncSessions(): Promise<void> {
    // The desktop clock is the source of truth. Upload can lag behind it.
    if (!this.profile || !this.accessToken || this.revoked) return
    const since = new Date(Date.now() - 62 * 24 * 60 * 60 * 1000).toISOString()
    const sessions = this.queue.listSessions(since)
    if (sessions.length === 0) return
    try {
      const response = await this.request('/api/v1/monitoring-sessions', {
        method: 'POST',
        json: { sessions },
      })
      if (!response.ok) console.error('Monitored time could not be saved.', response.status)
    } catch (error) {
      console.error('Monitored time could not be saved.', error)
    }
  }

  private flushSegment(options?: { pause?: boolean }): void {
    if (!this.sessionId || !this.segmentStartedAt) return
    const now = Date.now()
    const delta = now - this.segmentStartedAt
    // One minute without mouse or keyboard input is inactive time.
    const split = splitActiveTime(delta, powerMonitor.getSystemIdleTime())
    this.accumulatedTrackedMs += split.activeMs
    this.accumulatedIdleMs += split.inactiveMs
    this.segmentStartedAt = this.monitoring && !options?.pause ? now : null
    this.queue.recordSession(
      this.sessionId,
      new Date(now - delta).toISOString(),
      this.accumulatedTrackedMs,
      this.accumulatedIdleMs,
    )
  }

  private openSegmentSplit(): { activeMs: number; inactiveMs: number } {
    if (!this.segmentStartedAt) return { activeMs: 0, inactiveMs: 0 }
    return splitActiveTime(Date.now() - this.segmentStartedAt, powerMonitor.getSystemIdleTime())
  }

  private weekTotals(): { label: string; totalMs: number; activeMs: number; isToday: boolean }[] {
    const now = new Date()
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    const weekday = monday.getDay()
    monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday))
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return labels.map((label, index) => {
      const start = new Date(monday)
      start.setDate(monday.getDate() + index)
      const end = new Date(start)
      end.setDate(start.getDate() + 1)
      const totals = this.queue.totalsBetween(start.toISOString(), end.toISOString())
      return {
        label,
        totalMs: totals.trackedMs + totals.idleMs,
        activeMs: totals.trackedMs,
        isToday: start.toDateString() === now.toDateString(),
      }
    })
  }

  private todayTotals(): { trackedMs: number; idleMs: number } {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return this.queue.totalsBetween(start.toISOString(), end.toISOString())
  }

  private stopTimers(): void {
    if (this.captureTimer) clearTimeout(this.captureTimer)
  }

  private async readSettings(): Promise<LocalSettings> {
    const stored = await this.readJson<Partial<LocalSettings>>(this.settingsPath)
    return {
      ...defaultSettings(),
      ...stored,
      apiUrl: process.env.SCREENVAULT_API_URL || stored?.apiUrl || defaultSettings().apiUrl,
    }
  }

  private async readRefreshToken(): Promise<string | null> {
    try {
      const encrypted = await readFile(this.refreshPath)
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(encrypted)
    } catch {
      return null
    }
  }

  private async writeRefreshToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system secure store is unavailable.')
    }
    await atomicWriteFile(this.refreshPath, safeStorage.encryptString(token))
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch {
      return null
    }
  }

  private async sweepTemporaryFiles(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await this.sweepTemporaryFiles(full)
      else if (entry.name.endsWith('.tmp')) await rm(full, { force: true })
    }
  }

  private get settingsPath() {
    return path.join(this.userData, 'settings.json')
  }
  private get devicePath() {
    return path.join(this.userData, 'device.json')
  }
  private get refreshPath() {
    return path.join(this.userData, 'refresh.bin')
  }
  private get keyPath() {
    return path.join(this.userData, 'device-key.bin')
  }
  private get notePath() {
    return path.join(this.userData, 'work-note.json')
  }
  private get runStatePath() {
    return path.join(this.userData, 'run-state.json')
  }
}

type RunState = {
  running: boolean
  markedAt?: string
  reason?: 'shutdown' | 'force_quit'
  reported?: boolean
}

/** If the OS booted after we last marked running, treat the exit as a reboot/shutdown. */
function uncleanExitReason(markedAt: string | undefined): 'shutdown' | 'force_quit' {
  const bootAt = Date.now() - uptime() * 1000
  const marked = markedAt ? Date.parse(markedAt) : Number.NaN
  if (!Number.isFinite(marked)) {
    // Legacy run-state without markedAt: a fresh boot is almost always a reboot.
    return uptime() < 30 * 60 ? 'shutdown' : 'force_quit'
  }
  // Allow a small clock skew window.
  return marked < bootAt - 60_000 ? 'shutdown' : 'force_quit'
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sessionExpired(): Error {
  const error = new Error('Session expired. Sign in again.')
  error.name = 'SessionExpiredError'
  return error
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(120_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function weekStartKey(date = new Date()): string {
  const copy = new Date(date)
  copy.setHours(12, 0, 0, 0)
  const day = copy.getDay()
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day))
  return localDateKey(copy)
}

function currentPlatform(): 'WINDOWS' | 'MACOS' | 'LINUX' | 'UNKNOWN' {
  if (platform() === 'win32') return 'WINDOWS'
  if (platform() === 'darwin') return 'MACOS'
  if (platform() === 'linux') return 'LINUX'
  return 'UNKNOWN'
}

async function errorFrom(response: Response, body: unknown): Promise<Error> {
  const message =
    typeof body === 'object' &&
    body &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error &&
    'message' in body.error
      ? String(body.error.message)
      : `Request failed (${response.status}).`
  return new Error(message)
}

async function httpError(response: Response, body?: unknown): Promise<UploadHttpError> {
  if (response.status === 403) {
    const payload = body ?? (await response.json().catch(() => null))
    if (typeof payload === 'object' && payload && 'error' in payload) {
      const error = payload.error as { code?: string }
      if (error.code === errorCodes.DEVICE_REVOKED) return new UploadHttpError(403)
    }
  }
  return new UploadHttpError(response.status)
}
