import type { Activity } from './activity.js'

export const appVersion = '0.1.0'

export type LocalSettings = {
  launchOnStartup: boolean
  startMonitoringOnLaunch: boolean
  minimizeToTray: boolean
  showCaptureNotifications: boolean
  shortcutEnabled: boolean
  shortcut: string
  apiUrl: string
}

export type ReportPrompt = { id: string; label: string }

export type ReportAnswer = { fieldId: string; text: string }

export type PolicyView = {
  captureEnabled: boolean
  screenshotIntervalSeconds: number
  captureMode: 'ALL_DISPLAYS' | 'PRIMARY_ONLY'
  format: 'WEBP' | 'JPEG'
  quality: number
  maxWidth: number | null
  manualUploadAllowed: boolean
  automaticUploadEnabled: boolean
  automaticUploadIntervalMinutes: number
  uploadOnlyOnUnmeteredNetwork: boolean
  deleteAfterUpload: boolean
  localRetentionDays: number
  maxLocalStorageGB: number
  pauseCaptureWhileLocked: boolean
  idleDetectionEnabled: boolean
  idleThresholdMinutes: number
  excludedApplications: string[]
  dailyReportFields: ReportPrompt[]
  weeklyReportFields: ReportPrompt[]
}

export type WeekDayTotal = {
  label: string
  totalMs: number
  activeMs: number
  isToday: boolean
}

export type DesktopState = {
  signedIn: boolean
  userName: string | null
  userEmail: string | null
  userRole: string | null
  organizationName: string | null
  deviceName: string | null
  deviceId: string | null
  revoked: boolean
  activity: Activity
  activityLabel: string
  monitoring: boolean
  segmentStartedAt: number | null
  accumulatedTrackedMs: number
  accumulatedIdleMs: number
  todayTrackedMs: number
  todayIdleMs: number
  weekDays: WeekDayTotal[]
  systemIdleSeconds: number
  pendingCount: number
  pendingBytes: number
  lastScreenshotAt: string | null
  lastSyncAt: string | null
  workNote: string
  upload: {
    completedFiles: number
    totalFiles: number
    completedBytes: number
    totalBytes: number
  } | null
  storageWarning: string | null
  message: string | null
  settings: LocalSettings
  policy: PolicyView | null
  reports: {
    dailySubmitted: boolean
    weeklySubmitted: boolean
    dailyConfirmed: boolean
    weeklyConfirmed: boolean
    dailyAnswers: ReportAnswer[]
    weeklyAnswers: ReportAnswer[]
  }
  storageUsedBytes: number
  appVersion: string
}

export function policyTransition(
  previous: Pick<PolicyView, 'screenshotIntervalSeconds' | 'captureEnabled'> | null,
  next: Pick<PolicyView, 'screenshotIntervalSeconds' | 'captureEnabled'>,
  monitoring: boolean,
): { stop: boolean; reschedule: boolean } {
  if (!monitoring) return { stop: false, reschedule: false }
  if (!next.captureEnabled) return { stop: true, reschedule: false }
  return {
    stop: false,
    reschedule: previous?.screenshotIntervalSeconds !== next.screenshotIntervalSeconds,
  }
}

export const defaultSettings = (): LocalSettings => ({
  launchOnStartup: false,
  startMonitoringOnLaunch: false,
  minimizeToTray: true,
  showCaptureNotifications: false,
  shortcutEnabled: false,
  shortcut: 'CommandOrControl+Alt+Shift+S',
  apiUrl: 'http://127.0.0.1:4000',
})
