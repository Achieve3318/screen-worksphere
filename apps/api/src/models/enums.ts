export const OrgRoles = ['OWNER', 'ADMIN', 'MANAGER', 'PAYMENT_MANAGER', 'MEMBER'] as const
export type OrgRole = (typeof OrgRoles)[number]

export const PaymentStatuses = ['PENDING', 'APPROVED', 'PAID'] as const
export type PaymentStatus = (typeof PaymentStatuses)[number]

export const IncomeSources = ['USER', 'BOSS'] as const
export type IncomeSource = (typeof IncomeSources)[number]

export const MoneyRecipients = ['BOSS', 'USER'] as const
export type MoneyRecipient = (typeof MoneyRecipients)[number]

export const IncomeStatuses = ['PENDING', 'PM_CONFIRMED', 'SENT_TO_BOSS', 'CONFIRMED'] as const
export type IncomeStatus = (typeof IncomeStatuses)[number]

export const TeamRoles = ['LEAD', 'MEMBER'] as const
export type TeamRole = (typeof TeamRoles)[number]

export const DevicePlatforms = ['WINDOWS', 'MACOS', 'LINUX', 'UNKNOWN'] as const
export type DevicePlatform = (typeof DevicePlatforms)[number]

export const CaptureModes = ['ALL_DISPLAYS', 'PRIMARY_ONLY'] as const
export type CaptureMode = (typeof CaptureModes)[number]

export const ImageFormats = ['WEBP', 'JPEG'] as const
export type ImageFormat = (typeof ImageFormats)[number]

export const ScreenshotStatuses = ['AWAITING_UPLOAD', 'STORED', 'FAILED'] as const
export type ScreenshotStatus = (typeof ScreenshotStatuses)[number]

export const UploadSessionStatuses = ['OPEN', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const
export type UploadSessionStatus = (typeof UploadSessionStatuses)[number]

export const ScreenshotReceiveStatuses = ['OPEN', 'SUPERSEDED'] as const
export type ScreenshotReceiveStatus = (typeof ScreenshotReceiveStatuses)[number]

export const ReportKinds = ['DAILY', 'WEEKLY'] as const
export type ReportKind = (typeof ReportKinds)[number]
