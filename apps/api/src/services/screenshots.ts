import { sha256Hex, DEVICE_ONLINE_WITHIN_MS, USER_ACTIVE_WITHIN_MS } from '@screenvault/shared'
import {
  applyMonitoringSessions,
  localDateKey,
  sessionShareByBucket,
  shiftDateKey,
  summarizeCaptureActivity,
  zonedDateTime,
} from '../activitySummary.js'
import { errorCodes, type ScreenshotItemInput } from '@screenvault/types'
import type { Db } from '../db.js'
import { withId } from '../models/index.js'
import { writeAudit } from '../auditLog.js'
import type { AuthContext } from '../context.js'
import { ApiError, notFound } from '../errors.js'
import { assertImageMatches, createThumbnail } from '../images.js'
import { originalObjectKey, thumbnailObjectKey, type ScreenshotStorage } from '../storage.js'

type RequestMeta = { ipAddress: string | null; userAgent: string | null }

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function captureWindowError(capturedAt: Date): string | null {
  const skew = Date.now() - capturedAt.getTime()
  if (skew > 366 * 24 * 60 * 60 * 1000) return 'Screenshot timestamp is too old.'
  if (skew < -5 * 60 * 1000) return 'Screenshot timestamp is in the future.'
  return null
}

function shotScope(auth: AuthContext) {
  return {
    organizationId: auth.organizationId,
    ...(auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}),
  }
}

export async function createUploadSession(
  db: Db,
  auth: AuthContext,
  deviceId: string,
  items: ScreenshotItemInput[],
) {
  const session = await db.UploadSession.create({
    organizationId: auth.organizationId,
    userId: auth.userId,
    deviceId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
  const results: {
    screenshotId: string
    status: 'accepted' | 'already_stored' | 'awaiting_complete'
  }[] = []
  for (const item of items) {
    const capturedAt = new Date(item.capturedAt)
    const windowError = captureWindowError(capturedAt)
    if (windowError) throw new ApiError(400, errorCodes.VALIDATION_ERROR, windowError)
    const existing = await db.Screenshot.findById(item.screenshotId).lean()
    if (existing) {
      if (existing.organizationId !== auth.organizationId || existing.deviceId !== deviceId)
        throw notFound()
      if (existing.checksum !== item.checksum) {
        throw new ApiError(
          409,
          errorCodes.CONFLICT,
          'Screenshot id already exists with a different checksum.',
        )
      }
      results.push({
        screenshotId: item.screenshotId,
        status: existing.status === 'STORED' ? 'already_stored' : 'awaiting_complete',
      })
      continue
    }
    const event = await db.CaptureEvent.findById(item.captureEventId).lean()
    if (event && (event.organizationId !== auth.organizationId || event.deviceId !== deviceId)) {
      throw new ApiError(409, errorCodes.CONFLICT, 'Capture event id is already used.')
    }
    if (event && (blankToNull(item.activeWindow) || blankToNull(item.activeApp))) {
      await db.CaptureEvent.findByIdAndUpdate(event._id, {
        $set: {
          activeApp: event.activeApp ?? blankToNull(item.activeApp),
          activeWindow: event.activeWindow ?? blankToNull(item.activeWindow),
        },
      })
    }
    if (!event) {
      await db.CaptureEvent.create({
        _id: item.captureEventId,
        organizationId: auth.organizationId,
        userId: auth.userId,
        deviceId,
        capturedAt,
        timezone: item.timezone,
        workNote: item.workNote,
        activeApp: blankToNull(item.activeApp),
        activeWindow: blankToNull(item.activeWindow),
        idle: item.idle,
        activeMs: item.activeMs ?? null,
        intervalMs: item.intervalMs ?? null,
      })
    }
    await db.Screenshot.create({
      _id: item.screenshotId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      deviceId,
      captureEventId: item.captureEventId,
      displayId: item.displayId,
      displayIndex: item.displayIndex,
      displayName: item.displayName,
      width: item.width,
      height: item.height,
      originalWidth: item.originalWidth,
      originalHeight: item.originalHeight,
      scaleFactor: item.scaleFactor,
      fileSize: item.fileSize,
      checksum: item.checksum,
      contentType: item.contentType,
      encryptionVersion: item.encryptionVersion,
      capturedAt,
      status: 'AWAITING_UPLOAD',
    })
    results.push({ screenshotId: item.screenshotId, status: 'accepted' })
  }
  return { sessionId: session._id, expiresAt: session.expiresAt, items: results }
}

export async function putScreenshotContent(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  deviceId: string,
  screenshotId: string,
  body: Buffer,
  checksumHeader: string | undefined,
  contentType: string | undefined,
) {
  const shot = await db.Screenshot.findById(screenshotId).lean()
  if (!shot || shot.organizationId !== auth.organizationId || shot.deviceId !== deviceId)
    throw notFound()
  if (!checksumHeader || !contentType) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Checksum and content type are required.')
  }
  if (contentType !== shot.contentType) {
    throw new ApiError(
      400,
      errorCodes.VALIDATION_ERROR,
      'Content type does not match the screenshot.',
    )
  }
  const actual = sha256Hex(body)
  if (actual !== checksumHeader || actual !== shot.checksum) {
    throw new ApiError(
      409,
      errorCodes.CHECKSUM_MISMATCH,
      'Checksum does not match the uploaded bytes.',
    )
  }
  if (body.length !== shot.fileSize) {
    throw new ApiError(
      400,
      errorCodes.VALIDATION_ERROR,
      'File size does not match the declared size.',
    )
  }
  if (shot.status === 'STORED') return { status: 'already_stored' as const }
  await assertImageMatches(body, contentType)
  const key = originalObjectKey(auth.organizationId, shot._id)
  await storage.put(key, body, contentType)
  await db.Screenshot.findByIdAndUpdate(shot._id, {
    $set: { storageKey: key, fileSize: body.length },
  })
  await db.Device.findByIdAndUpdate(deviceId, { $set: { lastSeenAt: new Date() } })
  return { status: 'accepted' as const }
}

export async function completeScreenshot(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  deviceId: string,
  screenshotId: string,
  checksum: string,
) {
  const shot = await db.Screenshot.findById(screenshotId).lean()
  if (!shot || shot.organizationId !== auth.organizationId || shot.deviceId !== deviceId)
    throw notFound()
  if (shot.checksum !== checksum) {
    throw new ApiError(409, errorCodes.CHECKSUM_MISMATCH, 'Checksum does not match.')
  }
  if (shot.status === 'STORED') return { status: 'already_stored' as const, id: shot._id }
  if (!shot.storageKey)
    throw new ApiError(409, errorCodes.CONFLICT, 'Screenshot bytes have not been uploaded.')
  const stored = await storage.get(shot.storageKey)
  if (!stored || sha256Hex(stored.body) !== shot.checksum) {
    throw new ApiError(
      409,
      errorCodes.CHECKSUM_MISMATCH,
      'Stored object failed integrity verification.',
    )
  }
  const thumb = await createThumbnail(stored.body)
  const thumbKey = thumbnailObjectKey(auth.organizationId, shot._id)
  await storage.put(thumbKey, thumb, 'image/webp')
  const updated = await db.Screenshot.updateMany(
    { _id: shot._id, status: 'AWAITING_UPLOAD' },
    {
      $set: {
        status: 'STORED',
        uploadedAt: new Date(),
        thumbnailStorageKey: thumbKey,
      },
    },
  )
  if (updated.modifiedCount === 0) {
    const again = await db.Screenshot.findById(shot._id).lean()
    if (again?.status === 'STORED') return { status: 'already_stored' as const, id: shot._id }
  }
  return { status: 'stored' as const, id: shot._id }
}

function encodeCursor(capturedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ capturedAt: capturedAt.toISOString(), id })).toString(
    'base64url',
  )
}

function decodeCursor(cursor: string): { capturedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      capturedAt?: string
      id?: string
    }
    const capturedAt = new Date(parsed.capturedAt ?? '')
    if (!parsed.id || Number.isNaN(capturedAt.getTime())) throw new Error('bad cursor')
    return { capturedAt, id: parsed.id }
  } catch {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Cursor is invalid.')
  }
}

async function scopedUserIds(
  db: Db,
  auth: AuthContext,
  query: { userId?: string; teamId?: string },
): Promise<string[] | undefined | 'none'> {
  let teamUserIds: string[] | undefined
  if (query.teamId) {
    const team = await db.Team.findOne({
      _id: query.teamId,
      organizationId: auth.organizationId,
    }).lean()
    if (!team) throw notFound()
    const members = await db.TeamMember.find({ teamId: team._id }).select('userId').lean()
    teamUserIds = members.map((member) => member.userId)
  }
  const visible = auth.visibleUserIds
  let userIds: string[] | undefined
  if (query.userId) userIds = [query.userId]
  if (teamUserIds)
    userIds = userIds ? userIds.filter((id) => teamUserIds?.includes(id)) : teamUserIds
  if (visible) userIds = userIds ? userIds.filter((id) => visible.includes(id)) : visible
  if (userIds && userIds.length === 0) return 'none'
  return userIds
}

export async function listCaptureEvents(
  db: Db,
  auth: AuthContext,
  query: {
    cursor?: string
    limit: number
    from?: string
    to?: string
    userId?: string
    deviceId?: string
    teamId?: string
    display?: string
  },
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const userIds = await scopedUserIds(db, auth, query)
  if (userIds === 'none') return { items: [], nextCursor: null }

  const shotFilter: Record<string, unknown> = {
    organizationId: auth.organizationId,
    status: 'STORED',
  }
  if (query.display) {
    const escaped = query.display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    shotFilter.$or = [
      { displayId: query.display },
      { displayName: { $regex: new RegExp(`^${escaped}$`, 'i') } },
    ]
  }
  const eventIds = await db.Screenshot.distinct('captureEventId', shotFilter)
  if (eventIds.length === 0) return { items: [], nextCursor: null }

  const filter: Record<string, unknown> = {
    organizationId: auth.organizationId,
    _id: { $in: eventIds },
  }
  if (userIds) filter.userId = { $in: userIds }
  if (query.deviceId) filter.deviceId = query.deviceId
  if (query.from || query.to) {
    filter.capturedAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    }
  }
  if (cursor) {
    filter.$or = [
      { capturedAt: { $lt: cursor.capturedAt } },
      { capturedAt: cursor.capturedAt, _id: { $lt: cursor.id } },
    ]
  }

  const events = await db.CaptureEvent.find(filter)
    .sort({ capturedAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()
  const page = events.slice(0, query.limit)
  const last = page.at(-1)
  const pageIds = page.map((event) => event._id)
  const userIdSet = [...new Set(page.map((event) => event.userId))]
  const deviceIdSet = [...new Set(page.map((event) => event.deviceId))]
  const [users, devices, screenshots] = await Promise.all([
    db.User.find({ _id: { $in: userIdSet } })
      .select('name')
      .lean(),
    db.Device.find({ _id: { $in: deviceIdSet } })
      .select('name platform')
      .lean(),
    pageIds.length
      ? db.Screenshot.find({
          captureEventId: { $in: pageIds },
          status: 'STORED',
          ...(query.display
            ? {
                $or: shotFilter.$or as [{ displayId: string }, { displayName: { $regex: RegExp } }],
              }
            : {}),
        })
          .sort({ displayIndex: 1 })
          .lean()
      : [],
  ])
  const userById = new Map(users.map((user) => [user._id, { id: user._id, name: user.name }]))
  const deviceById = new Map(
    devices.map((device) => [
      device._id,
      { id: device._id, name: device.name, platform: device.platform },
    ]),
  )
  const shotsByEvent = new Map<string, typeof screenshots>()
  for (const shot of screenshots) {
    const list = shotsByEvent.get(shot.captureEventId) ?? []
    list.push(shot)
    shotsByEvent.set(shot.captureEventId, list)
  }
  return {
    items: page.map((event) => ({
      id: event._id,
      capturedAt: event.capturedAt,
      timezone: event.timezone,
      workNote: event.workNote,
      activeApp: event.activeApp,
      activeWindow: event.activeWindow,
      idle: event.idle,
      activeMs: event.activeMs ?? null,
      intervalMs: event.intervalMs ?? null,
      user: userById.get(event.userId) ?? { id: event.userId, name: '' },
      device:
        deviceById.get(event.deviceId) ?? {
          id: event.deviceId,
          name: '',
          platform: 'UNKNOWN',
        },
      screenshots: (shotsByEvent.get(event._id) ?? []).map((shot) => ({
        id: shot._id,
        displayId: shot.displayId,
        displayIndex: shot.displayIndex,
        displayName: shot.displayName,
        width: shot.width,
        height: shot.height,
        originalWidth: shot.originalWidth,
        originalHeight: shot.originalHeight,
        fileSize: shot.fileSize,
        contentType: shot.contentType,
        capturedAt: shot.capturedAt,
        contentPath: `/api/v1/screenshots/${shot._id}/content?variant=full`,
        thumbnailPath: `/api/v1/screenshots/${shot._id}/content?variant=thumbnail`,
      })),
    })),
    nextCursor: events.length > query.limit && last ? encodeCursor(last.capturedAt, last._id) : null,
  }
}

export async function captureActivity(
  db: Db,
  auth: AuthContext,
  query: {
    from: string
    to: string
    timeZone: string
    userId?: string
    deviceId?: string
    teamId?: string
  },
) {
  const from = new Date(query.from)
  const to = new Date(query.to)
  const span = to.getTime() - from.getTime()
  if (Number.isNaN(span) || span < 0 || span > 62 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Activity range must be 62 days or less.')
  }
  const userIds = await scopedUserIds(db, auth, query)
  if (userIds === 'none') return { days: [] }
  const shotScope: Record<string, unknown> = {
    organizationId: auth.organizationId,
    status: 'STORED',
    capturedAt: { $gte: from, $lte: to },
  }
  if (userIds) shotScope.userId = { $in: userIds }
  if (query.deviceId) shotScope.deviceId = query.deviceId
  const eventIds = await db.Screenshot.distinct('captureEventId', shotScope)
  const eventFilter: Record<string, unknown> = {
    organizationId: auth.organizationId,
    capturedAt: { $gte: from, $lte: to },
    ...(eventIds.length ? { _id: { $in: eventIds } } : { _id: { $in: [] as string[] } }),
  }
  if (userIds) eventFilter.userId = { $in: userIds }
  if (query.deviceId) eventFilter.deviceId = query.deviceId
  const sessionFilter: Record<string, unknown> = {
    organizationId: auth.organizationId,
    startedAt: { $gte: from, $lte: to },
  }
  if (userIds) sessionFilter.userId = { $in: userIds }
  if (query.deviceId) sessionFilter.deviceId = query.deviceId
  const [events, sessions] = await Promise.all([
    db.CaptureEvent.find(eventFilter).select('capturedAt idle').sort({ capturedAt: 1 }).limit(50_000).lean(),
    db.MonitoringSession.find(sessionFilter)
      .select('startedAt trackedMs idleMs')
      .lean(),
  ])
  return {
    days: applyMonitoringSessions(
      summarizeCaptureActivity(events, query.timeZone),
      sessions,
      query.timeZone,
    ),
  }
}

export async function recordMonitoringSessions(
  db: Db,
  auth: AuthContext,
  deviceId: string,
  sessions: {
    id: string
    startedAt: string
    endedAt: string
    trackedMs: number
    idleMs: number
  }[],
) {
  const ids = sessions.map((session) => session.id)
  const existing = await db.MonitoringSession.find({ _id: { $in: ids } })
    .select('organizationId deviceId')
    .lean()
  if (
    existing.some((row) => row.organizationId !== auth.organizationId || row.deviceId !== deviceId)
  ) {
    throw new ApiError(
      403,
      errorCodes.FORBIDDEN,
      'That monitoring session belongs to another device.',
    )
  }
  for (const session of sessions) {
    await db.MonitoringSession.updateOne(
      { _id: session.id },
      {
        $set: {
          endedAt: new Date(session.endedAt),
          trackedMs: session.trackedMs,
          idleMs: session.idleMs,
        },
        $setOnInsert: {
          organizationId: auth.organizationId,
          userId: auth.userId,
          deviceId,
          startedAt: new Date(session.startedAt),
        },
      },
      { upsert: true },
    )
  }
  return { saved: sessions.length }
}

export async function readScreenshotContent(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  screenshotId: string,
  variant: 'full' | 'thumbnail',
  download: boolean,
  meta: RequestMeta,
) {
  const shot = await db.Screenshot.findOne({
    _id: screenshotId,
    status: 'STORED',
    ...shotScope(auth),
  }).lean()
  if (!shot?.storageKey) throw notFound()
  const key =
    variant === 'thumbnail' ? (shot.thumbnailStorageKey ?? shot.storageKey) : shot.storageKey
  let stored = await storage.get(key)
  if (!stored && variant === 'thumbnail' && shot.storageKey) {
    const original = await storage.get(shot.storageKey)
    if (!original) throw notFound()
    try {
      const thumb = await createThumbnail(original.body)
      const thumbKey = thumbnailObjectKey(shot.organizationId, shot._id)
      await storage.put(thumbKey, thumb, 'image/webp')
      await db.Screenshot.findByIdAndUpdate(shot._id, {
        $set: { thumbnailStorageKey: thumbKey },
      })
      stored = { body: thumb, contentType: 'image/webp' }
    } catch {
      stored = original
    }
  }
  if (!stored) throw notFound()
  if (download || variant === 'full') {
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: download ? 'screenshot.downloaded' : 'screenshot.viewed',
      resourceType: 'screenshot',
      resourceId: shot._id,
      metadata: { variant },
      ...meta,
    })
  }
  return stored
}

export async function deleteScreenshot(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  screenshotId: string,
  meta: RequestMeta,
) {
  const shot = await db.Screenshot.findOne({
    _id: screenshotId,
    organizationId: auth.organizationId,
  }).lean()
  if (!shot) throw notFound()
  if (shot.storageKey) await storage.delete(shot.storageKey)
  if (shot.thumbnailStorageKey) await storage.delete(shot.thumbnailStorageKey)
  await db.Screenshot.findByIdAndDelete(shot._id)
  const remaining = await db.Screenshot.countDocuments({ captureEventId: shot.captureEventId })
  if (remaining === 0)
    await db.CaptureEvent.findByIdAndDelete(shot.captureEventId).catch(() => undefined)
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'screenshot.deleted',
    resourceType: 'screenshot',
    resourceId: screenshotId,
    ...meta,
  })
}

export async function dashboardSummary(db: Db, auth: AuthContext, timeZone = 'UTC') {
  const now = Date.now()
  const onlineSince = new Date(now - DEVICE_ONLINE_WITHIN_MS)
  const activeSince = new Date(now - USER_ACTIVE_WITHIN_MS)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const userFilter = auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}
  const deviceWhere = { organizationId: auth.organizationId, revokedAt: null, ...userFilter }
  const activeDeviceUserIds = await db.Device.distinct('userId', {
    ...deviceWhere,
    lastSeenAt: { $gte: activeSince },
  })
  const userVisibility = userVisibilityWhere(auth)
  const [
    activeUsers,
    devices,
    screenshotsToday,
    pendingUploads,
    storageAgg,
    onlineDevices,
    offlineDevices,
  ] = await Promise.all([
    db.User.countDocuments({
      ...userVisibility,
      disabledAt: null,
      ...(activeDeviceUserIds.length ? { _id: { $in: activeDeviceUserIds } } : { _id: { $in: [] as string[] } }),
    }),
    db.Device.countDocuments(deviceWhere),
    db.Screenshot.countDocuments({
      organizationId: auth.organizationId,
      status: 'STORED',
      capturedAt: { $gte: start },
      ...userFilter,
    }),
    db.Screenshot.countDocuments({
      organizationId: auth.organizationId,
      status: { $in: ['AWAITING_UPLOAD', 'FAILED'] },
      ...userFilter,
    }),
    db.Screenshot.aggregate<{ total: number }>([
      { $match: { organizationId: auth.organizationId, status: 'STORED', ...userFilter } },
      { $group: { _id: null, total: { $sum: '$fileSize' } } },
    ]),
    db.Device.countDocuments({ ...deviceWhere, lastSeenAt: { $gte: onlineSince } }),
    db.Device.countDocuments({ ...deviceWhere, lastSeenAt: { $lt: onlineSince } }),
  ])
  const storage = storageAgg[0]?.total ?? 0
  const zone = safeTimeZone(timeZone)
  const todayKey = localDateKey(new Date(), zone)
  const dateKeys = Array.from({ length: 7 }, (_, index) => shiftDateKey(todayKey, index - 6))
  const from = zonedDateTime(dateKeys[0] ?? todayKey, zone)
  const to = zonedDateTime(shiftDateKey(todayKey, 1), zone)
  const shotScopeFilter = {
    organizationId: auth.organizationId,
    status: 'STORED',
    capturedAt: { $gte: from, $lt: to },
    ...userFilter,
  }
  const storedEventIds = await db.Screenshot.distinct('captureEventId', shotScopeFilter)
  const eventScope: Record<string, unknown> = {
    organizationId: auth.organizationId,
    capturedAt: { $gte: from, $lt: to },
    ...(storedEventIds.length ? { _id: { $in: storedEventIds } } : { _id: { $in: [] as string[] } }),
  }
  if (auth.visibleUserIds) eventScope.userId = { $in: auth.visibleUserIds }
  const todayFrom = zonedDateTime(todayKey, zone)
  const todayEventIds = await db.Screenshot.distinct('captureEventId', {
    organizationId: auth.organizationId,
    status: 'STORED',
    capturedAt: { $gte: todayFrom, $lt: to },
    ...userFilter,
  })
  const [events, sessions, shots, appEvents] = await Promise.all([
    db.CaptureEvent.find(eventScope).select('capturedAt idle').limit(50_000).lean(),
    db.MonitoringSession.find({
      organizationId: auth.organizationId,
      ...userFilter,
      startedAt: { $gte: from, $lt: to },
    })
      .select('startedAt trackedMs idleMs')
      .lean(),
    db.Screenshot.find(shotScopeFilter).select('capturedAt').limit(20_000).lean(),
    todayEventIds.length
      ? db.CaptureEvent.find({
          _id: { $in: todayEventIds },
          organizationId: auth.organizationId,
          ...(auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}),
        })
          .select('activeApp')
          .lean()
      : [],
  ])
  const appCounts = new Map<string, number>()
  for (const row of appEvents) {
    const name = row.activeApp?.trim() || 'Not recorded'
    appCounts.set(name, (appCounts.get(name) ?? 0) + 1)
  }
  const appRows = [...appCounts.entries()].map(([name, count]) => ({ name, count }))
  const activity = new Map(
    applyMonitoringSessions(summarizeCaptureActivity(events, zone), sessions, zone).map((day) => [
      day.date,
      day,
    ]),
  )
  const screenshotsByDay = new Map<string, number>()
  const hours = Array.from({ length: 24 }, () => 0)
  for (const shot of shots) {
    const key = localDateKey(shot.capturedAt, zone)
    screenshotsByDay.set(key, (screenshotsByDay.get(key) ?? 0) + 1)
    if (key !== todayKey) continue
    const hour = localHourInZone(shot.capturedAt, zone)
    if (hour >= 0 && hour < 24) hours[hour] = (hours[hour] ?? 0) + 1
  }
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' })
  return {
    activeUsers,
    registeredDevices: devices,
    screenshotsToday,
    pendingOrFailedUploads: pendingUploads,
    storageUsedBytes: storage,
    onlineDevices,
    offlineDevices,
    days: dateKeys.map((date) => {
      const entry = activity.get(date)
      return {
        date,
        label: weekday.format(zonedDateTime(date, zone)),
        totalMs: entry?.totalMs ?? 0,
        activeMs: entry?.activeMs ?? 0,
        screenshots: screenshotsByDay.get(date) ?? 0,
      }
    }),
    hours,
    apps: appRows
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  }
}

export async function dashboardBreakdown(
  db: Db,
  auth: AuthContext,
  timeZone = 'UTC',
  period: 'today' | '7d' | '30d' = '7d',
) {
  const zone = safeTimeZone(timeZone)
  const todayKey = localDateKey(new Date(), zone)
  const span = period === '30d' ? 30 : period === '7d' ? 7 : 1
  const dateKeys = Array.from({ length: span }, (_, index) => shiftDateKey(todayKey, index - (span - 1)))
  const from = zonedDateTime(dateKeys[0] ?? todayKey, zone)
  const to = zonedDateTime(shiftDateKey(todayKey, 1), zone)
  const userFilter = auth.visibleUserIds ? { _id: { $in: auth.visibleUserIds } } : {}
  const activityFilter = auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}
  let teamFilter: Record<string, unknown> = { organizationId: auth.organizationId }
  if (auth.role === 'MANAGER' || auth.role === 'MEMBER') {
    const memberships = await db.TeamMember.find({ userId: auth.userId }).select('teamId').lean()
    teamFilter = { _id: { $in: memberships.map((item) => item.teamId) } }
  }
  const [peopleRaw, teamsRaw, sessions, shots] = await Promise.all([
    db.User.find({ organizationId: auth.organizationId, ...userFilter })
      .select('name')
      .sort({ name: 1 })
      .lean(),
    db.Team.find(teamFilter).select('name').sort({ name: 1 }).lean(),
    db.MonitoringSession.find({
      organizationId: auth.organizationId,
      ...activityFilter,
      startedAt: { $lt: to },
      endedAt: { $gt: from },
    })
      .select('userId startedAt endedAt trackedMs idleMs')
      .lean(),
    db.Screenshot.find({
      organizationId: auth.organizationId,
      status: 'STORED',
      ...activityFilter,
      capturedAt: { $gte: from, $lt: to },
    })
      .select('userId capturedAt')
      .limit(20_000)
      .lean(),
  ])
  const userIds = peopleRaw.map((person) => person._id)
  const memberships = userIds.length
    ? await db.TeamMember.find({ userId: { $in: userIds } }).select('userId teamId').lean()
    : []
  const teamIdsByUser = new Map<string, string[]>()
  for (const member of memberships) {
    const list = teamIdsByUser.get(member.userId) ?? []
    list.push(member.teamId)
    teamIdsByUser.set(member.userId, list)
  }
  const people = peopleRaw.map((person) => ({
    id: person._id,
    name: person.name,
    teamMembers: (teamIdsByUser.get(person._id) ?? []).map((teamId) => ({ teamId })),
  }))
  const teams = teamsRaw.map((team) => ({ id: team._id, name: team.name }))
  const buckets =
    period === 'today'
      ? Array.from({ length: 24 }, (_, hour) => {
          const start = from.getTime() + hour * 60 * 60 * 1000
          return { start, end: start + 60 * 60 * 1000 }
        })
      : dateKeys.map((date) => ({
          start: zonedDateTime(date, zone).getTime(),
          end: zonedDateTime(shiftDateKey(date, 1), zone).getTime(),
        }))
  const labels =
    period === 'today'
      ? Array.from({ length: 24 }, (_, hour) => hourLabel(hour))
      : dateKeys.map((date) =>
          new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(
            zonedDateTime(date, zone),
          ),
        )
  const byUser = new Map(
    people.map((person) => [
      person.id,
      {
        id: person.id,
        name: person.name,
        teamIds: person.teamMembers.map((member) => member.teamId),
        totalMs: 0,
        activeMs: 0,
        screenshots: 0,
        series: buckets.map(() => 0),
      },
    ]),
  )
  for (const session of sessions) {
    const person = byUser.get(session.userId)
    if (!person) continue
    const active = sessionShareByBucket(
      session.startedAt.getTime(),
      session.endedAt.getTime(),
      session.trackedMs,
      buckets,
    )
    const total = sessionShareByBucket(
      session.startedAt.getTime(),
      session.endedAt.getTime(),
      session.trackedMs + session.idleMs,
      buckets,
    )
    active.forEach((value, index) => {
      person.series[index] = (person.series[index] ?? 0) + value
      person.activeMs += value
    })
    person.totalMs += total.reduce((sum, value) => sum + value, 0)
  }
  for (const shot of shots) {
    const person = byUser.get(shot.userId)
    if (!person) continue
    const at = shot.capturedAt.getTime()
    if (at >= from.getTime() && at < to.getTime()) person.screenshots += 1
  }
  const users = [...byUser.values()]
    .map(({ teamIds: _teamIds, ...person }) => person)
    .sort((left, right) => right.activeMs - left.activeMs || left.name.localeCompare(right.name))
  const teamTotals = teams.map((team) => ({
    id: team.id,
    name: team.name,
    members: 0,
    totalMs: 0,
    activeMs: 0,
    screenshots: 0,
    series: buckets.map(() => 0),
  }))
  const teamIndex = new Map(teamTotals.map((team) => [team.id, team]))
  for (const person of byUser.values()) {
    for (const teamId of person.teamIds) {
      const team = teamIndex.get(teamId)
      if (!team) continue
      team.members += 1
      team.totalMs += person.totalMs
      team.activeMs += person.activeMs
      team.screenshots += person.screenshots
      person.series.forEach((value, index) => {
        team.series[index] = (team.series[index] ?? 0) + value
      })
    }
  }
  teamTotals.sort((left, right) => right.activeMs - left.activeMs || left.name.localeCompare(right.name))
  return { labels, users, teams: teamTotals }
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${clock}${suffix}`
}

function safeTimeZone(timeZone: string): string {
  try {
    Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}

function localHourInZone(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((item) => item.type === 'hour')
  const hour = Number(part?.value ?? '0')
  return hour === 24 ? 0 : hour
}

function userVisibilityWhere(auth: AuthContext): {
  organizationId: string
  _id?: { $in: string[] }
} {
  if (!auth.visibleUserIds) return { organizationId: auth.organizationId }
  return { organizationId: auth.organizationId, _id: { $in: auth.visibleUserIds } }
}

export async function runRetention(
  db: Db,
  storage: ScreenshotStorage,
  now = new Date(),
) {
  const policies = await db.ScreenshotPolicy.find({
    serverRetentionDays: { $ne: null },
  }).lean()
  for (const policy of policies) {
    if (!policy.serverRetentionDays) continue
    const cutoff = new Date(now.getTime() - policy.serverRetentionDays * 24 * 60 * 60 * 1000)
    const shots = await db.Screenshot.find({
      organizationId: policy.organizationId,
      capturedAt: { $lt: cutoff },
    })
      .sort({ capturedAt: 1 })
      .limit(200)
      .lean()
    const deleted: string[] = []
    for (const shot of shots) {
      if (shot.storageKey) await storage.delete(shot.storageKey)
      if (shot.thumbnailStorageKey) await storage.delete(shot.thumbnailStorageKey)
      await db.Screenshot.findByIdAndDelete(shot._id)
      deleted.push(shot._id)
    }
    if (deleted.length) {
      const remainingIds = await db.Screenshot.distinct('captureEventId', {
        organizationId: policy.organizationId,
      })
      await db.CaptureEvent.deleteMany({
        organizationId: policy.organizationId,
        ...(remainingIds.length ? { _id: { $nin: remainingIds } } : {}),
      })
      await writeAudit(db, {
        organizationId: policy.organizationId,
        actorUserId: null,
        action: 'retention.deleted',
        resourceType: 'screenshot',
        resourceId: null,
        metadata: { count: deleted.length, screenshotIds: deleted.slice(0, 50) },
      })
    }
  }
}
