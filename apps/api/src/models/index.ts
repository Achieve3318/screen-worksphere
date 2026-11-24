import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose'
import { SchemaWithId } from './common.js'
import {
  CaptureModes,
  DevicePlatforms,
  ImageFormats,
  IncomeSources,
  IncomeStatuses,
  MoneyRecipients,
  OrgRoles,
  PaymentStatuses,
  ReportKinds,
  ScreenshotReceiveStatuses,
  ScreenshotStatuses,
  TeamRoles,
  UploadSessionStatuses,
} from './enums.js'

const OrganizationSchema = SchemaWithId(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
  },
  { timestamps: true },
)

const UserSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true, index: true },
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: OrgRoles, default: 'MEMBER' },
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const TeamSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true },
  },
  { timestamps: true },
)
TeamSchema.index({ organizationId: 1, name: 1 }, { unique: true })

const TeamMemberSchema = SchemaWithId(
  {
    teamId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    teamRole: { type: String, enum: TeamRoles, default: 'MEMBER' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
TeamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true })

const DeviceSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    platform: { type: String, enum: DevicePlatforms, required: true },
    osVersion: { type: String, required: true },
    appVersion: { type: String, required: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const MonitoringSessionSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    trackedMs: { type: Number, required: true },
    idleMs: { type: Number, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
)
MonitoringSessionSchema.index({ organizationId: 1, startedAt: 1 })
MonitoringSessionSchema.index({ userId: 1, startedAt: 1 })
MonitoringSessionSchema.index({ deviceId: 1, startedAt: 1 })

const CaptureEventSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    capturedAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    workNote: { type: String, default: null },
    activeApp: { type: String, default: null },
    activeWindow: { type: String, default: null },
    idle: { type: Boolean, default: false },
    activeMs: { type: Number, default: null },
    intervalMs: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
CaptureEventSchema.index({ organizationId: 1, capturedAt: 1 })
CaptureEventSchema.index({ userId: 1, capturedAt: 1 })
CaptureEventSchema.index({ deviceId: 1, capturedAt: 1 })

const ScreenshotSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    captureEventId: { type: String, required: true, index: true },
    displayId: { type: String, required: true },
    displayIndex: { type: Number, required: true },
    displayName: { type: String, default: null },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    originalWidth: { type: Number, required: true },
    originalHeight: { type: Number, required: true },
    scaleFactor: { type: Number, required: true },
    fileSize: { type: Number, required: true },
    checksum: { type: String, required: true },
    contentType: { type: String, required: true },
    storageKey: { type: String, default: null },
    thumbnailStorageKey: { type: String, default: null },
    encryptionVersion: { type: Number, required: true },
    status: { type: String, enum: ScreenshotStatuses, default: 'AWAITING_UPLOAD' },
    capturedAt: { type: Date, required: true },
    uploadedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
ScreenshotSchema.index({ organizationId: 1, capturedAt: 1 })
ScreenshotSchema.index({ userId: 1, capturedAt: 1 })
ScreenshotSchema.index({ deviceId: 1, capturedAt: 1 })
ScreenshotSchema.index({ status: 1, createdAt: 1 })

const ScreenshotPolicySchema = SchemaWithId(
  {
    organizationId: { type: String, required: true, unique: true },
    captureEnabled: { type: Boolean, default: true },
    screenshotIntervalSeconds: { type: Number, default: 60 },
    captureMode: { type: String, enum: CaptureModes, default: 'ALL_DISPLAYS' },
    format: { type: String, enum: ImageFormats, default: 'WEBP' },
    quality: { type: Number, default: 70 },
    maxWidth: { type: Number, default: null },
    manualUploadAllowed: { type: Boolean, default: true },
    automaticUploadEnabled: { type: Boolean, default: false },
    automaticUploadIntervalMinutes: { type: Number, default: 15 },
    uploadOnlyOnUnmeteredNetwork: { type: Boolean, default: false },
    deleteAfterUpload: { type: Boolean, default: true },
    localRetentionDays: { type: Number, default: 14 },
    maxLocalStorageGB: { type: Number, default: 5 },
    serverRetentionDays: { type: Number, default: null },
    pauseCaptureWhileLocked: { type: Boolean, default: true },
    idleDetectionEnabled: { type: Boolean, default: true },
    idleThresholdMinutes: { type: Number, default: 5 },
    excludedApplications: { type: [String], default: [] },
    screenshotAccessRoles: { type: [String], enum: OrgRoles, default: ['OWNER', 'ADMIN', 'MANAGER'] },
    dailyReportFields: { type: [Schema.Types.Mixed], default: [] },
    weeklyReportFields: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
)

const WorkReportSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    kind: { type: String, enum: ReportKinds, required: true },
    periodKey: { type: String, required: true },
    answers: { type: Object, required: true },
    submittedAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
    confirmedById: { type: String, default: null },
  },
  { timestamps: false },
)
WorkReportSchema.index({ organizationId: 1, userId: 1, kind: 1, periodKey: 1 }, { unique: true })
WorkReportSchema.index({ organizationId: 1, submittedAt: 1 })
WorkReportSchema.index({ userId: 1, submittedAt: 1 })

const ChatMessageSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    recipientId: { type: String, required: true },
    body: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
ChatMessageSchema.index({ senderId: 1, recipientId: 1, createdAt: 1 })

const ChatReadSchema = SchemaWithId(
  {
    userId: { type: String, required: true },
    peerId: { type: String, required: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
ChatReadSchema.index({ userId: 1, peerId: 1 }, { unique: true })

const UploadSessionSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    status: { type: String, enum: UploadSessionStatuses, default: 'OPEN' },
    expiresAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
UploadSessionSchema.index({ deviceId: 1, status: 1 })
UploadSessionSchema.index({ organizationId: 1, createdAt: 1 })

const RefreshTokenSchema = SchemaWithId(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true },
    deviceId: { type: String, default: null },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    replacedById: { type: String, default: null },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const AuditLogSchema = SchemaWithId(
  {
    actorUserId: { type: String, default: null },
    organizationId: { type: String, required: true },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String, default: null },
    metadata: { type: Object, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
AuditLogSchema.index({ organizationId: 1, createdAt: 1 })
AuditLogSchema.index({ action: 1, createdAt: 1 })

const PaymentRequestSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    createdByUserId: { type: String, required: true },
    assigneeUserId: { type: String, required: true },
    assigneeRole: { type: String, enum: OrgRoles, required: true },
    address: { type: String, required: true },
    asset: { type: String, required: true },
    network: { type: String, required: true },
    amountMinor: { type: String, required: true },
    notes: { type: String, default: '' },
    status: { type: String, enum: PaymentStatuses, default: 'PENDING' },
    txUrl: { type: String, default: null },
    fileName: { type: String, default: null },
    fileContentType: { type: String, default: null },
    fileKey: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
)
PaymentRequestSchema.index({ organizationId: 1, createdAt: 1 })
PaymentRequestSchema.index({ createdByUserId: 1, createdAt: 1 })
PaymentRequestSchema.index({ assigneeUserId: 1, status: 1 })

const ScreenshotReceiveRequestSchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    userId: { type: String, required: true },
    requestedById: { type: String, required: true },
    status: { type: String, enum: ScreenshotReceiveStatuses, default: 'OPEN' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
ScreenshotReceiveRequestSchema.index({ organizationId: 1, userId: 1, createdAt: 1 })

const ScreenshotReceiveResponseSchema = SchemaWithId(
  {
    requestId: { type: String, required: true },
    deviceId: { type: String, required: true },
    accepted: { type: Boolean, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
ScreenshotReceiveResponseSchema.index({ requestId: 1, deviceId: 1 }, { unique: true })

const IncomeEntrySchema = SchemaWithId(
  {
    organizationId: { type: String, required: true },
    createdByUserId: { type: String, required: true },
    source: { type: String, enum: IncomeSources, required: true },
    recipientKind: { type: String, enum: MoneyRecipients, required: true },
    recipientUserId: { type: String, default: null },
    asset: { type: String, required: true },
    network: { type: String, required: true },
    amountMinor: { type: String, required: true },
    notes: { type: String, default: '' },
    txUrl: { type: String, default: null },
    status: { type: String, enum: IncomeStatuses, default: 'PENDING' },
    fileName: { type: String, default: null },
    fileContentType: { type: String, default: null },
    fileKey: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
IncomeEntrySchema.index({ organizationId: 1, createdAt: 1 })
IncomeEntrySchema.index({ createdByUserId: 1, createdAt: 1 })
IncomeEntrySchema.index({ recipientUserId: 1 })

function reuse<T>(name: string, schema: Parameters<typeof model>[1]): Model<T> {
  return (mongoose.models[name] as Model<T>) || model<T>(name, schema)
}

export type OrganizationDoc = InferSchemaType<typeof OrganizationSchema> & { _id: string; id: string }
export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: string; id: string }
export type TeamDoc = InferSchemaType<typeof TeamSchema> & { _id: string; id: string }
export type TeamMemberDoc = InferSchemaType<typeof TeamMemberSchema> & { _id: string; id: string }
export type DeviceDoc = InferSchemaType<typeof DeviceSchema> & { _id: string; id: string }
export type MonitoringSessionDoc = InferSchemaType<typeof MonitoringSessionSchema> & {
  _id: string
  id: string
}
export type CaptureEventDoc = InferSchemaType<typeof CaptureEventSchema> & { _id: string; id: string }
export type ScreenshotDoc = InferSchemaType<typeof ScreenshotSchema> & { _id: string; id: string }
export type ScreenshotPolicyDoc = InferSchemaType<typeof ScreenshotPolicySchema> & {
  _id: string
  id: string
}
export type WorkReportDoc = InferSchemaType<typeof WorkReportSchema> & { _id: string; id: string }
export type ChatMessageDoc = InferSchemaType<typeof ChatMessageSchema> & { _id: string; id: string }
export type ChatReadDoc = InferSchemaType<typeof ChatReadSchema> & { _id: string; id: string }
export type UploadSessionDoc = InferSchemaType<typeof UploadSessionSchema> & { _id: string; id: string }
export type RefreshTokenDoc = InferSchemaType<typeof RefreshTokenSchema> & { _id: string; id: string }
export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & { _id: string; id: string }
export type PaymentRequestDoc = InferSchemaType<typeof PaymentRequestSchema> & { _id: string; id: string }
export type ScreenshotReceiveRequestDoc = InferSchemaType<typeof ScreenshotReceiveRequestSchema> & {
  _id: string
  id: string
}
export type ScreenshotReceiveResponseDoc = InferSchemaType<typeof ScreenshotReceiveResponseSchema> & {
  _id: string
  id: string
}
export type IncomeEntryDoc = InferSchemaType<typeof IncomeEntrySchema> & { _id: string; id: string }

export const Organization = reuse<OrganizationDoc>('Organization', OrganizationSchema)
export const User = reuse<UserDoc>('User', UserSchema)
export const Team = reuse<TeamDoc>('Team', TeamSchema)
export const TeamMember = reuse<TeamMemberDoc>('TeamMember', TeamMemberSchema)
export const Device = reuse<DeviceDoc>('Device', DeviceSchema)
export const MonitoringSession = reuse<MonitoringSessionDoc>('MonitoringSession', MonitoringSessionSchema)
export const CaptureEvent = reuse<CaptureEventDoc>('CaptureEvent', CaptureEventSchema)
export const Screenshot = reuse<ScreenshotDoc>('Screenshot', ScreenshotSchema)
export const ScreenshotPolicy = reuse<ScreenshotPolicyDoc>('ScreenshotPolicy', ScreenshotPolicySchema)
export const WorkReport = reuse<WorkReportDoc>('WorkReport', WorkReportSchema)
export const ChatMessage = reuse<ChatMessageDoc>('ChatMessage', ChatMessageSchema)
export const ChatRead = reuse<ChatReadDoc>('ChatRead', ChatReadSchema)
export const UploadSession = reuse<UploadSessionDoc>('UploadSession', UploadSessionSchema)
export const RefreshToken = reuse<RefreshTokenDoc>('RefreshToken', RefreshTokenSchema)
export const AuditLog = reuse<AuditLogDoc>('AuditLog', AuditLogSchema)
export const PaymentRequest = reuse<PaymentRequestDoc>('PaymentRequest', PaymentRequestSchema)
export const ScreenshotReceiveRequest = reuse<ScreenshotReceiveRequestDoc>(
  'ScreenshotReceiveRequest',
  ScreenshotReceiveRequestSchema,
)
export const ScreenshotReceiveResponse = reuse<ScreenshotReceiveResponseDoc>(
  'ScreenshotReceiveResponse',
  ScreenshotReceiveResponseSchema,
)
export const IncomeEntry = reuse<IncomeEntryDoc>('IncomeEntry', IncomeEntrySchema)

export const db = {
  Organization,
  User,
  Team,
  TeamMember,
  Device,
  MonitoringSession,
  CaptureEvent,
  Screenshot,
  ScreenshotPolicy,
  WorkReport,
  ChatMessage,
  ChatRead,
  UploadSession,
  RefreshToken,
  AuditLog,
  PaymentRequest,
  ScreenshotReceiveRequest,
  ScreenshotReceiveResponse,
  IncomeEntry,
}

export type Db = typeof db

export * from './enums.js'
export { withId, withIds } from './common.js'
