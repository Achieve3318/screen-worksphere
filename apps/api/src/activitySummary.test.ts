import { describe, expect, it } from 'vitest'
import {
  applyMonitoringSessions,
  sessionShareByBucket,
  summarizeCaptureActivity,
} from './activitySummary.js'

describe('capture activity summary', () => {
  it('groups captures onto the local day and ignores gaps longer than 15 minutes', () => {
    const days = summarizeCaptureActivity(
      [
        { capturedAt: new Date('2026-10-01T16:30:00.000Z'), idle: false },
        { capturedAt: new Date('2026-10-01T16:32:00.000Z'), idle: false },
        { capturedAt: new Date('2026-10-01T18:00:00.000Z'), idle: false },
        { capturedAt: new Date('2026-10-01T18:01:00.000Z'), idle: true },
      ],
      'Asia/Shanghai',
    )
    expect(days).toHaveLength(1)
    expect(days[0]?.date).toBe('2026-10-02')
    expect(days[0]?.count).toBe(4)
    expect(days[0]?.trackedMs).toBe(2 * 60 * 1000)
    expect(days[0]?.hours[0]).toBe(2)
    expect(days[0]?.hours[2]).toBe(2)
  })

  it('uses monitored session time for the total and the active portion', () => {
    const captured = summarizeCaptureActivity(
      [
        { capturedAt: new Date('2026-10-01T16:30:00.000Z'), idle: false },
        { capturedAt: new Date('2026-10-01T16:32:00.000Z'), idle: false },
      ],
      'Asia/Shanghai',
    )
    const days = applyMonitoringSessions(
      captured,
      [
        {
          startedAt: new Date('2026-10-01T16:30:00.000Z'),
          trackedMs: 25 * 60 * 1000,
          idleMs: 10 * 60 * 1000,
        },
      ],
      'Asia/Shanghai',
    )
    expect(days[0]?.date).toBe('2026-10-02')
    expect(days[0]?.activeMs).toBe(25 * 60 * 1000)
    expect(days[0]?.totalMs).toBe(35 * 60 * 1000)
  })

  it('splits active time across the buckets a session overlaps', () => {
    const shares = sessionShareByBucket(0, 60 * 60 * 1000, 30 * 60 * 1000, [
      { start: 0, end: 30 * 60 * 1000 },
      { start: 30 * 60 * 1000, end: 60 * 60 * 1000 },
      { start: 60 * 60 * 1000, end: 90 * 60 * 1000 },
    ])
    expect(shares[0]).toBe(15 * 60 * 1000)
    expect(shares[1]).toBe(15 * 60 * 1000)
    expect(shares[2]).toBe(0)
  })
})
