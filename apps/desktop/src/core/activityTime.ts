/** Fifteen seconds without mouse or keyboard input is no longer active time. */
export const ACTIVE_IDLE_LIMIT_MS = 15_000

export function splitActiveTime(
  deltaMs: number,
  idleSeconds: number,
): { activeMs: number; inactiveMs: number } {
  if (deltaMs <= 0) return { activeMs: 0, inactiveMs: 0 }
  const idleMs = Math.max(0, idleSeconds) * 1000
  const inactiveTail = Math.max(0, idleMs - ACTIVE_IDLE_LIMIT_MS)
  const inactiveMs = Math.min(deltaMs, inactiveTail)
  return { activeMs: deltaMs - inactiveMs, inactiveMs }
}
