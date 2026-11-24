export type IncomeSource = 'USER' | 'BOSS'
export type IncomeStatus = 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED'
export type RecipientKind = 'BOSS' | 'USER'
export type PaymentStatus = 'PENDING' | 'APPROVED' | 'PAID'
export type AssigneeRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'PAYMENT_MANAGER' | 'MEMBER'

export type IncomeRow = {
  amountMinor: bigint
  source: IncomeSource
  recipientKind: RecipientKind
  recipientUserId: string | null
  createdByUserId: string
  createdAt: Date
  status: IncomeStatus
  confirmedAt: Date | null
}

export type RequestRow = {
  amountMinor: bigint
  status: PaymentStatus
  assigneeUserId: string
  assigneeRole: AssigneeRole
  createdByUserId: string
  paidAt: Date | null
}

export type ManagerBalance = {
  userId: string
  income: bigint
  paid: bigint
  remaining: bigint
}

export type Ledger = {
  totalIncome: bigint
  totalUsed: bigint
  totalRemaining: bigint
  bossIncome: bigint
  bossPaid: bigint
  bossRemaining: bigint
  managers: ManagerBalance[]
}

function inPeriod(value: Date | null, from: Date, to: Date): boolean {
  if (!value) return false
  const time = value.getTime()
  return time >= from.getTime() && time < to.getTime()
}

function acceptedIncome(status: IncomeStatus): boolean {
  return status === 'PM_CONFIRMED' || status === 'SENT_TO_BOSS' || status === 'CONFIRMED'
}

function bossPays(role: AssigneeRole): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function buildLedger(
  incomes: IncomeRow[],
  requests: RequestRow[],
  managerIds: string[],
): Ledger {
  let totalIncome = 0n
  let bossIncome = 0n
  let transfersOut = 0n
  const managerIncome = new Map<string, bigint>()
  for (const id of managerIds) managerIncome.set(id, 0n)

  for (const income of incomes) {
    if (!acceptedIncome(income.status)) continue
    if (income.source === 'USER') {
      totalIncome += income.amountMinor
      const bossHolds = income.recipientKind === 'BOSS' || income.status === 'CONFIRMED'
      if (bossHolds) bossIncome += income.amountMinor
      else if (income.recipientUserId) {
        managerIncome.set(
          income.recipientUserId,
          (managerIncome.get(income.recipientUserId) ?? 0n) + income.amountMinor,
        )
      }
    } else if (income.recipientUserId) {
      transfersOut += income.amountMinor
      managerIncome.set(
        income.recipientUserId,
        (managerIncome.get(income.recipientUserId) ?? 0n) + income.amountMinor,
      )
    }
  }

  let totalUsed = 0n
  let bossPaid = 0n
  const managerPaid = new Map<string, bigint>()
  for (const id of managerIds) managerPaid.set(id, 0n)
  for (const request of requests) {
    if (request.status !== 'PAID') continue
    totalUsed += request.amountMinor
    if (bossPays(request.assigneeRole)) bossPaid += request.amountMinor
    else {
      managerPaid.set(
        request.assigneeUserId,
        (managerPaid.get(request.assigneeUserId) ?? 0n) + request.amountMinor,
      )
    }
  }

  const managers = managerIds.map((userId) => {
    const income = managerIncome.get(userId) ?? 0n
    const paid = managerPaid.get(userId) ?? 0n
    return { userId, income, paid, remaining: income - paid }
  })
  const bossRemaining = bossIncome - transfersOut - bossPaid
  return {
    totalIncome,
    totalUsed,
    totalRemaining: totalIncome - totalUsed,
    bossIncome,
    bossPaid,
    bossRemaining,
    managers,
  }
}

export function earnedInPeriod(incomes: IncomeRow[], userId: string, from: Date, to: Date): bigint {
  return incomes.reduce((total, income) => {
    if (
      income.source !== 'USER' ||
      !acceptedIncome(income.status) ||
      income.createdByUserId !== userId
    ) {
      return total
    }
    if (!inPeriod(income.confirmedAt, from, to)) return total
    return total + income.amountMinor
  }, 0n)
}

export function orgEarnedInPeriod(incomes: IncomeRow[], from: Date, to: Date): bigint {
  return incomes.reduce((total, income) => {
    if (income.source !== 'USER' || !acceptedIncome(income.status)) return total
    if (!inPeriod(income.confirmedAt, from, to)) return total
    return total + income.amountMinor
  }, 0n)
}

export function orgUsedInPeriod(requests: RequestRow[], from: Date, to: Date): bigint {
  return requests.reduce((total, request) => {
    if (request.status !== 'PAID' || !inPeriod(request.paidAt, from, to)) return total
    return total + request.amountMinor
  }, 0n)
}

export function usedInPeriod(requests: RequestRow[], userId: string, from: Date, to: Date): bigint {
  return requests.reduce((total, request) => {
    if (request.status !== 'PAID' || request.createdByUserId !== userId) return total
    if (!inPeriod(request.paidAt, from, to)) return total
    return total + request.amountMinor
  }, 0n)
}
