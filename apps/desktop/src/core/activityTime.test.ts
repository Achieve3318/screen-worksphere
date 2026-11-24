import { describe, expect, it } from 'vitest'
import { splitActiveTime } from './activityTime.js'

describe('splitActiveTime', () => {
  it('counts the whole segment while input is fresher than fifteen seconds', () => {
    expect(splitActiveTime(30_000, 0)).toEqual({ activeMs: 30_000, inactiveMs: 0 })
    expect(splitActiveTime(30_000, 14)).toEqual({ activeMs: 30_000, inactiveMs: 0 })
  })

  it('drops only the time after fifteen seconds without input', () => {
    expect(splitActiveTime(60_000, 45)).toEqual({ activeMs: 30_000, inactiveMs: 30_000 })
    expect(splitActiveTime(60_000, 600)).toEqual({ activeMs: 0, inactiveMs: 60_000 })
  })

  it('ignores an empty segment', () => {
    expect(splitActiveTime(0, 120)).toEqual({ activeMs: 0, inactiveMs: 0 })
  })
})
