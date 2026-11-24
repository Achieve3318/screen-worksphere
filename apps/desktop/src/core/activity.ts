export type Activity =
  | 'stopped'
  | 'active'
  | 'capturing'
  | 'offline'
  | 'uploading'
  | 'upload_failed'
  | 'syncing'
  | 'up_to_date'

export function deriveActivity(input: {
  uploading: boolean
  syncing: boolean
  online: boolean
  uploadFailed: boolean
  pending: number
  capturing: boolean
  monitoring: boolean
}): Activity {
  if (input.uploading) return 'uploading'
  if (input.syncing) return 'syncing'
  if (!input.online) return 'offline'
  if (input.uploadFailed && input.pending > 0) return 'upload_failed'
  if (input.capturing) return 'capturing'
  if (!input.monitoring) return 'stopped'
  if (input.pending === 0) return 'up_to_date'
  return 'active'
}

export const activityLabels: Record<Activity, string> = {
  stopped: 'Monitoring stopped',
  active: 'Monitoring active',
  capturing: 'Capturing',
  offline: 'Offline',
  uploading: 'Uploading',
  upload_failed: 'Upload failed',
  syncing: 'Syncing',
  up_to_date: 'Up to date',
}
