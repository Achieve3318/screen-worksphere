import type { OrgRole } from '@screenvault/shared'
import { canReadScreenshots, roleAllows, type Action } from '@screenvault/shared'
import { errorCodes } from '@screenvault/types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from './db.js'
import type { Env } from './env.js'
import { ApiError, forbidden, unauthorized } from './errors.js'
import { withId } from './models/index.js'
import { verifyAccessToken } from './security.js'
import type { ScreenshotStorage } from './storage.js'

export type AppDeps = {
  db: Db
  storage: ScreenshotStorage
  env: Env
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps
  }
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export type AuthContext = {
  userId: string
  organizationId: string
  role: OrgRole
  deviceId: string | null
  email: string
  name: string
  /** Null means every user in the organization. */
  visibleUserIds: string[] | null
  screenshotAccessRoles: OrgRole[]
}

export async function loadAuth(
  db: Db,
  env: Env,
  header: string | undefined,
): Promise<AuthContext> {
  if (!header?.startsWith('Bearer ')) throw unauthorized()
  const claims = await verifyAccessToken(header.slice('Bearer '.length), env)
  const user = withId(await db.User.findById(claims.userId).lean())
  if (!user || user.organizationId !== claims.organizationId) throw unauthorized()
  if (user.disabledAt) {
    throw forbidden('This account is disabled.')
  }
  if (claims.deviceId) {
    const device = withId(await db.Device.findById(claims.deviceId).lean())
    if (!device || device.userId !== user.id || device.organizationId !== user.organizationId) {
      throw unauthorized('Device session is no longer valid.')
    }
    if (device.revokedAt) {
      throw new ApiError(
        403,
        errorCodes.DEVICE_REVOKED,
        'This device was revoked and needs reauthorization.',
      )
    }
  }
  const policy = await db.ScreenshotPolicy.findOne({ organizationId: user.organizationId }).lean()
  const accessRoles = (policy?.screenshotAccessRoles ?? [
    'OWNER',
    'ADMIN',
    'MANAGER',
  ]) as OrgRole[]
  let visibleUserIds: string[] | null = null
  if (user.role === 'MEMBER') {
    visibleUserIds = [user.id]
  } else if (user.role === 'MANAGER') {
    const memberships = await db.TeamMember.find({ userId: user.id }).select('teamId').lean()
    const teamIds = memberships.map((item) => item.teamId)
    const peers = teamIds.length
      ? await db.TeamMember.find({ teamId: { $in: teamIds } }).select('userId').lean()
      : []
    visibleUserIds = [...new Set([user.id, ...peers.map((item) => item.userId)])]
  }
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role as OrgRole,
    deviceId: claims.deviceId,
    email: user.email,
    name: user.name,
    visibleUserIds,
    screenshotAccessRoles: accessRoles,
  }
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized()
  return request.auth
}

export function requireAction(auth: AuthContext, action: Action): void {
  if (!roleAllows(auth.role, action)) throw forbidden()
}

export function requireScreenshotRead(auth: AuthContext): void {
  if (!canReadScreenshots(auth.role, auth.screenshotAccessRoles)) throw forbidden()
}

export function requireDevice(auth: AuthContext): string {
  if (!auth.deviceId) throw forbidden('A device session is required.')
  return auth.deviceId
}

export function userVisibility(auth: AuthContext): {
  organizationId: string
  _id?: { $in: string[] }
} {
  if (!auth.visibleUserIds) return { organizationId: auth.organizationId }
  return { organizationId: auth.organizationId, _id: { $in: auth.visibleUserIds } }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  void _reply
  const header = request.headers.authorization
  if (!header) return
  const deps = request.server.deps
  request.auth = await loadAuth(deps.db, deps.env, header)
}