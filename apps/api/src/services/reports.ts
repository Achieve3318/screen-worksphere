import { randomUUID } from 'node:crypto'
import { errorCodes, reportFieldsSchema, type SubmitReportInput } from '@screenvault/types'
import type { Db } from '../db.js'
import type { AuthContext } from '../context.js'
import { writeAudit } from '../auditLog.js'
import { ApiError, forbidden, notFound } from '../errors.js'
import type { ScreenshotStorage } from '../storage.js'
import { sanitizeReportHtml, visibleReportText } from '../reportHtml.js'
import { withId, withIds } from '../models/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

export type StoredAnswer = { fieldId: string; label: string; text: string }

function periodUtc(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

function assertRecentPeriod(periodKey: string): void {
  const key = periodUtc(periodKey)
  if (key === null) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Choose a valid report date.')
  }
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (key < today - 14 * DAY_MS || key > today + 2 * DAY_MS) {
    throw new ApiError(
      400,
      errorCodes.VALIDATION_ERROR,
      'That report date is outside the allowed window.',
    )
  }
}

function prompts(value: unknown) {
  const parsed = reportFieldsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function storedAnswers(value: unknown): { fieldId: string; label: string; text: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { fieldId?: unknown; label?: unknown; text?: unknown }
    if (typeof row.fieldId !== 'string' || typeof row.text !== 'string') return []
    return [
      {
        fieldId: row.fieldId,
        label: typeof row.label === 'string' ? row.label : '',
        text: row.text,
      },
    ]
  })
}

function answerTexts(value: unknown): { fieldId: string; text: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { fieldId?: unknown; text?: unknown }
    if (typeof row.fieldId !== 'string' || typeof row.text !== 'string') return []
    return [{ fieldId: row.fieldId, text: row.text }]
  })
}

export async function submitReport(db: Db, auth: AuthContext, input: SubmitReportInput) {
  assertRecentPeriod(input.periodKey)
  const policy = await db.ScreenshotPolicy.findOne({
    organizationId: auth.organizationId,
  }).lean()
  if (!policy) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Organization policy was not found.')
  }
  const fields = prompts(
    input.kind === 'DAILY' ? policy.dailyReportFields : policy.weeklyReportFields,
  )
  if (fields.length === 0) {
    throw new ApiError(
      400,
      errorCodes.VALIDATION_ERROR,
      input.kind === 'DAILY' ? 'Daily reports are not set up.' : 'Weekly reports are not set up.',
    )
  }
  const byId = new Map(input.answers.map((answer) => [answer.fieldId, answer.text]))
  if (byId.size !== input.answers.length || byId.size !== fields.length) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Answer every report prompt once.')
  }
  const answers: StoredAnswer[] = fields.map((field) => {
    const raw = byId.get(field.id)
    const text = raw && /<\/?[a-z][^>]*>/i.test(raw) ? sanitizeReportHtml(raw) : (raw ?? '')
    if (!visibleReportText(text)) {
      throw new ApiError(400, errorCodes.VALIDATION_ERROR, `Write an answer for "${field.label}".`)
    }
    return { fieldId: field.id, label: field.label, text }
  })
  const existing = await db.WorkReport.findOne({
    organizationId: auth.organizationId,
    userId: auth.userId,
    kind: input.kind,
    periodKey: input.periodKey,
  }).lean()
  if (existing && (await reportConfirmedAt(db, existing._id))) throw lockedReport()
  if (!existing) {
    const report = await db.WorkReport.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      kind: input.kind,
      periodKey: input.periodKey,
      answers,
    })
    const row = withId(report.toObject())!
    return {
      id: row.id,
      kind: report.kind,
      periodKey: report.periodKey,
      submittedAt: report.submittedAt,
    }
  }
  const updated = await db.WorkReport.updateOne(
    { _id: existing._id, confirmedAt: null },
    { $set: { answers, submittedAt: new Date() } },
  )
  if (updated.matchedCount === 0) throw lockedReport()
  return {
    id: existing._id,
    kind: existing.kind,
    periodKey: existing.periodKey,
    submittedAt: new Date(),
  }
}

function lockedReport(): ApiError {
  return new ApiError(
    409,
    errorCodes.CONFLICT,
    'An admin confirmed this report, so it can no longer be edited.',
  )
}

export async function reportStatus(db: Db, auth: AuthContext, daily: string, weekly: string) {
  if (periodUtc(daily) === null || periodUtc(weekly) === null) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Choose a valid report date.')
  }
  const rows = await db.WorkReport.find({
    organizationId: auth.organizationId,
    userId: auth.userId,
    $or: [
      { kind: 'DAILY', periodKey: daily },
      { kind: 'WEEKLY', periodKey: weekly },
    ],
  }).lean()
  const dailyRow = rows.find((row) => row.kind === 'DAILY')
  const weeklyRow = rows.find((row) => row.kind === 'WEEKLY')
  const confirmed = await confirmedReportIds(
    db,
    rows.map((row) => row._id),
  )
  return {
    dailySubmitted: Boolean(dailyRow),
    weeklySubmitted: Boolean(weeklyRow),
    dailyConfirmed: Boolean(dailyRow && confirmed.has(dailyRow._id)),
    weeklyConfirmed: Boolean(weeklyRow && confirmed.has(weeklyRow._id)),
    dailyAnswers: answerTexts(dailyRow?.answers),
    weeklyAnswers: answerTexts(weeklyRow?.answers),
  }
}

export async function listReports(
  db: Db,
  auth: AuthContext,
  query: { userId?: string; kind?: 'DAILY' | 'WEEKLY' },
) {
  if (query.userId && auth.visibleUserIds && !auth.visibleUserIds.includes(query.userId)) {
    throw forbidden('You cannot view that person’s reports.')
  }
  const filter: Record<string, unknown> = {
    organizationId: auth.organizationId,
  }
  if (auth.visibleUserIds) filter.userId = { $in: auth.visibleUserIds }
  if (query.userId) filter.userId = query.userId
  if (query.kind) filter.kind = query.kind
  const rows = await db.WorkReport.find(filter).sort({ submittedAt: -1 }).limit(100).lean()
  const userIds = [...new Set(rows.map((row) => row.userId))]
  const users = withIds(
    userIds.length
      ? await db.User.find({ _id: { $in: userIds } })
          .select('name email')
          .lean()
      : [],
  )
  const userById = new Map(users.map((user) => [user.id, user]))
  const confirmed = await confirmedReportIds(
    db,
    rows.map((row) => row._id),
  )
  return {
    items: rows.map((row) => {
      const user = userById.get(row.userId)
      return {
        id: row._id,
        userId: row.userId,
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        kind: row.kind,
        periodKey: row.periodKey,
        answers: Array.isArray(row.answers) ? row.answers : [],
        submittedAt: row.submittedAt,
        confirmedAt: confirmed.get(row._id) ?? null,
      }
    }),
  }
}

export async function listMyReports(db: Db, auth: AuthContext, kind?: 'DAILY' | 'WEEKLY') {
  const rows = await db.WorkReport.find({
    organizationId: auth.organizationId,
    userId: auth.userId,
    ...(kind ? { kind } : {}),
  })
    .sort({ periodKey: -1, submittedAt: -1 })
    .limit(200)
    .lean()
  const confirmed = await confirmedReportIds(
    db,
    rows.map((row) => row._id),
  )
  return {
    items: rows.map((row) => ({
      id: row._id,
      kind: row.kind,
      periodKey: row.periodKey,
      answers: storedAnswers(row.answers),
      submittedAt: row.submittedAt,
      confirmedAt: confirmed.get(row._id) ?? null,
    })),
  }
}

export async function confirmReport(
  db: Db,
  auth: AuthContext,
  id: string,
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
    throw forbidden('Only an admin can confirm a report.')
  }
  const report = await db.WorkReport.findOne({
    _id: id,
    organizationId: auth.organizationId,
  }).lean()
  if (!report) throw notFound('That report was not found.')
  const confirmedAt = new Date()
  const updated = await db.WorkReport.updateOne(
    { _id: report._id, organizationId: auth.organizationId, confirmedAt: null },
    { $set: { confirmedAt, confirmedById: auth.userId } },
  )
  if (updated.matchedCount === 1) {
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'report.confirmed',
      resourceType: 'work_report',
      resourceId: report._id,
      metadata: { userId: report.userId, kind: report.kind, periodKey: report.periodKey },
      ...meta,
    })
    return { id: report._id, confirmedAt }
  }
  return { id: report._id, confirmedAt: await reportConfirmedAt(db, report._id) }
}

async function reportConfirmedAt(db: Db, id: string): Promise<Date | null> {
  const row = await db.WorkReport.findById(id).select('confirmedAt').lean()
  return row?.confirmedAt ? new Date(row.confirmedAt) : null
}

async function confirmedReportIds(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db.WorkReport.find({
    _id: { $in: ids },
    confirmedAt: { $ne: null },
  })
    .select('_id confirmedAt')
    .lean()
  return new Map(
    rows.flatMap((row) =>
      row.confirmedAt ? [[row._id, new Date(row.confirmedAt).toISOString()] as const] : [],
    ),
  )
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const maxImageBytes = 5 * 1024 * 1024

export async function saveReportImage(
  storage: ScreenshotStorage,
  auth: AuthContext,
  input: { contentType: string; data: string },
) {
  if (!imageTypes.has(input.contentType)) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Paste a PNG, JPEG, GIF, or WebP image.')
  }
  const body = Buffer.from(input.data, 'base64')
  if (!body.length || body.length > maxImageBytes) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Images must be 5 MB or smaller.')
  }
  if (!looksLikeImage(body, input.contentType)) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Paste a PNG, JPEG, GIF, or WebP image.')
  }
  const id = randomUUID()
  await storage.put(reportImageKey(auth.organizationId, id), body, input.contentType)
  return { id, path: `/api/v1/reports/images/${id}` }
}

export async function readReportImage(storage: ScreenshotStorage, auth: AuthContext, id: string) {
  const stored = await storage.get(reportImageKey(auth.organizationId, id))
  if (!stored) throw new ApiError(404, errorCodes.NOT_FOUND, 'That image was not found.')
  return stored
}

function reportImageKey(organizationId: string, id: string): string {
  return `orgs/${organizationId}/reports/${id}`
}

function looksLikeImage(body: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') return body.subarray(0, 4).toString('hex') === '89504e47'
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  if (contentType === 'image/gif') return body.subarray(0, 3).toString('ascii') === 'GIF'
  if (contentType === 'image/webp') {
    return (
      body.subarray(0, 4).toString('ascii') === 'RIFF' &&
      body.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  return false
}