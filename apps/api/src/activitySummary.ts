const TRACKED_GAP_MS = 15 * 60 * 1000

export type ActivityPoint = { capturedAt: Date; idle: boolean }

export type DayActivity = {
  date: string
  count: number
  trackedMs: number
  totalMs: number
  activeMs: number
  hours: number[]
}

export type MonitoringSpan = { startedAt: Date; trackedMs: number; idleMs: number }

export function summarizeCaptureActivity(events: ActivityPoint[], timeZone: string): DayActivity[] {
  const groups = new Map<string, { at: number; idle: boolean; hour: number }[]>()
  for (const event of events) {
    const date = localDateKey(event.capturedAt, timeZone)
    const list = groups.get(date) ?? []
    list.push({
      at: event.capturedAt.getTime(),
      idle: event.idle,
      hour: localHour(event.capturedAt, timeZone),
    })
    groups.set(date, list)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, list]) => {
      list.sort((left, right) => left.at - right.at)
      const hours = Array.from({ length: 24 }, () => 0)
      let trackedMs = 0
      for (let index = 0; index < list.length; index += 1) {
        const item = list[index]!
        const hour = item.hour
        if (hour >= 0 && hour < 24) hours[hour] = (hours[hour] ?? 0) + 1
        const previous = list[index - 1]
        if (!previous || item.idle || previous.idle) continue
        const gap = item.at - previous.at
        if (gap > 0 && gap <= TRACKED_GAP_MS) trackedMs += gap
      }
      return { date, count: list.length, trackedMs, totalMs: trackedMs, activeMs: trackedMs, hours }
    })
}

export function applyMonitoringSessions(
  days: DayActivity[],
  sessions: MonitoringSpan[],
  timeZone: string,
): DayActivity[] {
  const totals = new Map<string, { activeMs: number; totalMs: number }>()
  for (const session of sessions) {
    const date = localDateKey(session.startedAt, timeZone)
    const current = totals.get(date) ?? { activeMs: 0, totalMs: 0 }
    const activeMs = Math.max(0, session.trackedMs)
    const idleMs = Math.max(0, session.idleMs)
    current.activeMs += activeMs
    current.totalMs += activeMs + idleMs
    totals.set(date, current)
  }
  const byDate = new Map(days.map((day) => [day.date, { ...day, hours: [...day.hours] }]))
  for (const [date, monitored] of totals) {
    if (monitored.totalMs <= 0) continue
    const existing = byDate.get(date)
    if (existing) {
      existing.activeMs = monitored.activeMs
      existing.totalMs = monitored.totalMs
      existing.trackedMs = monitored.activeMs
    } else {
      byDate.set(date, {
        date,
        count: 0,
        trackedMs: monitored.activeMs,
        activeMs: monitored.activeMs,
        totalMs: monitored.totalMs,
        hours: Array.from({ length: 24 }, () => 0),
      })
    }
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function sessionShareByBucket(
  startedAtMs: number,
  endedAtMs: number,
  trackedMs: number,
  buckets: { start: number; end: number }[],
): number[] {
  const shares = buckets.map(() => 0)
  if (trackedMs <= 0 || buckets.length === 0) return shares
  const start = startedAtMs
  const end = Math.max(endedAtMs, start + 1)
  const span = end - start
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index]!
    const overlap = Math.min(end, bucket.end) - Math.max(start, bucket.start)
    if (overlap > 0) shares[index] = trackedMs * (overlap / span)
  }
  return shares
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
  return shifted.toISOString().slice(0, 10)
}

export function zonedDateTime(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcGuess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  return new Date(utcGuess - timeZoneOffset(new Date(utcGuess), timeZone))
}

function timeZoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  const hour = value('hour') === 24 ? 0 : value('hour')
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    hour,
    value('minute'),
    value('second'),
  )
  return asUtc - date.getTime()
}

function localHour(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((item) => item.type === 'hour')
  const hour = Number(part?.value ?? '0')
  return hour === 24 ? 0 : hour
}
