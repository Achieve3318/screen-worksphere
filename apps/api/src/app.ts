import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import {
  auditQuerySchema,
  captureActivityQuerySchema,
  captureEventQuerySchema,
  completeScreenshotSchema,
  createTeamSchema,
  createUserSchema,
  enrollSchema,
  loginSchema,
  monitoringSessionsSchema,
  paymentSummaryQuerySchema,
  policySchema,
  errorCodes,
  refreshSchema,
  registerSchema,
  submitReportSchema,
  createIncomeSchema,
  createPaymentRequestSchema,
  updateIncomeStatusSchema,
  updatePaymentStatusSchema,
  updateUserSchema,
  uploadSessionSchema,
} from '@screenvault/types'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  authenticate,
  requireAction,
  requireAuth,
  requireDevice,
  requireScreenshotRead,
} from './context.js'
import type { AppDeps } from './context.js'
import { ApiError, sendError } from './errors.js'
import * as chat from './services/chat.js'
import * as identity from './services/identity.js'
import * as payments from './services/payments.js'
import * as reports from './services/reports.js'
import * as receive from './services/screenshotReceive.js'
import * as shots from './services/screenshots.js'
import { verifyStorageToken } from './storage.js'

const heartbeatSchema = z.object({ appVersion: z.string().trim().min(1).max(40) })
const renameSchema = z.object({ name: z.string().trim().min(1).max(120) })
const contentQuerySchema = z.object({
  variant: z.enum(['full', 'thumbnail']).default('thumbnail'),
  download: z.enum(['0', '1']).optional(),
})

function meta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent']
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  }
}

function wantsDesktopToken(request: FastifyRequest): boolean {
  return request.headers['x-screenvault-client'] === 'desktop'
}

function setRefreshCookie(reply: FastifyReply, request: FastifyRequest, token: string) {
  const env = request.server.deps.env
  reply.setCookie('sv_refresh', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  })
}

function clearRefreshCookie(reply: FastifyReply, request: FastifyRequest) {
  const env = request.server.deps.env
  reply.clearCookie('sv_refresh', {
    path: '/api/v1/auth',
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
  })
}

function readRefreshToken(request: FastifyRequest, bodyToken?: string): string | undefined {
  return bodyToken || request.cookies.sv_refresh
}

function limit(max: number, timeWindow: string, disabled: boolean) {
  return { config: { rateLimit: disabled ? false : { max, timeWindow } } }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: deps.env.trustProxy,
    bodyLimit: deps.env.MAX_UPLOAD_BYTES,
    logger:
      deps.env.NODE_ENV === 'test'
        ? false
        : {
            level: deps.env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'body.password',
                'body.refreshToken',
                'body.accessToken',
              ],
              remove: true,
            },
          },
  })
  app.decorate('deps', deps)
  app.setErrorHandler((error, request, reply) => {
    void sendError(reply, request, error)
  })
  app.addContentTypeParser(
    ['image/webp', 'image/jpeg'],
    { parseAs: 'buffer', bodyLimit: deps.env.MAX_UPLOAD_BYTES },
    (_request, body, done) => {
      done(null, body)
    },
  )

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || deps.env.corsOrigins.includes(origin)) callback(null, true)
      else callback(new Error('Origin is not allowed.'), false)
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Checksum-Sha256', 'X-Screenvault-Client'],
  })
  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    max: deps.env.rateLimitDisabled ? 100_000 : 600,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.auth?.userId ?? request.ip,
    errorResponseBuilder: (_request, context) =>
      new ApiError(
        context.statusCode,
        errorCodes.RATE_LIMITED,
        'Too many requests. Try again shortly.',
      ),
  })
  app.addHook('onRequest', authenticate)

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }))
  app.get('/api/v1/health', { config: { rateLimit: false } }, async () => ({
    ok: true,
    service: 'screenvault-api',
  }))

  app.post(
    '/api/v1/auth/login',
    limit(8, '10 minutes', deps.env.rateLimitDisabled),
    async (request, reply) => {
      const body = loginSchema.parse(request.body)
      const session = await identity.login(
        deps.db,
        deps.env,
        body.email,
        body.password,
        meta(request),
      )
      setRefreshCookie(reply, request, session.refreshToken)
      return wantsDesktopToken(request) ? session : { ...session, refreshToken: undefined }
    },
  )

  app.post(
    '/api/v1/auth/refresh',
    limit(30, '1 minute', deps.env.rateLimitDisabled),
    async (request, reply) => {
      const body = refreshSchema.parse(request.body ?? {})
      const token = readRefreshToken(request, body.refreshToken)
      if (!token)
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Refresh token is required.' } })
      const session = await identity.rotateRefreshToken(deps.db, deps.env, token, meta(request))
      setRefreshCookie(reply, request, session.refreshToken)
      return wantsDesktopToken(request) ? session : { ...session, refreshToken: undefined }
    },
  )

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {})
    const token = readRefreshToken(request, body.refreshToken)
    if (token) await identity.revokeRefreshToken(deps.db, token, meta(request))
    clearRefreshCookie(reply, request)
    return { ok: true }
  })

  app.get('/api/v1/auth/me', async (request) => {
    const auth = requireAuth(request)
    return identity.currentProfile(deps.db, auth)
  })

  app.get(
    '/api/v1/auth/teams',
    limit(60, '1 minute', deps.env.rateLimitDisabled),
    async () => ({ items: await identity.listPublicTeams(deps.db) }),
  )

  app.post(
    '/api/v1/auth/register',
    limit(8, '10 minutes', deps.env.rateLimitDisabled),
    async (request) => {
      const body = registerSchema.parse(request.body)
      return identity.registerUser(deps.db, body, meta(request))
    },
  )

  app.post(
    '/api/v1/devices/enroll',
    limit(8, '10 minutes', deps.env.rateLimitDisabled),
    async (request, reply) => {
      const body = enrollSchema.parse(request.body)
      const session = await identity.enrollDevice(deps.db, deps.env, body, meta(request))
      setRefreshCookie(reply, request, session.refreshToken)
      return wantsDesktopToken(request) ? session : { ...session, refreshToken: undefined }
    },
  )

  app.post('/api/v1/devices/heartbeat', async (request) => {
    const auth = requireAuth(request)
    const body = heartbeatSchema.parse(request.body)
    return identity.heartbeat(deps.db, auth, body.appVersion)
  })

  app.post('/api/v1/devices/exit', async (request) => {
    const auth = requireAuth(request)
    const body = z
      .object({ reason: z.enum(['force_quit', 'shutdown']) })
      .parse(request.body)
    return identity.reportDeviceExit(deps.db, auth, body.reason, meta(request))
  })

  app.get('/api/v1/devices', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'devices:read')
    return { items: await identity.listDevices(deps.db, auth) }
  })

  app.get('/api/v1/devices/:id', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'devices:read')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.getDevice(deps.db, auth, params.id)
  })

  app.post('/api/v1/devices/:id/revoke', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'devices:revoke')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.revokeDevice(deps.db, auth, params.id, meta(request))
  })

  app.get('/api/v1/chat/inbox', async (request) => {
    const auth = requireAuth(request)
    return { items: await chat.listChatPeople(deps.db, auth) }
  })

  app.get('/api/v1/chat/messages', async (request) => {
    const auth = requireAuth(request)
    const query = z.object({ with: z.string().uuid() }).parse(request.query)
    return { items: await chat.listChatMessages(deps.db, auth, query.with) }
  })

  app.post(
    '/api/v1/chat/messages',
    limit(40, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const body = z
        .object({
          recipientId: z.string().uuid(),
          body: z.string().trim().min(1).max(2000),
        })
        .parse(request.body)
      return chat.sendChatMessage(deps.db, auth, body)
    },
  )

  app.post('/api/v1/chat/read', async (request) => {
    const auth = requireAuth(request)
    const body = z.object({ peerId: z.string().uuid() }).parse(request.body)
    await chat.markChatRead(deps.db, auth, body.peerId)
    return { ok: true }
  })

  app.get('/api/v1/users', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    return { items: await identity.listUsers(deps.db, auth) }
  })

  app.post('/api/v1/users', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const body = createUserSchema.parse(request.body)
    return identity.createUser(deps.db, auth, body, meta(request))
  })

  app.get('/api/v1/users/:id', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.getUser(deps.db, auth, params.id)
  })

  app.patch('/api/v1/users/:id', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = updateUserSchema.parse(request.body)
    return identity.updateUser(deps.db, auth, params.id, body, meta(request))
  })

  app.delete('/api/v1/users/:id', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.deleteUser(deps.db, deps.storage, auth, params.id, meta(request))
  })

  app.post('/api/v1/users/:id/disable', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.setUserDisabled(deps.db, auth, params.id, true, meta(request))
  })

  app.post('/api/v1/users/:id/enable', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return identity.setUserDisabled(deps.db, auth, params.id, false, meta(request))
  })

  app.post('/api/v1/users/:id/screenshot-receive', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return receive.requestScreenshotReceive(deps.db, auth, params.id, meta(request))
  })

  app.get('/api/v1/screenshot-receives', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    return receive.listScreenshotReceiveStatus(deps.db, auth)
  })

  app.get('/api/v1/screenshot-receives/pending', async (request) => {
    const auth = requireAuth(request)
    requireDevice(auth)
    return receive.pendingScreenshotReceive(deps.db, auth)
  })

  app.post('/api/v1/screenshot-receives/:id/respond', async (request) => {
    const auth = requireAuth(request)
    requireDevice(auth)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ accepted: z.boolean() }).parse(request.body)
    return receive.respondScreenshotReceive(
      deps.db,
      auth,
      params.id,
      body.accepted,
      meta(request),
    )
  })

  app.get('/api/v1/teams', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    return { items: await identity.listTeams(deps.db, auth) }
  })

  app.post('/api/v1/teams', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'teams:write')
    const body = createTeamSchema.parse(request.body)
    return identity.createTeam(deps.db, auth, body.name, meta(request))
  })

  app.get('/api/v1/policy', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'policy:read')
    return identity.getPolicy(deps.db, auth.organizationId)
  })

  app.put('/api/v1/policy', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'policy:write')
    const body = policySchema.parse(request.body)
    return identity.updatePolicy(deps.db, auth, body, meta(request))
  })

  app.get('/api/v1/reports/status', async (request) => {
    const auth = requireAuth(request)
    requireDevice(auth)
    const query = z
      .object({
        daily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weekly: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query)
    return reports.reportStatus(deps.db, auth, query.daily, query.weekly)
  })

  app.get('/api/v1/reports/mine', async (request) => {
    const auth = requireAuth(request)
    requireDevice(auth)
    const query = z
      .object({
        kind: z.enum(['DAILY', 'WEEKLY']).optional(),
      })
      .parse(request.query)
    return reports.listMyReports(deps.db, auth, query.kind)
  })

  app.get('/api/v1/reports', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    const query = z
      .object({
        userId: z.string().uuid().optional(),
        kind: z.enum(['DAILY', 'WEEKLY']).optional(),
      })
      .parse(request.query)
    return reports.listReports(deps.db, auth, query)
  })

  app.post(
    '/api/v1/reports/images',
    limit(30, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      requireDevice(auth)
      const body = z
        .object({
          contentType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
          data: z.string().min(1).max(8_000_000),
        })
        .parse(request.body)
      return reports.saveReportImage(deps.storage, auth, body)
    },
  )

  app.get('/api/v1/reports/images/:id', async (request, reply) => {
    const auth = requireAuth(request)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const image = await reports.readReportImage(deps.storage, auth, params.id)
    return reply
      .type(image.contentType)
      .header('cache-control', 'private, max-age=86400')
      .send(image.body)
  })

  app.post(
    '/api/v1/reports',
    limit(30, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      requireDevice(auth)
      const body = submitReportSchema.parse(request.body)
      return reports.submitReport(deps.db, auth, body)
    },
  )

  app.post('/api/v1/reports/:id/confirm', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:write')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    return reports.confirmReport(deps.db, auth, params.id, meta(request))
  })

  app.get('/api/v1/payments/payees', async (request) => {
    const auth = requireAuth(request)
    return payments.listPayees(deps.db, auth)
  })

  app.get('/api/v1/payments/summary', async (request) => {
    const auth = requireAuth(request)
    const query = paymentSummaryQuerySchema.parse(request.query)
    return payments.paymentSummary(deps.db, auth, query)
  })

  app.get('/api/v1/payments/requests', async (request) => {
    const auth = requireAuth(request)
    const query = z
      .object({ scope: z.enum(['mine', 'assigned', 'all']).default('mine') })
      .parse(request.query)
    return payments.listPaymentRequests(deps.db, auth, query.scope)
  })

  app.post(
    '/api/v1/payments/requests',
    limit(30, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const body = createPaymentRequestSchema.parse(request.body)
      return payments.createPaymentRequest(deps.db, deps.storage, auth, body, meta(request))
    },
  )

  app.patch('/api/v1/payments/requests/:id', async (request) => {
    const auth = requireAuth(request)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = updatePaymentStatusSchema.parse(request.body)
    return payments.updatePaymentStatus(
      deps.db,
      auth,
      params.id,
      body.status,
      body.status === 'PAID' ? (body.txUrl ?? null) : null,
      meta(request),
    )
  })

  app.get('/api/v1/payments/requests/:id/file', async (request, reply) => {
    const auth = requireAuth(request)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const file = await payments.readRequestFile(deps.db, deps.storage, auth, params.id)
    return reply
      .type(file.contentType)
      .header(
        'content-disposition',
        `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
      )
      .send(file.body)
  })

  app.get('/api/v1/payments/income', async (request) => {
    const auth = requireAuth(request)
    const query = z
      .object({ scope: z.enum(['mine', 'all', 'received']).default('mine') })
      .parse(request.query)
    return payments.listIncome(deps.db, auth, query.scope)
  })

  app.post(
    '/api/v1/payments/income',
    limit(30, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const body = createIncomeSchema.parse(request.body)
      return payments.createIncome(deps.db, deps.storage, auth, body, meta(request))
    },
  )

  app.patch('/api/v1/payments/income/:id', async (request) => {
    const auth = requireAuth(request)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = updateIncomeStatusSchema.parse(request.body)
    return payments.updateIncomeStatus(deps.db, auth, params.id, body.status, meta(request))
  })

  app.get('/api/v1/payments/income/:id/file', async (request, reply) => {
    const auth = requireAuth(request)
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const file = await payments.readIncomeFile(deps.db, deps.storage, auth, params.id)
    return reply
      .type(file.contentType)
      .header(
        'content-disposition',
        `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
      )
      .send(file.body)
  })

  app.patch('/api/v1/organization', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'org:manage')
    const body = renameSchema.parse(request.body)
    return identity.renameOrganization(deps.db, auth, body.name, meta(request))
  })

  app.get('/api/v1/dashboard/breakdown', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    const query = z
      .object({
        timeZone: z.string().trim().min(1).max(100).optional(),
        period: z.enum(['today', '7d', '30d']).default('7d'),
      })
      .parse(request.query)
    return shots.dashboardBreakdown(deps.db, auth, query.timeZone, query.period)
  })

  app.get('/api/v1/dashboard', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'users:read')
    const query = z
      .object({ timeZone: z.string().trim().min(1).max(100).optional() })
      .parse(request.query)
    return shots.dashboardSummary(deps.db, auth, query.timeZone)
  })

  app.post(
    '/api/v1/upload-sessions',
    limit(60, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const deviceId = requireDevice(auth)
      const body = uploadSessionSchema.parse(request.body)
      return shots.createUploadSession(deps.db, auth, deviceId, body.items)
    },
  )

  app.put(
    '/api/v1/screenshots/:id/content',
    limit(300, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const deviceId = requireDevice(auth)
      const params = z.object({ id: z.string().uuid() }).parse(request.params)
      const checksum = request.headers['x-checksum-sha256']
      const contentType = request.headers['content-type']
      if (!Buffer.isBuffer(request.body)) {
        throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Image body is required.')
      }
      return shots.putScreenshotContent(
        deps.db,
        deps.storage,
        auth,
        deviceId,
        params.id,
        request.body,
        typeof checksum === 'string' ? checksum : undefined,
        typeof contentType === 'string' ? contentType.split(';')[0] : undefined,
      )
    },
  )

  app.post(
    '/api/v1/screenshots/:id/complete',
    limit(300, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const deviceId = requireDevice(auth)
      const params = z.object({ id: z.string().uuid() }).parse(request.params)
      const body = completeScreenshotSchema.parse(request.body)
      return shots.completeScreenshot(
        deps.db,
        deps.storage,
        auth,
        deviceId,
        params.id,
        body.checksum,
      )
    },
  )

  app.post(
    '/api/v1/monitoring-sessions',
    limit(60, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      const deviceId = requireDevice(auth)
      const body = monitoringSessionsSchema.parse(request.body)
      return shots.recordMonitoringSessions(deps.db, auth, deviceId, body.sessions)
    },
  )

  app.get(
    '/api/v1/capture-activity',
    limit(120, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      requireScreenshotRead(auth)
      const query = captureActivityQuerySchema.parse(request.query)
      return shots.captureActivity(deps.db, auth, query)
    },
  )

  app.get(
    '/api/v1/capture-events',
    limit(120, '1 minute', deps.env.rateLimitDisabled),
    async (request) => {
      const auth = requireAuth(request)
      requireScreenshotRead(auth)
      const query = captureEventQuerySchema.parse(request.query)
      return shots.listCaptureEvents(deps.db, auth, query)
    },
  )

  app.get(
    '/api/v1/screenshots/:id/content',
    limit(8000, '1 minute', deps.env.rateLimitDisabled),
    async (request, reply) => {
      const auth = requireAuth(request)
      requireScreenshotRead(auth)
      const params = z.object({ id: z.string().uuid() }).parse(request.params)
      const query = contentQuerySchema.parse(request.query)
      const stored = await shots.readScreenshotContent(
        deps.db,
        deps.storage,
        auth,
        params.id,
        query.variant,
        query.download === '1',
        meta(request),
      )
      reply.header('cache-control', 'private, max-age=86400')
      reply.header('content-type', stored.contentType)
      if (query.download === '1') {
        reply.header('content-disposition', `attachment; filename="${params.id}"`)
      }
      return reply.send(stored.body)
    },
  )

  app.delete('/api/v1/screenshots/:id', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'screenshots:delete')
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await shots.deleteScreenshot(deps.db, deps.storage, auth, params.id, meta(request))
    return { ok: true }
  })

  app.get('/api/v1/audit-logs', async (request) => {
    const auth = requireAuth(request)
    requireAction(auth, 'audit:read')
    const query = auditQuerySchema.parse(request.query)
    const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null
    const filter: Record<string, unknown> = {
      organizationId: auth.organizationId,
      ...(query.action ? { action: query.action } : {}),
    }
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ]
    }
    const rows = await deps.db.AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean()
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    const actorIds = [
      ...new Set(page.map((row) => row.actorUserId).filter((id): id is string => Boolean(id))),
    ]
    const actors = actorIds.length
      ? await deps.db.User.find({ _id: { $in: actorIds } }).select('name email').lean()
      : []
    const actorById = new Map(
      actors.map((actor) => [actor._id, { id: actor._id, name: actor.name, email: actor.email }]),
    )
    return {
      items: page.map((row) => ({
        id: row._id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        actor: row.actorUserId ? (actorById.get(row.actorUserId) ?? null) : null,
      })),
      nextCursor:
        rows.length > query.limit && last ? encodeAuditCursor(last.createdAt, last._id) : null,
    }
  })

  app.get(
    '/api/v1/media/:token',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = z.object({ token: z.string().min(10) }).parse(request.params)
      const payload = verifyStorageToken(params.token, deps.env.MEDIA_SIGNING_SECRET)
      if (!payload)
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Media link expired.' } })
      const stored = await deps.storage.get(payload.key)
      if (!stored)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } })
      reply.header('cache-control', 'private, max-age=30')
      reply.header('content-type', stored.contentType)
      return reply.send(stored.body)
    },
  )

  return app
}

function encodeAuditCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  )
}

function decodeAuditCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: string
      id?: string
    }
    const createdAt = new Date(parsed.createdAt ?? '')
    if (!parsed.id || Number.isNaN(createdAt.getTime())) throw new Error('bad')
    return { createdAt, id: parsed.id }
  } catch {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Cursor is invalid.')
  }
}
