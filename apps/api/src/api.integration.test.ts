import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sha256Hex } from '@screenvault/shared'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createTestDb, type Db } from './db.js'
import { parseEnv } from './env.js'
import { hashPassword } from './security.js'
import { runRetention } from './services/screenshots.js'
import {
  LocalFilesystemStorage,
  MemoryStorage,
  signStorageToken,
  verifyStorageToken,
} from './storage.js'
import type { FastifyInstance } from 'fastify'

const password = 'Valid-password-1'

async function makeImage() {
  const body = await sharp({
    create: { width: 12, height: 8, channels: 3, background: { r: 12, g: 90, b: 80 } },
  })
    .webp()
    .toBuffer()
  return { body, checksum: sha256Hex(body), fileSize: body.length }
}

async function createHarness() {
  const env = parseEnv({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-12',
    MEDIA_SIGNING_SECRET: 'media-secret-media-secret-media-12',
    RATE_LIMIT_DISABLED: 'true',
    PUBLIC_BASE_URL: 'http://127.0.0.1:4000',
  })
  const testDb = await createTestDb()
  const storage = new MemoryStorage()
  const app = await buildApp({ db: testDb.db, storage, env })
  return {
    app,
    db: testDb.db,
    storage,
    env,
    close: async () => {
      await app.close()
      await testDb.close()
    },
  }
}

async function seedOwner(db: Db, label: string) {
  const organization = await db.Organization.create({
    name: label,
    slug: `${label}-${randomUUID().slice(0, 8)}`,
  })
  const orgId = organization.id
  await db.ScreenshotPolicy.create({ organizationId: orgId })
  const user = await db.User.create({
    organizationId: orgId,
    email: `${label}-${randomUUID().slice(0, 8)}@example.com`,
    name: label,
    role: 'OWNER',
    passwordHash: await hashPassword(password),
  })
  return { organization, user }
}

async function bearer(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'x-screenvault-client': 'desktop' },
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  return response.json().accessToken as string
}

describe('api', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>

  beforeAll(async () => {
    harness = await createHarness()
  })

  afterAll(async () => {
    await harness.close()
  })

  it('authenticates, uploads idempotently, and hides screenshots across organizations', async () => {
    const owner = await seedOwner(harness.db, 'alpha')
    const other = await seedOwner(harness.db, 'beta')
    const member = await harness.db.User.create({
      organizationId: owner.organization.id,
      email: `member-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Member',
      role: 'MEMBER',
      passwordHash: await hashPassword(password),
    })
    const token = await bearer(harness.app, owner.user.email)
    const otherToken = await bearer(harness.app, other.user.email)
    const memberToken = await bearer(harness.app, member.email)
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'x-screenvault-client': 'desktop' },
      payload: {
        email: owner.user.email,
        password,
        device: { name: 'Desk', platform: 'WINDOWS', osVersion: '11', appVersion: '0.1.0' },
      },
    })
    expect(enrolled.statusCode).toBe(200)
    const deviceToken = enrolled.json().accessToken as string
    const image = await makeImage()
    const screenshotId = randomUUID()
    const captureEventId = randomUUID()
    const item = {
      screenshotId,
      captureEventId,
      displayId: 'display-1',
      displayIndex: 0,
      displayName: 'Primary',
      width: 12,
      height: 8,
      originalWidth: 12,
      originalHeight: 8,
      scaleFactor: 1,
      fileSize: image.fileSize,
      checksum: image.checksum,
      contentType: 'image/webp',
      capturedAt: new Date().toISOString(),
      timezone: 'UTC',
      workNote: 'Design review',
      activeApp: 'Code',
      activeWindow: 'ScreenVault — README.md',
      idle: false,
      encryptionVersion: 1,
    }
    const session = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/upload-sessions',
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { items: [item] },
    })
    expect(session.statusCode).toBe(200)
    expect(session.json().items[0].status).toBe('accepted')
    const put = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/screenshots/${screenshotId}/content`,
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'content-type': 'image/webp',
        'x-checksum-sha256': image.checksum,
      },
      payload: image.body,
    })
    expect(put.statusCode).toBe(200)
    const complete = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/screenshots/${screenshotId}/complete`,
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { checksum: image.checksum },
    })
    expect(complete.statusCode).toBe(200)
    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/upload-sessions',
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { items: [item] },
    })
    expect(again.json().items[0].status).toBe('already_stored')
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/capture-events',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items).toHaveLength(1)
    expect(listed.json().items[0].workNote).toBe('Design review')
    expect(listed.json().items[0].activeWindow).toBe('ScreenVault — README.md')
    expect(listed.json().items[0].activeApp).toBe('Code')
    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/screenshots/${screenshotId}/content?variant=full`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(foreign.statusCode).toBe(404)
    const memberList = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/capture-events',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(memberList.statusCode).toBe(403)
    const viewed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/screenshots/${screenshotId}/content?variant=full`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viewed.statusCode).toBe(200)
    expect(viewed.headers['content-type']).toContain('image/webp')
    const audits = await harness.db.AuditLog.find({ organizationId: owner.organization.id })
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain(password)
    expect(serialized).toContain('screenshot.viewed')
    expect(harness.storage.objects.size).toBeGreaterThan(0)
  })

  it('rejects a capture interval below the server minimum', async () => {
    const owner = await seedOwner(harness.db, 'policy')
    const token = await bearer(harness.app, owner.user.email)
    const current = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/policy',
      headers: { authorization: `Bearer ${token}` },
    })
    const body = current.json<Record<string, unknown>>()
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/policy',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...body, screenshotIntervalSeconds: 5 },
    })
    expect(response.statusCode).toBe(400)
  })

  it('stops a revoked device from uploading', async () => {
    const owner = await seedOwner(harness.db, 'revoke')
    const token = await bearer(harness.app, owner.user.email)
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'x-screenvault-client': 'desktop' },
      payload: {
        email: owner.user.email,
        password,
        device: { name: 'Laptop', platform: 'MACOS', osVersion: '15', appVersion: '0.1.0' },
      },
    })
    const deviceToken = enrolled.json().accessToken as string
    const deviceId = enrolled.json().deviceId as string
    const revoked = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(revoked.statusCode).toBe(200)
    const image = await makeImage()
    const denied = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/upload-sessions',
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: {
        items: [
          {
            screenshotId: randomUUID(),
            captureEventId: randomUUID(),
            displayId: 'd',
            displayIndex: 0,
            displayName: null,
            width: 12,
            height: 8,
            originalWidth: 12,
            originalHeight: 8,
            scaleFactor: 1,
            fileSize: image.fileSize,
            checksum: image.checksum,
            contentType: 'image/webp',
            capturedAt: new Date().toISOString(),
            timezone: 'UTC',
            workNote: null,
            idle: false,
            encryptionVersion: 1,
          },
        ],
      },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('DEVICE_REVOKED')
  })

  it('deletes expired screenshots and their objects during retention', async () => {
    const owner = await seedOwner(harness.db, 'retain')
    const device = await harness.db.Device.create({
      organizationId: owner.organization.id,
      userId: owner.user.id,
      name: 'Old',
      platform: 'LINUX',
      osVersion: '6',
      appVersion: '0.1.0',
    })
    const eventId = randomUUID()
    const shotId = randomUUID()
    await harness.db.CaptureEvent.create({
      _id: eventId,
      organizationId: owner.organization.id,
      userId: owner.user.id,
      deviceId: device.id,
      capturedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      timezone: 'UTC',
    })
    const key = `orgs/${owner.organization.id}/originals/${shotId}`
    await harness.storage.put(key, Buffer.from('old'), 'image/webp')
    await harness.db.Screenshot.create({
      _id: shotId,
      organizationId: owner.organization.id,
      userId: owner.user.id,
      deviceId: device.id,
      captureEventId: eventId,
      displayId: 'd',
      displayIndex: 0,
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
      scaleFactor: 1,
      fileSize: 3,
      checksum: 'a'.repeat(64),
      contentType: 'image/webp',
      storageKey: key,
      encryptionVersion: 1,
      status: 'STORED',
      capturedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      uploadedAt: new Date(),
    })
    await harness.db.ScreenshotPolicy.findOneAndUpdate(
      { organizationId: owner.organization.id },
      { serverRetentionDays: 30 },
    )
    await runRetention(harness.db, harness.storage)
    expect(await harness.db.Screenshot.findById(shotId)).toBeNull()
    expect(await harness.storage.exists(key)).toBe(false)
    const audit = await harness.db.AuditLog.findOne({
      organizationId: owner.organization.id,
      action: 'retention.deleted',
    })
    expect(audit).toBeTruthy()
  })

  it('lets a person register into a team and enroll', async () => {
    const owner = await seedOwner(harness.db, 'signup')
    const team = await harness.db.Team.create({
      organizationId: owner.organization.id,
      name: 'Design',
    })
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/auth/teams' })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items).toEqual(
      expect.arrayContaining([
        { id: team.id, name: 'Design', organizationName: owner.organization.name },
      ]),
    )
    const email = `new-${randomUUID().slice(0, 8)}@example.com`
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'New Member',
        email,
        password,
        teamId: team.id,
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ email, name: 'New Member' })
    const membership = await harness.db.TeamMember.findOne({
      teamId: team.id,
      userId: created.json().id as string,
    })
    expect(membership?.teamRole).toBe('MEMBER')
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'x-screenvault-client': 'desktop' },
      payload: {
        email,
        password,
        device: { name: 'Desk', platform: 'WINDOWS', osVersion: '11', appVersion: '0.1.0' },
      },
    })
    expect(enrolled.statusCode).toBe(200)
    const unknown = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Missing',
        email: `other-${randomUUID().slice(0, 8)}@example.com`,
        password,
        teamId: randomUUID(),
      },
    })
    expect(unknown.statusCode).toBe(404)
    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Again',
        email,
        password,
        teamId: team.id,
      },
    })
    expect(duplicate.statusCode).toBe(409)
  })

  it('lets a device accept a screenshot receive request and report progress', async () => {
    const owner = await seedOwner(harness.db, 'receive')
    const member = await harness.db.User.create({
      organizationId: owner.organization.id,
      email: `receive-member-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Receive Member',
      role: 'MEMBER',
      passwordHash: await hashPassword(password),
    })
    const adminToken = await bearer(harness.app, owner.user.email)
    const enrolled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'x-screenvault-client': 'desktop' },
      payload: {
        email: member.email,
        password,
        device: { name: 'Laptop', platform: 'WINDOWS', osVersion: '11', appVersion: '0.1.0' },
      },
    })
    expect(enrolled.statusCode).toBe(200)
    const deviceToken = enrolled.json().accessToken as string
    const idle = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives/pending',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(idle.statusCode).toBe(200)
    expect(idle.json()).toEqual({ request: null })

    const asked = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${member.id}/screenshot-receive`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(asked.statusCode).toBe(200)
    const requestId = asked.json().id as string
    const pending = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives/pending',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(pending.json().request.id).toBe(requestId)
    const waitingStatus = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(waitingStatus.statusCode).toBe(200)
    expect(waitingStatus.json().items).toEqual([
      { userId: member.id, requestId, phase: 'pending', uploaded: 0, total: 0 },
    ])

    const declined = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/screenshot-receives/${requestId}/respond`,
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { accepted: false },
    })
    expect(declined.statusCode).toBe(200)
    expect(declined.json().accepted).toBe(false)
    const quiet = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives/pending',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(quiet.json()).toEqual({ request: null })
    const declinedStatus = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(declinedStatus.json().items).toEqual([
      { userId: member.id, requestId, phase: 'declined', uploaded: 0, total: 0 },
    ])

    const again = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${member.id}/screenshot-receive`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const nextId = again.json().id as string
    expect(nextId).not.toBe(requestId)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/screenshot-receives/${nextId}/respond`,
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { accepted: true },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().accepted).toBe(true)
    const uploadingStatus = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/screenshot-receives',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(uploadingStatus.json().items).toEqual([
      { userId: member.id, requestId: nextId, phase: 'uploading', uploaded: 0, total: 0 },
    ])
    const memberDenied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${owner.user.id}/screenshot-receive`,
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(memberDenied.statusCode).toBe(403)
  })
})

describe('api rate limits', () => {
  it('rate limits repeated logins', async () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-12',
      MEDIA_SIGNING_SECRET: 'media-secret-media-secret-media-12',
      RATE_LIMIT_DISABLED: 'false',
    })
    const testDb = await createTestDb()
    const app = await buildApp({ db: testDb.db, storage: new MemoryStorage(), env })
    const owner = await seedOwner(testDb.db, 'limit')
    let status = 0
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: owner.user.email, password: 'wrong-password-1' },
      })
      status = response.statusCode
    }
    expect(status).toBe(429)
    await app.close()
    await testDb.close()
  })
})

describe('storage tokens', () => {
  it('rejects tampered and expired media tokens and escapes path traversal', async () => {
    const secret = 'media-secret-media-secret-media-12'
    const token = signStorageToken(
      { key: 'orgs/a/originals/b', exp: Math.floor(Date.now() / 1000) + 30 },
      secret,
    )
    expect(verifyStorageToken(token, secret)?.key).toBe('orgs/a/originals/b')
    expect(verifyStorageToken(`${token}x`, secret)).toBeNull()
    expect(
      verifyStorageToken(signStorageToken({ key: 'orgs/a/originals/b', exp: 10 }, secret), secret),
    ).toBeNull()
    const dir = await mkdtemp(path.join(tmpdir(), 'sv-store-'))
    const storage = new LocalFilesystemStorage(dir, 'http://127.0.0.1:4000', secret)
    await expect(storage.put('../secret', Buffer.from('no'), 'text/plain')).rejects.toThrow(
      /Invalid storage key/,
    )
    await rm(dir, { recursive: true, force: true })
  })
})