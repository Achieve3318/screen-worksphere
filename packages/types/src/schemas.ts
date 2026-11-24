import {
  CAPTURE_INTERVAL_MAX_SECONDS,
  CAPTURE_INTERVAL_MIN_SECONDS,
  MAX_SCREENSHOT_BYTES,
  MAX_WIDTH_OPTIONS,
  QUALITY_MAX,
  QUALITY_MIN,
  SERVER_RETENTION_DAY_OPTIONS,
  UPLOAD_SESSION_ITEM_LIMIT,
  WORK_NOTE_MAX_LENGTH,
  orgRoles,
  networksForAsset,
  paymentAssets,
  paymentNetworks,
} from '../../shared/dist/index.js'
import { z } from 'zod'

export const orgRoleSchema = z.enum(orgRoles)
export const devicePlatformSchema = z.enum(['WINDOWS', 'MACOS', 'LINUX', 'UNKNOWN'])
export const captureModeSchema = z.enum(['ALL_DISPLAYS', 'PRIMARY_ONLY'])
export const imageFormatSchema = z.enum(['WEBP', 'JPEG'])
export const contentTypeSchema = z.enum(['image/webp', 'image/jpeg'])

const uuidSchema = z.string().uuid()
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const reportFieldSchema = z.object({
  id: uuidSchema,
  label: z.string().trim().min(1).max(160),
})
export const reportFieldsSchema = z.array(reportFieldSchema).max(20)
export const reportKindSchema = z.enum(['DAILY', 'WEEKLY'])
export const submitReportSchema = z.object({
  kind: reportKindSchema,
  periodKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  answers: z
    .array(
      z.object({
        fieldId: uuidSchema,
        text: z.string().trim().min(1).max(20000),
      }),
    )
    .max(20),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(500).optional(),
})

export const deviceDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: devicePlatformSchema,
  osVersion: z.string().trim().min(1).max(120),
  appVersion: z.string().trim().min(1).max(40),
})

export const enrollSchema = loginSchema.extend({
  device: deviceDescriptorSchema,
  deviceId: uuidSchema.optional(),
})

export const passwordSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/[A-Za-z]/, 'Password must include a letter.')
  .regex(/[0-9]/, 'Password must include a number.')

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: passwordSchema,
  teamId: uuidSchema,
})

export const createUserSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: orgRoleSchema.exclude(['OWNER']),
  teamIds: z.array(uuidSchema).max(20).optional(),
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(320).optional(),
  role: orgRoleSchema.exclude(['OWNER']).optional(),
  teamIds: z.array(uuidSchema).max(20).optional(),
})

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const policySchema = z
  .object({
    captureEnabled: z.boolean(),
    screenshotIntervalSeconds: z
      .number()
      .int()
      .min(CAPTURE_INTERVAL_MIN_SECONDS)
      .max(CAPTURE_INTERVAL_MAX_SECONDS),
    captureMode: captureModeSchema,
    format: imageFormatSchema,
    quality: z.number().int().min(QUALITY_MIN).max(QUALITY_MAX),
    maxWidth: z.union([
      z.literal(MAX_WIDTH_OPTIONS[0]),
      z.literal(MAX_WIDTH_OPTIONS[1]),
      z.literal(MAX_WIDTH_OPTIONS[2]),
      z.null(),
    ]),
    manualUploadAllowed: z.boolean(),
    automaticUploadEnabled: z.boolean(),
    automaticUploadIntervalMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    uploadOnlyOnUnmeteredNetwork: z.boolean(),
    deleteAfterUpload: z.boolean(),
    localRetentionDays: z.number().int().min(1).max(365),
    maxLocalStorageGB: z.number().int().min(1).max(100),
    serverRetentionDays: z.union([
      z.literal(SERVER_RETENTION_DAY_OPTIONS[0]),
      z.literal(SERVER_RETENTION_DAY_OPTIONS[1]),
      z.literal(SERVER_RETENTION_DAY_OPTIONS[2]),
      z.literal(SERVER_RETENTION_DAY_OPTIONS[3]),
      z.literal(SERVER_RETENTION_DAY_OPTIONS[4]),
      z.null(),
    ]),
    pauseCaptureWhileLocked: z.boolean(),
    idleDetectionEnabled: z.boolean(),
    idleThresholdMinutes: z.number().int().min(1).max(240),
    excludedApplications: z.array(z.string().trim().min(1).max(128)).max(100),
    screenshotAccessRoles: z.array(orgRoleSchema).min(1),
    dailyReportFields: reportFieldsSchema.default([]),
    weeklyReportFields: reportFieldsSchema.default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.screenshotAccessRoles.includes('OWNER')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['screenshotAccessRoles'],
        message: 'OWNER must retain screenshot access.',
      })
    }
  })

export const screenshotItemSchema = z.object({
  screenshotId: uuidSchema,
  captureEventId: uuidSchema,
  displayId: z.string().trim().min(1).max(128),
  displayIndex: z.number().int().min(0).max(32),
  displayName: z.string().trim().max(128).nullable(),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  originalWidth: z.number().int().positive().max(20_000),
  originalHeight: z.number().int().positive().max(20_000),
  scaleFactor: z.number().positive().max(8),
  fileSize: z.number().int().positive().max(MAX_SCREENSHOT_BYTES),
  checksum: checksumSchema,
  contentType: contentTypeSchema,
  capturedAt: z.string().datetime(),
  timezone: z.string().trim().min(1).max(100),
  workNote: z.string().trim().max(WORK_NOTE_MAX_LENGTH).nullable(),
  activeApp: z.string().trim().max(128).nullable().optional(),
  activeWindow: z.string().trim().max(300).nullable().optional(),
  idle: z.boolean(),
  activeMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60 * 1000)
    .optional(),
  intervalMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60 * 1000)
    .optional(),
  encryptionVersion: z.number().int().min(1).max(10),
})

export const uploadSessionSchema = z.object({
  items: z.array(screenshotItemSchema).min(1).max(UPLOAD_SESSION_ITEM_LIMIT),
})

export const completeScreenshotSchema = z.object({
  checksum: checksumSchema,
})

export const monitoringSessionSchema = z.object({
  id: uuidSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  trackedMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60 * 1000),
  idleMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60 * 1000),
})

export const monitoringSessionsSchema = z.object({
  sessions: z.array(monitoringSessionSchema).min(1).max(200),
})

export const captureActivityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        Intl.DateTimeFormat('en-US', { timeZone: value })
        return true
      } catch {
        return false
      }
    }, 'Time zone is not recognized.'),
  userId: uuidSchema.optional(),
  deviceId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
})

export const captureEventQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: uuidSchema.optional(),
  deviceId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  display: z.string().trim().min(1).max(128).optional(),
})

export const auditQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  action: z.string().trim().max(80).optional(),
})

export const errorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  USER_DISABLED: 'USER_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  CAPTURE_DISABLED: 'CAPTURE_DISABLED',
} as const

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes]
export type LoginInput = z.infer<typeof loginSchema>
export type EnrollInput = z.infer<typeof enrollSchema>
export type RegisterInput = z.infer<typeof registerSchema>
function requireAssetNetwork(value: { asset: string; network: string }, ctx: z.RefinementCtx) {
  const allowed = networksForAsset[value.asset as keyof typeof networksForAsset]
  if (!allowed?.includes(value.network as (typeof allowed)[number])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['network'],
      message: 'That network is not available for this type.',
    })
  }
}

const assetIds = paymentAssets.map((item) => item.id)
const networkIds = paymentNetworks.map((item) => item.id)
export const paymentAssetSchema = z.enum([assetIds[0]!, ...assetIds.slice(1)])
export const paymentNetworkSchema = z.enum([networkIds[0]!, ...networkIds.slice(1)])

const referralFileSchema = z.object({
  name: z.string().trim().min(1).max(180),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(1).max(12_000_000),
})

export const createPaymentRequestSchema = z
  .object({
    address: z.string().trim().min(1).max(200),
    asset: paymentAssetSchema,
    network: paymentNetworkSchema,
    assigneeUserId: z.string().uuid(),
    amount: z.string().trim().min(1).max(24),
    notes: z.string().trim().max(2000).default(''),
    file: referralFileSchema.optional(),
  })
  .superRefine(requireAssetNetwork)

export const createIncomeSchema = z
  .object({
    asset: paymentAssetSchema,
    network: paymentNetworkSchema,
    recipientKind: z.enum(['BOSS', 'USER']),
    recipientUserId: z.string().uuid().optional(),
    amount: z.string().trim().min(1).max(24),
    notes: z.string().trim().max(2000).default(''),
    source: z.enum(['USER', 'BOSS']).default('USER'),
    txUrl: z.string().trim().max(2000).optional(),
    file: referralFileSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.recipientKind === 'USER' && value.source !== 'BOSS' && !value.recipientUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientUserId'],
        message: 'Choose who receives this income.',
      })
    }
    if (value.source === 'BOSS' && value.recipientKind !== 'USER') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientKind'],
        message: 'Income from the boss goes to a payment manager.',
      })
    }
    if (value.source === 'USER' && !transactionLink(value.txUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['txUrl'],
        message: 'Enter a transaction link starting with https://.',
      })
    }
    requireAssetNetwork(value, ctx)
  })

export const updatePaymentStatusSchema = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'PAID']),
    txUrl: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'PAID') return
    const link = value.txUrl ?? ''
    let url: URL | null = null
    try {
      url = link ? new URL(link) : null
    } catch {
      url = null
    }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['txUrl'],
        message: 'Enter a transaction link starting with https://.',
      })
    }
  })

function transactionLink(value: string | undefined): string | null {
  const link = value?.trim() ?? ''
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return link
  } catch {
    return null
  }
}

export const updateIncomeStatusSchema = z.object({
  status: z.enum(['PENDING', 'PM_CONFIRMED', 'SENT_TO_BOSS', 'CONFIRMED']),
})

export const paymentSummaryQuerySchema = z.object({
  weekFrom: z.string().datetime(),
  weekTo: z.string().datetime(),
  monthFrom: z.string().datetime(),
  monthTo: z.string().datetime(),
})

export type PolicyInput = z.infer<typeof policySchema>
export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestSchema>
export type CreateIncomeInput = z.infer<typeof createIncomeSchema>
export type ReportField = z.infer<typeof reportFieldSchema>
export type SubmitReportInput = z.infer<typeof submitReportSchema>
export type ScreenshotItemInput = z.infer<typeof screenshotItemSchema>
export type UploadSessionInput = z.infer<typeof uploadSessionSchema>
export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type CaptureEventQuery = z.infer<typeof captureEventQuerySchema>
