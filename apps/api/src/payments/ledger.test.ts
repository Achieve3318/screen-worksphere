import { describe, expect, it } from 'vitest'
import {
  buildLedger,
  earnedInPeriod,
  orgEarnedInPeriod,
  orgUsedInPeriod,
  usedInPeriod,
  type IncomeRow,
  type RequestRow,
} from './ledger.js'
import { formatAmount, parseAmount } from './money.js'

const weekStart = new Date('2026-09-28T00:00:00+08:00')
const weekEnd = new Date('2026-10-05T00:00:00+08:00')

describe('money', () => {
  it('keeps up to 8 decimal places exact', () => {
    expect(formatAmount(parseAmount('10'))).toBe('10.00')
    expect(formatAmount(parseAmount('10.50'))).toBe('10.50')
    expect(formatAmount(parseAmount('0.00000001'))).toBe('0.00000001')
    expect(formatAmount(parseAmount('1.23000000'))).toBe('1.23')
    expect(() => parseAmount('0')).toThrow(/greater than zero/)
    expect(() => parseAmount('1.123456789')).toThrow(/8 decimal/)
  })
})

describe('payment ledger', () => {
  const pm = 'pm-1'
  const member = 'member-1'
  const incomes: IncomeRow[] = [
    row('100', 'USER', 'BOSS', null, member),
    { ...row('40', 'USER', 'USER', pm, member), status: 'PM_CONFIRMED' },
    row('25', 'BOSS', 'USER', pm, pm),
  ]
  const requests: RequestRow[] = [
    paid('10', pm, 'PAYMENT_MANAGER', member),
    paid('30', 'admin-1', 'ADMIN', member),
    {
      amountMinor: parseAmount('5'),
      status: 'APPROVED',
      assigneeUserId: pm,
      assigneeRole: 'PAYMENT_MANAGER',
      createdByUserId: member,
      paidAt: null,
    },
  ]

  it('keeps boss, manager, and organization totals in balance', () => {
    const ledger = buildLedger(incomes, requests, [pm])
    expect(formatAmount(ledger.totalIncome)).toBe('140.00')
    expect(formatAmount(ledger.totalUsed)).toBe('40.00')
    expect(formatAmount(ledger.totalRemaining)).toBe('100.00')
    expect(formatAmount(ledger.bossRemaining)).toBe('45.00')
    expect(formatAmount(ledger.managers[0]?.remaining ?? 0n)).toBe('55.00')
    const managerSum = ledger.managers.reduce((total, item) => total + item.remaining, 0n)
    expect(ledger.bossRemaining + managerSum).toBe(ledger.totalRemaining)
  })

  it('counts earned and used inside the period only after payment', () => {
    expect(formatAmount(earnedInPeriod(incomes, member, weekStart, weekEnd))).toBe('140.00')
    expect(formatAmount(usedInPeriod(requests, member, weekStart, weekEnd))).toBe('40.00')
    expect(formatAmount(orgEarnedInPeriod(incomes, weekStart, weekEnd))).toBe('140.00')
    expect(formatAmount(orgUsedInPeriod(requests, weekStart, weekEnd))).toBe('40.00')
    expect(
      formatAmount(
        usedInPeriod(
          requests,
          member,
          new Date('2026-10-10T00:00:00Z'),
          new Date('2026-10-17T00:00:00Z'),
        ),
      ),
    ).toBe('0.00')
  })

  it('adds income sent to a payment manager only after it is confirmed', () => {
    const pending: IncomeRow = {
      ...row('40', 'USER', 'USER', pm, member),
      status: 'PENDING',
      confirmedAt: null,
    }
    const waiting = buildLedger([incomes[0]!, pending, incomes[2]!], requests, [pm])
    expect(formatAmount(waiting.totalIncome)).toBe('100.00')
    expect(formatAmount(waiting.managers[0]?.income ?? 0n)).toBe('25.00')
    expect(formatAmount(waiting.totalRemaining)).toBe('60.00')
    expect(waiting.bossRemaining + (waiting.managers[0]?.remaining ?? 0n)).toBe(
      waiting.totalRemaining,
    )
    expect(formatAmount(earnedInPeriod([pending], member, weekStart, weekEnd))).toBe('0.00')

    const confirmed: IncomeRow = {
      ...pending,
      status: 'PM_CONFIRMED',
      confirmedAt: new Date('2026-10-02T03:00:00Z'),
    }
    const settled = buildLedger([incomes[0]!, confirmed, incomes[2]!], requests, [pm])
    expect(formatAmount(settled.totalIncome)).toBe('140.00')
    expect(formatAmount(settled.managers[0]?.remaining ?? 0n)).toBe('55.00')
    expect(formatAmount(earnedInPeriod([confirmed], member, weekStart, weekEnd))).toBe('40.00')

    const bossConfirmed: IncomeRow = { ...confirmed, status: 'CONFIRMED' }
    const withBoss = buildLedger([incomes[0]!, bossConfirmed, incomes[2]!], requests, [pm])
    expect(formatAmount(withBoss.managers[0]?.remaining ?? 0n)).toBe('15.00')
    expect(formatAmount(withBoss.bossRemaining)).toBe('85.00')
    expect(withBoss.bossRemaining + (withBoss.managers[0]?.remaining ?? 0n)).toBe(
      withBoss.totalRemaining,
    )
  })

  it('counts income sent to the boss only after the boss confirms it', () => {
    const pending = {
      ...row('40', 'USER', 'BOSS', null, member),
      status: 'PENDING' as const,
      confirmedAt: null,
    }
    const waiting = buildLedger([pending], [], [pm])
    expect(formatAmount(waiting.totalIncome)).toBe('0.00')
    expect(formatAmount(waiting.bossRemaining)).toBe('0.00')
    const confirmed = {
      ...pending,
      status: 'CONFIRMED' as const,
      confirmedAt: new Date('2026-10-02T03:00:00Z'),
    }
    const settled = buildLedger([confirmed], [], [pm])
    expect(formatAmount(settled.bossRemaining)).toBe('40.00')
    expect(formatAmount(settled.managers[0]?.remaining ?? 0n)).toBe('0.00')
    expect(formatAmount(earnedInPeriod([confirmed], member, weekStart, weekEnd))).toBe('40.00')
  })
})

function row(
  amount: string,
  source: IncomeRow['source'],
  recipientKind: IncomeRow['recipientKind'],
  recipientUserId: string | null,
  createdByUserId: string,
): IncomeRow {
  return {
    amountMinor: parseAmount(amount),
    source,
    recipientKind,
    recipientUserId,
    createdByUserId,
    createdAt: new Date('2026-10-02T01:00:00Z'),
    status: 'CONFIRMED',
    confirmedAt: new Date('2026-10-02T01:00:00Z'),
  }
}

function paid(
  amount: string,
  assigneeUserId: string,
  assigneeRole: RequestRow['assigneeRole'],
  createdByUserId: string,
): RequestRow {
  return {
    amountMinor: parseAmount(amount),
    status: 'PAID',
    assigneeUserId,
    assigneeRole,
    createdByUserId,
    paidAt: new Date('2026-10-02T02:00:00Z'),
  }
}
