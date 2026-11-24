/** Server-enforced capture bounds. Clients also clamp so a bad policy cannot capture continuously. */
export const CAPTURE_INTERVAL_MIN_SECONDS = 30
export const CAPTURE_INTERVAL_MAX_SECONDS = 60 * 60
export const CAPTURE_INTERVAL_DEFAULT_SECONDS = 60

export const QUALITY_MIN = 40
export const QUALITY_MAX = 100
export const QUALITY_DEFAULT = 70

export const MAX_WIDTH_OPTIONS = [2560, 1920, 1440] as const
export type MaxWidthOption = (typeof MAX_WIDTH_OPTIONS)[number]

export const SERVER_RETENTION_DAY_OPTIONS = [30, 60, 90, 180, 365] as const

export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024
export const UPLOAD_CONCURRENCY = 3
export const UPLOAD_SESSION_ITEM_LIMIT = 50
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60

export const DEVICE_ONLINE_WITHIN_MS = 5 * 60 * 1000
export const USER_ACTIVE_WITHIN_MS = 15 * 60 * 1000

export const LOCAL_STORAGE_STOP_RATIO = 0.95
export const LOCAL_STORAGE_WARN_RATIO = 0.8

export const WORK_NOTE_MAX_LENGTH = 500

export function effectiveIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return CAPTURE_INTERVAL_DEFAULT_SECONDS
  return Math.min(
    CAPTURE_INTERVAL_MAX_SECONDS,
    Math.max(CAPTURE_INTERVAL_MIN_SECONDS, Math.round(value)),
  )
}

export function isAllowedMaxWidth(value: number | null): value is MaxWidthOption | null {
  return value === null || (MAX_WIDTH_OPTIONS as readonly number[]).includes(value)
}
