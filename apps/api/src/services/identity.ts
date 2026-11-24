import { randomUUID } from 'node:crypto'
import type { OrgRole } from '@screenvault/shared'
import { effectiveIntervalSeconds } from '@screenvault/shared'
import {
  errorCodes,
  type CreateUserInput,
  type PolicyInput,
  type RegisterInput,
  type UpdateUserInput,
} from '@screenvault/types'
import type { Db } from '../db.js'
import { writeAudit } from '../auditLog.js'
import type { AuthContext } from '../context.js'
import { userVisibility } from '../context.js'
import type { Env } from '../env.js'
import { ApiError, forbidden, notFound } from '../errors.js'
import type { ScreenshotStorage } from '../storage.js'
import { withId, withIds } from '../models/index.js'
import {
  dummyHash,
  hashPassword,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../security.js'

type RequestMeta = { ipAddress: string | null; userAgent: string | null }

function publicUser(
  user: {
    id: string
    email: string
    name: string
    role: OrgRole
    disabledAt: Date | null
    createdAt: Date
    organizationId: string
  },
  teams: { id: string; name: string }[],
  deviceCount: number,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
    organizationId: user.organizationId,
    teams,
    deviceCount,
  }
}

async function enrichUsersPublic(
  db: Db,
  users: Array<{
    _id: string
    email: string
    name: string
    role: string
    disabledAt: Date | null
    createdAt: Date
    organizationId: string
  }>,
) {
  if (users.length === 0) return []
  const userIds = users.map((user) => user._id)
  const memberships = await db.TeamMember.find({ userId: { $in: userIds } }).lean()
  const teamIds = [...new Set(memberships.map((item) => item.teamId))]
  const teams = teamIds.length
    ? withIds(await db.Team.find({ _id: { $in: teamIds } }).select('name').lean())
    : []
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const deviceAgg = await db.Device.aggregate<{ _id: string; count: number }>([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
  ])
  const deviceCountByUser = new Map(deviceAgg.map((row) => [row._id, row.count]))
  const teamsByUser = new Map<string, { id: string; name: string }[]>()
  for (const member of memberships) {
    const team = teamById.get(member.teamId)
    if (!team) continue
    const list = teamsByUser.get(member.userId) ?? []
    list.push({ id: team.id, name: team.name })
    teamsByUser.set(member.userId, list)
  }
  return users.map((user) =>
    publicUser(
      {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role as OrgRole,
        disabledAt: user.disabledAt,
        createdAt: user.createdAt,
        organizationId: user.organizationId,
      },
      teamsByUser.get(user._id) ?? [],
      deviceCountByUser.get(user._id) ?? 0,
    ),
  )
}

async function issueSession(
  db: Db,
  env: Env,
  user: { id: string; organizationId: string },
  deviceId: string | null,
  meta: RequestMeta,
) {
  const refreshToken = newRefreshToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000)
  await db.RefreshToken.create({
    userId: user.id,
    organizationId: user.organizationId,
    deviceId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  })
  const accessToken = await signAccessToken(
    { userId: user.id, organizationId: user.organizationId, deviceId },
    env,
  )
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS }
}

export async function login(
  db: Db,
  env: Env,
  email: string,
  password: string,
  meta: RequestMeta,
) {
  const userRaw = await db.User.findOne({ email: email.toLowerCase() }).lean()
  const user = withId(userRaw)
  const valid = await verifyPassword(userRaw?.passwordHash ?? (await dummyHash()), password)
  if (!user || !valid) {
    if (user) {
      await writeAudit(db, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'login.failed',
        resourceType: 'user',
        resourceId: user.id,
        ...meta,
      })
    }
    throw new ApiError(401, errorCodes.UNAUTHORIZED, 'Email or password is incorrect.')
  }
  if (user.disabledAt) {
    throw new ApiError(403, errorCodes.USER_DISABLED, 'This account is disabled.')
  }
  const organization = withId(await db.Organization.findById(user.organizationId).lean())
  const session = await issueSession(db, env, user, null, meta)
  await writeAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: 'login',
    resourceType: 'user',
    resourceId: user.id,
    ...meta,
  })
  return {
    ...session,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organization: {
        id: organization!.id,
        name: organization!.name,
        slug: organization!.slug,
      },
    },
  }
}

export async function listPublicTeams(db: Db) {
  const teams = withIds(await db.Team.find({}).lean())
  const orgIds = [...new Set(teams.map((team) => team.organizationId))]
  const orgs = withIds(
    orgIds.length ? await db.Organization.find({ _id: { $in: orgIds } }).select('name').lean() : [],
  )
  const orgById = new Map(orgs.map((org) => [org.id, org.name]))
  return teams
    .map((team) => ({
      id: team.id,
      name: team.name,
      organizationName: orgById.get(team.organizationId) ?? '',
    }))
    .sort(
      (a, b) =>
        a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name),
    )
}

export async function registerUser(db: Db, input: RegisterInput, meta: RequestMeta) {
  const team = withId(await db.Team.findById(input.teamId).lean())
  if (!team) throw new ApiError(404, errorCodes.NOT_FOUND, 'That team was not found.')
  const email = input.email.toLowerCase()
  const existing = await db.User.findOne({ email }).lean()
  if (existing) {
    throw new ApiError(409, errorCodes.CONFLICT, 'An account with that email already exists.')
  }
  const user = await db.User.create({
    organizationId: team.organizationId,
    email,
    name: input.name,
    role: 'MEMBER',
    passwordHash: await hashPassword(input.password),
  })
  await db.TeamMember.create({ teamId: team.id, userId: user.id, teamRole: 'MEMBER' })
  const row = withId(user.toObject())!
  await writeAudit(db, {
    organizationId: team.organizationId,
    actorUserId: row.id,
    action: 'user.registered',
    resourceType: 'user',
    resourceId: row.id,
    metadata: { email, teamId: team.id },
    ...meta,
  })
  return { id: row.id, email: row.email, name: row.name }
}

export async function enrollDevice(
  db: Db,
  env: Env,
  input: {
    email: string
    password: string
    deviceId?: string
    device: {
      name: string
      platform: 'WINDOWS' | 'MACOS' | 'LINUX' | 'UNKNOWN'
      osVersion: string
      appVersion: string
    }
  },
  meta: RequestMeta,
) {
  const userRaw = await db.User.findOne({ email: input.email.toLowerCase() }).lean()
  const user = withId(userRaw)
  const valid = await verifyPassword(userRaw?.passwordHash ?? (await dummyHash()), input.password)
  if (!user || !valid) {
    throw new ApiError(401, errorCodes.UNAUTHORIZED, 'Email or password is incorrect.')
  }
  if (user.disabledAt)
    throw new ApiError(403, errorCodes.USER_DISABLED, 'This account is disabled.')

  let deviceId = input.deviceId
  const existing = deviceId ? withId(await db.Device.findById(deviceId).lean()) : null
  const sameUser = existing?.userId === user.id
  if (existing && sameUser && existing.revokedAt) {
    throw new ApiError(
      403,
      errorCodes.DEVICE_REVOKED,
      'This device was revoked and needs reauthorization.',
    )
  }
  if (existing && sameUser && deviceId) {
    await db.Device.findByIdAndUpdate(deviceId, {
      $set: {
        name: input.device.name,
        platform: input.device.platform,
        osVersion: input.device.osVersion,
        appVersion: input.device.appVersion,
        lastSeenAt: new Date(),
      },
    })
  } else {
    deviceId = randomUUID()
    await db.Device.create({
      _id: deviceId,
      organizationId: user.organizationId,
      userId: user.id,
      name: input.device.name,
      platform: input.device.platform,
      osVersion: input.device.osVersion,
      appVersion: input.device.appVersion,
    })
  }

  const organization = withId(await db.Organization.findById(user.organizationId).lean())
  const session = await issueSession(db, env, user, deviceId, meta)
  await writeAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: 'device.enrolled',
    resourceType: 'device',
    resourceId: deviceId,
    metadata: { platform: input.device.platform, name: input.device.name },
    ...meta,
  })
  return {
    ...session,
    deviceId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organization: {
        id: organization!.id,
        name: organization!.name,
        slug: organization!.slug,
      },
    },
  }
}

export async function rotateRefreshToken(
  db: Db,
  env: Env,
  refreshToken: string,
  meta: RequestMeta,
) {
  const tokenHash = hashRefreshToken(refreshToken)
  const currentRaw = await db.RefreshToken.findOne({ tokenHash }).lean()
  if (!currentRaw) throw new ApiError(401, errorCodes.UNAUTHORIZED, 'Refresh token is invalid.')
  const user = withId(await db.User.findById(currentRaw.userId).lean())
  const current = { ...currentRaw, id: currentRaw._id, user: user! }
  if (current.revokedAt) {
    const rotatedRecently =
      current.replacedById != null &&
      Date.now() - current.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS
    if (rotatedRecently) return issueRefreshSession(db, env, current, meta, false)
    if (current.replacedById) {
      await db.RefreshToken.updateMany(
        { userId: current.userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
    }
    throw new ApiError(401, errorCodes.UNAUTHORIZED, 'Refresh token is invalid.')
  }
  if (current.expiresAt.getTime() < Date.now() || current.user.disabledAt) {
    throw new ApiError(401, errorCodes.UNAUTHORIZED, 'Refresh token is invalid.')
  }
  if (current.deviceId) {
    const device = withId(await db.Device.findById(current.deviceId).lean())
    if (!device || device.revokedAt) {
      throw new ApiError(
        403,
        errorCodes.DEVICE_REVOKED,
        'This device was revoked and needs reauthorization.',
      )
    }
  }
  return issueRefreshSession(db, env, current, meta, true)
}

const REFRESH_REUSE_GRACE_MS = 15_000

async function issueRefreshSession(
  db: Db,
  env: Env,
  current: {
    id: string
    userId: string
    organizationId: string
    deviceId: string | null
    revokedAt: Date | null
  },
  meta: RequestMeta,
  retireCurrent: boolean,
) {
  const replacement = newRefreshToken()
  const created = await db.RefreshToken.create({
    userId: current.userId,
    organizationId: current.organizationId,
    deviceId: current.deviceId,
    tokenHash: hashRefreshToken(replacement),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  })
  if (retireCurrent) {
    await db.RefreshToken.findByIdAndUpdate(current.id, {
      $set: { revokedAt: new Date(), replacedById: created.id },
    })
  }
  const accessToken = await signAccessToken(
    { userId: current.userId, organizationId: current.organizationId, deviceId: current.deviceId },
    env,
  )
  return {
    accessToken,
    refreshToken: replacement,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  }
}

export async function revokeRefreshToken(db: Db, refreshToken: string, meta: RequestMeta) {
  const current = await db.RefreshToken.findOne({
    tokenHash: hashRefreshToken(refreshToken),
  }).lean()
  if (!current || current.revokedAt) return
  await db.RefreshToken.findByIdAndUpdate(current._id, { $set: { revokedAt: new Date() } })
  await writeAudit(db, {
    organizationId: current.organizationId,
    actorUserId: current.userId,
    action: 'logout',
    resourceType: 'user',
    resourceId: current.userId,
    ...meta,
  })
}

export async function currentProfile(db: Db, auth: AuthContext) {
  const user = withId(await db.User.findById(auth.userId).lean())
  if (!user) throw notFound()
  const organization = withId(await db.Organization.findById(user.organizationId).lean())
  const device = auth.deviceId ? withId(await db.Device.findById(auth.deviceId).lean()) : null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organization: {
      id: organization!.id,
      name: organization!.name,
      slug: organization!.slug,
    },
    device: device
      ? { id: device.id, name: device.name, platform: device.platform, revokedAt: device.revokedAt }
      : null,
  }
}

export async function listUsers(db: Db, auth: AuthContext) {
  const users = await db.User.find(userVisibility(auth)).sort({ name: 1 }).lean()
  return enrichUsersPublic(db, users)
}

export async function getUser(db: Db, auth: AuthContext, userId: string) {
  const user = await db.User.findOne({ _id: userId, ...userVisibility(auth) }).lean()
  if (!user) throw notFound()
  const [publicUserRow] = await enrichUsersPublic(db, [user])
  return publicUserRow!
}

export async function createUser(
  db: Db,
  auth: AuthContext,
  input: CreateUserInput,
  meta: RequestMeta,
) {
  const email = input.email.toLowerCase()
  const existing = await db.User.findOne({ email }).lean()
  if (existing)
    throw new ApiError(409, errorCodes.CONFLICT, 'A user with that email already exists.')
  if (input.teamIds?.length) await assertTeams(db, auth.organizationId, input.teamIds)
  const created = await db.User.create({
    organizationId: auth.organizationId,
    email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
  })
  if (input.teamIds?.length) {
    await db.TeamMember.insertMany(
      input.teamIds.map((teamId) => ({ teamId, userId: created.id, teamRole: 'MEMBER' as const })),
    )
  }
  const row = withId(created.toObject())!
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'user.created',
    resourceType: 'user',
    resourceId: row.id,
    metadata: { role: input.role, email },
    ...meta,
  })
  return getUser(db, auth, row.id)
}

export async function updateUser(
  db: Db,
  auth: AuthContext,
  userId: string,
  input: UpdateUserInput,
  meta: RequestMeta,
) {
  const user = await db.User.findOne({ _id: userId, organizationId: auth.organizationId }).lean()
  if (!user) throw notFound()
  if (user.role === 'OWNER' && input.role !== undefined) {
    throw forbidden('The organization owner role cannot be changed here.')
  }
  const email = input.email?.toLowerCase()
  if (email && email !== user.email) {
    const taken = await db.User.findOne({ email }).lean()
    if (taken) {
      throw new ApiError(409, errorCodes.CONFLICT, 'A user with that email already exists.')
    }
  }
  if (input.teamIds) await assertTeams(db, auth.organizationId, input.teamIds)
  await db.User.findByIdAndUpdate(userId, {
    $set: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(email && email !== user.email ? { email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    },
  })
  if (input.teamIds) {
    await db.TeamMember.deleteMany({ userId })
    if (input.teamIds.length) {
      await db.TeamMember.insertMany(
        input.teamIds.map((teamId) => ({ teamId, userId, teamRole: 'MEMBER' as const })),
      )
    }
  }
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'user.updated',
    resourceType: 'user',
    resourceId: userId,
    metadata: { role: input.role ?? null, name: input.name ?? null, email: email ?? null },
    ...meta,
  })
  return getUser(db, auth, userId)
}

export async function deleteUser(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  userId: string,
  meta: RequestMeta,
) {
  if (userId === auth.userId) throw forbidden('You cannot delete your own account.')
  const user = await db.User.findOne({ _id: userId, organizationId: auth.organizationId }).lean()
  if (!user) throw notFound()
  if (user.role === 'OWNER') throw forbidden('The organization owner cannot be deleted.')
  const [shots, payments, incomes] = await Promise.all([
    db.Screenshot.find({ userId }).select('storageKey thumbnailStorageKey').lean(),
    db.PaymentRequest.find({
      $or: [{ createdByUserId: userId }, { assigneeUserId: userId }],
    })
      .select('fileKey')
      .lean(),
    db.IncomeEntry.find({
      $or: [{ createdByUserId: userId }, { recipientUserId: userId }],
    })
      .select('fileKey')
      .lean(),
  ])
  await db.User.findByIdAndDelete(userId)
  const keys = [
    ...shots.flatMap((shot) => [shot.storageKey, shot.thumbnailStorageKey]),
    ...payments.map((row) => row.fileKey),
    ...incomes.map((row) => row.fileKey),
  ].filter((key): key is string => Boolean(key))
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)))
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'user.deleted',
    resourceType: 'user',
    resourceId: userId,
    metadata: { email: user.email, name: user.name },
    ...meta,
  })
  return { ok: true }
}

export async function setUserDisabled(
  db: Db,
  auth: AuthContext,
  userId: string,
  disabled: boolean,
  meta: RequestMeta,
) {
  if (userId === auth.userId) throw forbidden('You cannot change your own access.')
  const user = await db.User.findOne({ _id: userId, organizationId: auth.organizationId }).lean()
  if (!user) throw notFound()
  if (user.role === 'OWNER') throw forbidden('The organization owner cannot be disabled.')
  await db.User.findByIdAndUpdate(userId, {
    $set: { disabledAt: disabled ? new Date() : null },
  })
  if (disabled) {
    await db.RefreshToken.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    )
  }
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: disabled ? 'user.disabled' : 'user.enabled',
    resourceType: 'user',
    resourceId: userId,
    ...meta,
  })
  return getUser(db, auth, userId)
}

export async function listDevices(db: Db, auth: AuthContext) {
  const filter: Record<string, unknown> = {
    organizationId: auth.organizationId,
    ...(auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}),
  }
  const devices = await db.Device.find(filter).sort({ lastSeenAt: -1 }).lean()
  const userIds = [...new Set(devices.map((device) => device.userId))]
  const users = withIds(
    userIds.length
      ? await db.User.find({ _id: { $in: userIds } }).select('name email').lean()
      : [],
  )
  const userById = new Map(users.map((user) => [user.id, user]))
  return devices.map((device) => ({
    id: device._id,
    organizationId: device.organizationId,
    userId: device.userId,
    name: device.name,
    platform: device.platform,
    osVersion: device.osVersion,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    createdAt: device.createdAt,
    user: userById.get(device.userId) ?? { id: device.userId, name: '', email: '' },
  }))
}

export async function getDevice(db: Db, auth: AuthContext, deviceId: string) {
  const filter: Record<string, unknown> = {
    _id: deviceId,
    organizationId: auth.organizationId,
    ...(auth.visibleUserIds ? { userId: { $in: auth.visibleUserIds } } : {}),
  }
  const device = await db.Device.findOne(filter).lean()
  if (!device) throw notFound()
  const user = withId(await db.User.findById(device.userId).select('name email').lean())
  const screenshotCount = await db.Screenshot.countDocuments({ deviceId: device._id })
  return {
    id: device._id,
    organizationId: device.organizationId,
    userId: device.userId,
    name: device.name,
    platform: device.platform,
    osVersion: device.osVersion,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    createdAt: device.createdAt,
    user: user ?? { id: device.userId, name: '', email: '' },
    _count: { screenshots: screenshotCount },
  }
}

export async function revokeDevice(
  db: Db,
  auth: AuthContext,
  deviceId: string,
  meta: RequestMeta,
) {
  const device = await db.Device.findOne({
    _id: deviceId,
    organizationId: auth.organizationId,
  }).lean()
  if (!device) throw notFound()
  if (!device.revokedAt) {
    await db.Device.findByIdAndUpdate(deviceId, { $set: { revokedAt: new Date() } })
    await db.RefreshToken.updateMany(
      { deviceId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    )
  }
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'device.revoked',
    resourceType: 'device',
    resourceId: deviceId,
    ...meta,
  })
  return getDevice(db, auth, deviceId)
}

export async function heartbeat(db: Db, auth: AuthContext, appVersion: string) {
  if (!auth.deviceId) throw forbidden('A device session is required.')
  const device = await db.Device.findByIdAndUpdate(
    auth.deviceId,
    { $set: { lastSeenAt: new Date(), appVersion } },
    { new: true },
  ).lean()
  if (!device) throw notFound()
  return { id: device._id, lastSeenAt: device.lastSeenAt }
}

export async function reportDeviceExit(
  db: Db,
  auth: AuthContext,
  reason: 'force_quit' | 'shutdown',
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  if (!auth.deviceId) throw forbidden('A device session is required.')
  const device = withId(await db.Device.findById(auth.deviceId).lean())
  if (!device || device.organizationId !== auth.organizationId) throw notFound()
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: reason === 'shutdown' ? 'device.shutdown' : 'device.force_quit',
    resourceType: 'device',
    resourceId: auth.deviceId,
    metadata: {
      reason,
      deviceName: device.name,
      userId: auth.userId,
    },
    ...meta,
  })
  return { ok: true as const, reason }
}

export async function listTeams(db: Db, auth: AuthContext) {
  const filter: Record<string, unknown> = { organizationId: auth.organizationId }
  if (auth.role === 'MANAGER' || auth.role === 'MEMBER') {
    const memberships = await db.TeamMember.find({ userId: auth.userId }).select('teamId').lean()
    filter._id = { $in: memberships.map((item) => item.teamId) }
  }
  const teams = await db.Team.find(filter).sort({ name: 1 }).lean()
  const counts = await db.TeamMember.aggregate<{ _id: string; count: number }>([
    { $match: { teamId: { $in: teams.map((team) => team._id) } } },
    { $group: { _id: '$teamId', count: { $sum: 1 } } },
  ])
  const countByTeam = new Map(counts.map((row) => [row._id, row.count]))
  return teams.map((team) => ({
    id: team._id,
    organizationId: team.organizationId,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    _count: { members: countByTeam.get(team._id) ?? 0 },
  }))
}

export async function createTeam(db: Db, auth: AuthContext, name: string, meta: RequestMeta) {
  const existing = await db.Team.findOne({
    organizationId: auth.organizationId,
    name,
  }).lean()
  if (existing)
    throw new ApiError(409, errorCodes.CONFLICT, 'A team with that name already exists.')
  const team = await db.Team.create({ organizationId: auth.organizationId, name })
  const row = withId(team.toObject())!
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'team.created',
    resourceType: 'team',
    resourceId: row.id,
    metadata: { name },
    ...meta,
  })
  return { id: row.id, organizationId: row.organizationId, name: row.name, createdAt: team.createdAt, updatedAt: team.updatedAt }
}

export async function getPolicy(db: Db, organizationId: string) {
  const policy = withId(await db.ScreenshotPolicy.findOne({ organizationId }).lean())
  if (!policy) throw notFound('Organization policy was not found.')
  return {
    ...policy,
    screenshotIntervalSeconds: effectiveIntervalSeconds(policy.screenshotIntervalSeconds),
  }
}

export async function updatePolicy(
  db: Db,
  auth: AuthContext,
  input: PolicyInput,
  meta: RequestMeta,
) {
  const current = await getPolicy(db, auth.organizationId)
  const next = withId(
    await db.ScreenshotPolicy.findOneAndUpdate(
      { organizationId: auth.organizationId },
      { $set: input },
      { new: true },
    ).lean(),
  )!
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'policy.changed',
    resourceType: 'policy',
    resourceId: auth.organizationId,
    metadata: {
      screenshotIntervalSeconds: input.screenshotIntervalSeconds,
      captureEnabled: input.captureEnabled,
      serverRetentionDays: input.serverRetentionDays,
      automaticUploadEnabled: input.automaticUploadEnabled,
      previousInterval: current.screenshotIntervalSeconds,
    },
    ...meta,
  })
  if (current.serverRetentionDays !== input.serverRetentionDays) {
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'retention.changed',
      resourceType: 'policy',
      resourceId: auth.organizationId,
      metadata: { serverRetentionDays: input.serverRetentionDays },
      ...meta,
    })
  }
  return {
    ...next,
    screenshotIntervalSeconds: effectiveIntervalSeconds(next.screenshotIntervalSeconds),
  }
}

export async function renameOrganization(
  db: Db,
  auth: AuthContext,
  name: string,
  meta: RequestMeta,
) {
  const organization = withId(
    await db.Organization.findByIdAndUpdate(
      auth.organizationId,
      { $set: { name } },
      { new: true },
    ).lean(),
  )!
  await writeAudit(db, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'organization.updated',
    resourceType: 'organization',
    resourceId: organization.id,
    metadata: { name },
    ...meta,
  })
  return { id: organization.id, name: organization.name }
}

async function assertTeams(db: Db, organizationId: string, teamIds: string[]) {
  const count = await db.Team.countDocuments({
    organizationId,
    _id: { $in: teamIds },
  })
  if (count !== new Set(teamIds).size)
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Unknown team.')
}