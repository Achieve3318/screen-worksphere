import { errorCodes } from '@screenvault/types'
import type { Db } from '../db.js'
import { writeAudit } from '../auditLog.js'
import type { AuthContext } from '../context.js'
import { ApiError, notFound } from '../errors.js'
import { withId } from '../models/index.js'

type RequestMeta = { ipAddress: string | null; userAgent: string | null }

export async function requestScreenshotReceive(
  db: Db,
  auth: AuthContext,
  userId: string,
  meta: RequestMeta,
) {
  const user = withId(
    await db.User.findOne({ _id: userId, organizationId: auth.organizationId }).lean(),
  )
  if (!user) throw notFound('That person was not found.')
  if (user.disabledAt) {
    throw new ApiError(409, errorCodes.CONFLICT, 'This account is disabled.')
  }
  await db.ScreenshotReceiveRequest.updateMany(
    { organizationId: auth.organizationId, userId, status: 'OPEN' },
    { $set: { status: 'SUPERSEDED' } },
  )
  const created = await db.ScreenshotReceiveRequest.create({
    organizationId: auth.organizationId,
    userId,
    requestedById: auth.userId,
  })
  const row = withId(created.toObject())!
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'screenshot.receive_requested',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { requestId: row.id },
    ...meta,
  })
  return {
    id: row.id,
    userId: user.id,
    createdAt: created.createdAt.toISOString(),
  }
}

export async function pendingScreenshotReceive(db: Db, auth: AuthContext) {
  if (!auth.deviceId) return { request: null }
  const requests = await db.ScreenshotReceiveRequest.find({
    organizationId: auth.organizationId,
    userId: auth.userId,
    status: 'OPEN',
  })
    .sort({ createdAt: -1 })
    .lean()
  for (const requestRaw of requests) {
    const request = withId(requestRaw)!
    const existing = await db.ScreenshotReceiveResponse.findOne({
      requestId: request.id,
      deviceId: auth.deviceId,
    }).lean()
    if (existing) continue
    const requester = withId(await db.User.findById(request.requestedById).select('name').lean())
    return {
      request: {
        id: request.id,
        requestedAt: new Date(requestRaw.createdAt).toISOString(),
        requestedByName: requester?.name ?? 'Someone',
      },
    }
  }
  return { request: null }
}

export async function respondScreenshotReceive(
  db: Db,
  auth: AuthContext,
  requestId: string,
  accepted: boolean,
  meta: RequestMeta,
) {
  if (!auth.deviceId) throw notFound()
  const request = withId(
    await db.ScreenshotReceiveRequest.findOne({
      _id: requestId,
      organizationId: auth.organizationId,
      userId: auth.userId,
    }).lean(),
  )
  if (!request) throw notFound('That upload request was not found.')
  const existing = await db.ScreenshotReceiveResponse.findOne({
    requestId,
    deviceId: auth.deviceId,
  }).lean()
  if (existing) {
    if (existing.accepted !== accepted) {
      throw new ApiError(409, errorCodes.CONFLICT, 'This request was already answered.')
    }
    return { ok: true as const, accepted }
  }
  if (request.status !== 'OPEN') {
    throw new ApiError(409, errorCodes.CONFLICT, 'This request is no longer waiting.')
  }
  await db.ScreenshotReceiveResponse.create({
    requestId,
    deviceId: auth.deviceId,
    accepted,
  })
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: accepted ? 'screenshot.receive_accepted' : 'screenshot.receive_declined',
    resourceType: 'user',
    resourceId: auth.userId,
    metadata: { requestId, deviceId: auth.deviceId },
    ...meta,
  })
  return { ok: true as const, accepted }
}

const UPLOAD_START_GRACE_MS = 45_000

export async function listScreenshotReceiveStatus(db: Db, auth: AuthContext) {
  const requests = await db.ScreenshotReceiveRequest.find({
    organizationId: auth.organizationId,
    status: 'OPEN',
  })
    .sort({ createdAt: -1 })
    .lean()
  const latestByUser = new Map<string, (typeof requests)[number]>()
  for (const request of requests) {
    if (!latestByUser.has(request.userId)) latestByUser.set(request.userId, request)
  }
  const items = []
  for (const request of latestByUser.values()) {
    const responses = await db.ScreenshotReceiveResponse.find({ requestId: request._id })
      .select('accepted createdAt')
      .lean()
    items.push(
      await receiveProgress(db, auth.organizationId, {
        id: request._id,
        userId: request.userId,
        responses,
      }),
    )
  }
  return { items }
}

async function receiveProgress(
  db: Db,
  organizationId: string,
  request: {
    id: string
    userId: string
    responses: { accepted: boolean; createdAt: Date }[]
  },
) {
  const accepted = request.responses.filter((item) => item.accepted)
  if (accepted.length === 0) {
    const devices = await db.Device.countDocuments({
      organizationId,
      userId: request.userId,
      revokedAt: null,
    })
    const declined = request.responses.filter((item) => !item.accepted).length
    return {
      userId: request.userId,
      requestId: request.id,
      phase: devices > 0 && declined >= devices ? ('declined' as const) : ('pending' as const),
      uploaded: 0,
      total: 0,
    }
  }
  const acceptedAt = accepted.reduce(
    (earliest, item) => (item.createdAt < earliest ? item.createdAt : earliest),
    accepted[0].createdAt,
  )
  const first = await db.Screenshot.findOne({
    organizationId,
    userId: request.userId,
    createdAt: { $gte: acceptedAt },
  })
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean()
  const lte = new Date((first?.createdAt ?? acceptedAt).getTime() + 60_000)
  const where = {
    organizationId,
    userId: request.userId,
    createdAt: { $gte: acceptedAt, $lte: lte },
  }
  const [total, uploaded, waiting] = await Promise.all([
    db.Screenshot.countDocuments(where),
    db.Screenshot.countDocuments({ ...where, status: 'STORED' }),
    db.Screenshot.countDocuments({ ...where, status: 'AWAITING_UPLOAD' }),
  ])
  const starting = total === 0 && Date.now() - acceptedAt.getTime() < UPLOAD_START_GRACE_MS
  return {
    userId: request.userId,
    requestId: request.id,
    phase: waiting > 0 || starting ? ('uploading' as const) : ('complete' as const),
    uploaded,
    total,
  }
}