import { randomUUID } from 'node:crypto'
import type { OrgRole } from '@screenvault/shared'
import {
  errorCodes,
  type CreateIncomeInput,
  type CreatePaymentRequestInput,
} from '@screenvault/types'
import type { Db } from '../db.js'
import { withId, withIds } from '../models/index.js'
import { writeAudit } from '../auditLog.js'
import type { AuthContext } from '../context.js'
import { ApiError, forbidden, notFound } from '../errors.js'
import type { ScreenshotStorage } from '../storage.js'
import {
  buildLedger,
  earnedInPeriod,
  orgEarnedInPeriod,
  orgUsedInPeriod,
  usedInPeriod,
  type AssigneeRole,
  type IncomeRow,
  type RequestRow,
} from '../payments/ledger.js'
import { formatAmount, parseAmount } from '../payments/money.js'

const FILE_LIMIT = 8 * 1024 * 1024
const payeeRoles = new Set<OrgRole>(['OWNER', 'ADMIN', 'PAYMENT_MANAGER'])

type RequestMeta = { ipAddress: string | null; userAgent: string | null }
type Scope = 'mine' | 'assigned' | 'all'

type StoredFile = { name: string; contentType: string; body: Buffer }

function validation(message: string): ApiError {
  return new ApiError(400, errorCodes.VALIDATION_ERROR, message)
}

function amountOf(input: string): bigint {
  try {
    return parseAmount(input)
  } catch (error) {
    throw validation(error instanceof Error ? error.message : 'Enter a valid amount.')
  }
}

function readFile(file: CreatePaymentRequestInput['file']): StoredFile | null {
  if (!file) return null
  const body = Buffer.from(file.dataBase64, 'base64')
  if (body.length === 0 || body.length > FILE_LIMIT) {
    throw validation('The referral file must be a PDF or image under 8 MB.')
  }
  return { name: file.name, contentType: file.contentType, body }
}

function period(fromIso: string, toIso: string, maxDays: number): { from: Date; to: Date } {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw validation('Choose a valid period.')
  }
  if (to.getTime() - from.getTime() > maxDays * 24 * 60 * 60 * 1000) {
    throw validation('That period is too long.')
  }
  return { from, to }
}

function isAdmin(auth: AuthContext): boolean {
  return auth.role === 'OWNER' || auth.role === 'ADMIN'
}

async function payee(db: Db, organizationId: string, userId: string) {
  const user = withId(
    await db.User.findOne({ _id: userId, organizationId, disabledAt: null })
      .select('name role')
      .lean(),
  )
  if (!user || !payeeRoles.has(user.role)) {
    throw validation('Choose an admin or a payment manager.')
  }
  return user
}

export async function listPayees(db: Db, auth: AuthContext) {
  const people = withIds(
    await db.User.find({
      organizationId: auth.organizationId,
      disabledAt: null,
      role: { $in: ['OWNER', 'ADMIN', 'PAYMENT_MANAGER'] },
    })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ).map((user) => ({ id: user.id, name: user.name, role: user.role }))
  return { items: people }
}

export async function createPaymentRequest(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  input: CreatePaymentRequestInput,
  meta: RequestMeta,
) {
  const assignee = await payee(db, auth.organizationId, input.assigneeUserId)
  const amountMinor = amountOf(input.amount)
  const file = readFile(input.file)
  const id = randomUUID()
  const fileKey = file ? `orgs/${auth.organizationId}/payments/${id}` : null
  if (file && fileKey) await storage.put(fileKey, file.body, file.contentType)
  try {
    const created = await db.PaymentRequest.create({
      _id: id,
      organizationId: auth.organizationId,
      createdByUserId: auth.userId,
      assigneeUserId: assignee.id,
      assigneeRole: assignee.role,
      address: input.address,
      asset: input.asset,
      network: input.network,
      amountMinor: amountMinor.toString(),
      notes: input.notes,
      fileName: file?.name,
      fileContentType: file?.contentType,
      fileKey,
    })
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'payment.requested',
      resourceType: 'payment',
      resourceId: id,
      metadata: { amount: formatAmount(amountMinor), asset: input.asset, assigneeId: assignee.id },
      ...meta,
    })
    return mapRequest(await hydrateRequest(db, created.toObject()))
  } catch (error) {
    if (fileKey) await storage.delete(fileKey).catch(() => undefined)
    throw error
  }
}

export async function createIncome(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  input: CreateIncomeInput,
  meta: RequestMeta,
) {
  const recipientId =
    input.source === 'BOSS' && auth.role === 'PAYMENT_MANAGER' ? auth.userId : input.recipientUserId
  if (input.source === 'BOSS') {
    if (!isAdmin(auth) && auth.role !== 'PAYMENT_MANAGER') {
      throw forbidden('Only a payment manager can add income from the boss.')
    }
    if (auth.role === 'PAYMENT_MANAGER' && recipientId !== auth.userId) {
      throw forbidden('Add boss income to your own balance.')
    }
  }
  let recipientUserId: string | null = null
  if (input.recipientKind === 'USER' || input.source === 'BOSS') {
    const recipient = await payee(db, auth.organizationId, recipientId ?? '')
    if (recipient.role !== 'PAYMENT_MANAGER') {
      throw validation('Send income to the boss or a payment manager.')
    }
    recipientUserId = recipient.id
  }
  const amountMinor = amountOf(input.amount)
  const file = readFile(input.file)
  const id = randomUUID()
  const fileKey = file ? `orgs/${auth.organizationId}/income/${id}` : null
  if (file && fileKey) await storage.put(fileKey, file.body, file.contentType)
  try {
    const created = await db.IncomeEntry.create({
      _id: id,
      organizationId: auth.organizationId,
      createdByUserId: auth.userId,
      source: input.source,
      recipientKind: input.source === 'BOSS' ? 'USER' : input.recipientKind,
      recipientUserId,
      asset: input.asset,
      network: input.network,
      amountMinor: amountMinor.toString(),
      notes: input.notes,
      txUrl: input.source === 'USER' ? (input.txUrl ?? null) : null,
      status: input.source === 'USER' ? 'PENDING' : 'CONFIRMED',
      confirmedAt: input.source === 'USER' ? null : new Date(),
      fileName: file?.name,
      fileContentType: file?.contentType,
      fileKey,
    })
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: input.source === 'BOSS' ? 'income.boss' : 'income.recorded',
      resourceType: 'income',
      resourceId: id,
      metadata: { amount: formatAmount(amountMinor), asset: input.asset },
      ...meta,
    })
    return mapIncome(await hydrateIncome(db, created.toObject()))
  } catch (error) {
    if (fileKey) await storage.delete(fileKey).catch(() => undefined)
    throw error
  }
}

export async function updatePaymentStatus(
  db: Db,
  auth: AuthContext,
  id: string,
  status: 'PENDING' | 'APPROVED' | 'PAID',
  txUrl: string | null,
  meta: RequestMeta,
) {
  const current = await db.PaymentRequest.findOne({
    _id: id,
    organizationId: auth.organizationId,
  }).lean()
  if (!current) throw notFound('Payment request was not found.')
  if (!isAdmin(auth) && current.assigneeUserId !== auth.userId) {
    throw forbidden('You can update payments assigned to you.')
  }
  const paidAt =
    status === 'PAID' ? (current.status === 'PAID' ? current.paidAt : new Date()) : null
  const updated = await db.PaymentRequest.findByIdAndUpdate(
    current._id,
    { $set: { status, paidAt, txUrl: status === 'PAID' ? txUrl : null } },
    { new: true },
  ).lean()
  if (!updated) throw notFound('Payment request was not found.')
  if (current.status !== status) {
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'payment.status',
      resourceType: 'payment',
      resourceId: id,
      metadata: {
        from: current.status,
        to: status,
        amount: formatAmount(BigInt(current.amountMinor)),
      },
      ...meta,
    })
  }
  return mapRequest(await hydrateRequest(db, updated))
}

export async function updateIncomeStatus(
  db: Db,
  auth: AuthContext,
  id: string,
  status: 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED',
  meta: RequestMeta,
) {
  const current = await db.IncomeEntry.findOne({
    _id: id,
    organizationId: auth.organizationId,
  }).lean()
  if (!current) throw notFound('Income record was not found.')
  const sentToBoss = current.source === 'USER' && current.recipientKind === 'BOSS'
  const sentToManager =
    current.source === 'USER' && current.recipientKind === 'USER' && current.recipientUserId
  if (sentToBoss) {
    if (!isAdmin(auth)) throw forbidden('Only the boss can confirm income sent to them.')
    if (status !== 'PENDING' && status !== 'CONFIRMED') {
      throw validation('Income sent to the boss is pending or confirmed.')
    }
  } else if (!sentToManager) {
    throw validation('Only income sent to a payment manager can be confirmed.')
  } else if (!isAdmin(auth) && current.recipientUserId !== auth.userId) {
    throw forbidden('You can confirm income sent to you.')
  } else if (!isAdmin(auth) && current.status === 'CONFIRMED') {
    throw forbidden('The boss already confirmed this income.')
  } else if (!isAdmin(auth) && status === 'CONFIRMED') {
    throw forbidden('Only the boss can mark this income confirmed.')
  }
  const counts = status !== 'PENDING'
  const alreadyCounted = current.status !== 'PENDING'
  const confirmedAt = counts ? (alreadyCounted ? current.confirmedAt : new Date()) : null
  const updated = await db.IncomeEntry.findByIdAndUpdate(
    current._id,
    { $set: { status, confirmedAt } },
    { new: true },
  ).lean()
  if (!updated) throw notFound('Income record was not found.')
  if (current.status !== status) {
    await writeAudit(db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'income.status',
      resourceType: 'income',
      resourceId: id,
      metadata: {
        from: current.status,
        to: status,
        amount: formatAmount(BigInt(current.amountMinor)),
      },
      ...meta,
    })
  }
  return mapIncome(await hydrateIncome(db, updated))
}

export async function paymentSummary(
  db: Db,
  auth: AuthContext,
  query: { weekFrom: string; weekTo: string; monthFrom: string; monthTo: string },
) {
  const week = period(query.weekFrom, query.weekTo, 8)
  const month = period(query.monthFrom, query.monthTo, 32)
  const [incomes, requests, managers] = await loadLedger(db, auth.organizationId)
  const ledger = buildLedger(
    incomes,
    requests,
    managers.map((item) => item.id),
  )
  const weekEarned = earnedInPeriod(incomes, auth.userId, week.from, week.to)
  const weekUsed = usedInPeriod(requests, auth.userId, week.from, week.to)
  const monthEarned = earnedInPeriod(incomes, auth.userId, month.from, month.to)
  const monthUsed = usedInPeriod(requests, auth.userId, month.from, month.to)
  const mine = ledger.managers.find((item) => item.userId === auth.userId)
  const managerRows = isAdmin(auth)
    ? ledger.managers.map((item) => ({
        ...item,
        name: managers.find((person) => person.id === item.userId)?.name ?? 'Payment manager',
        income: formatAmount(item.income),
        paid: formatAmount(item.paid),
        remaining: formatAmount(item.remaining),
      }))
    : null
  return {
    week: { earned: formatAmount(weekEarned), used: formatAmount(weekUsed) },
    month: { earned: formatAmount(monthEarned), used: formatAmount(monthUsed) },
    orgWeek: isAdmin(auth)
      ? {
          earned: formatAmount(orgEarnedInPeriod(incomes, week.from, week.to)),
          used: formatAmount(orgUsedInPeriod(requests, week.from, week.to)),
        }
      : null,
    orgMonth: isAdmin(auth)
      ? {
          earned: formatAmount(orgEarnedInPeriod(incomes, month.from, month.to)),
          used: formatAmount(orgUsedInPeriod(requests, month.from, month.to)),
        }
      : null,
    remaining: isAdmin(auth)
      ? formatAmount(ledger.totalRemaining)
      : auth.role === 'PAYMENT_MANAGER' && mine
        ? formatAmount(mine.remaining)
        : null,
    bossRemaining: isAdmin(auth) ? formatAmount(ledger.bossRemaining) : null,
    totalIncome: isAdmin(auth) ? formatAmount(ledger.totalIncome) : null,
    totalUsed: isAdmin(auth) ? formatAmount(ledger.totalUsed) : null,
    managers: managerRows,
  }
}

export async function listPaymentRequests(db: Db, auth: AuthContext, scope: Scope) {
  if (scope === 'all' && !isAdmin(auth)) throw forbidden('Only an admin can see every payment.')
  if (scope === 'assigned' && !isAdmin(auth) && auth.role !== 'PAYMENT_MANAGER') {
    throw forbidden('Only a payment manager can review assigned payments.')
  }
  const filter: Record<string, unknown> = { organizationId: auth.organizationId }
  if (scope === 'mine') filter.createdByUserId = auth.userId
  if (scope === 'assigned') filter.assigneeUserId = auth.userId
  const rows = await db.PaymentRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean()
  const hydrated = await hydrateRequests(db, rows)
  return { items: hydrated.map(mapRequest) }
}

export async function listIncome(
  db: Db,
  auth: AuthContext,
  scope: 'mine' | 'all' | 'received',
) {
  if (scope === 'all' && !isAdmin(auth))
    throw forbidden('Only an admin can see every income record.')
  if (scope === 'received' && !isAdmin(auth) && auth.role !== 'PAYMENT_MANAGER') {
    throw forbidden('Only a payment manager can review income sent to them.')
  }
  const filter: Record<string, unknown> = { organizationId: auth.organizationId }
  if (scope === 'mine') filter.createdByUserId = auth.userId
  if (scope === 'received') {
    filter.recipientUserId = auth.userId
    filter.source = 'USER'
    filter.recipientKind = 'USER'
  }
  const rows = await db.IncomeEntry.find(filter).sort({ createdAt: -1 }).limit(200).lean()
  const hydrated = await hydrateIncomes(db, rows)
  return { items: hydrated.map(mapIncome) }
}

export async function readRequestFile(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  id: string,
) {
  const row = await db.PaymentRequest.findOne({
    _id: id,
    organizationId: auth.organizationId,
  }).lean()
  if (!row || !row.fileKey) throw notFound('That referral file was not found.')
  if (!isAdmin(auth) && row.createdByUserId !== auth.userId && row.assigneeUserId !== auth.userId) {
    throw forbidden('You cannot open that file.')
  }
  const stored = await storage.get(row.fileKey)
  if (!stored) throw notFound('That referral file was not found.')
  return {
    body: stored.body,
    contentType: row.fileContentType ?? stored.contentType,
    fileName: row.fileName ?? 'referral',
  }
}

export async function readIncomeFile(
  db: Db,
  storage: ScreenshotStorage,
  auth: AuthContext,
  id: string,
) {
  const row = await db.IncomeEntry.findOne({
    _id: id,
    organizationId: auth.organizationId,
  }).lean()
  if (!row || !row.fileKey) throw notFound('That referral file was not found.')
  const recipient = row.recipientUserId === auth.userId
  if (!isAdmin(auth) && row.createdByUserId !== auth.userId && !recipient) {
    throw forbidden('You cannot open that file.')
  }
  const stored = await storage.get(row.fileKey)
  if (!stored) throw notFound('That referral file was not found.')
  return {
    body: stored.body,
    contentType: row.fileContentType ?? stored.contentType,
    fileName: row.fileName ?? 'referral',
  }
}

type PaymentRequestLean = {
  _id: string
  address: string
  asset: string
  network: string
  amountMinor: string
  notes: string
  status: 'PENDING' | 'APPROVED' | 'PAID'
  txUrl: string | null
  fileName: string | null
  createdAt: Date
  paidAt: Date | null
  createdByUserId: string
  assigneeUserId: string
}

type IncomeEntryLean = {
  _id: string
  source: 'USER' | 'BOSS'
  recipientKind: 'BOSS' | 'USER'
  asset: string
  network: string
  amountMinor: string
  notes: string
  txUrl: string | null
  status: 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED'
  fileName: string | null
  createdAt: Date
  confirmedAt: Date | null
  createdByUserId: string
  recipientUserId: string | null
}

async function hydrateRequest(
  db: Db,
  row: PaymentRequestLean,
): Promise<Parameters<typeof mapRequest>[0]> {
  const [createdBy, assignee] = await Promise.all([
    withId(await db.User.findById(row.createdByUserId).select('name').lean()),
    withId(await db.User.findById(row.assigneeUserId).select('name role').lean()),
  ])
  return {
    id: row._id,
    address: row.address,
    asset: row.asset,
    network: row.network,
    amountMinor: row.amountMinor,
    notes: row.notes,
    status: row.status,
    txUrl: row.txUrl,
    fileName: row.fileName,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    createdBy: { id: createdBy!.id, name: createdBy!.name },
    assignee: {
      id: assignee!.id,
      name: assignee!.name,
      role: assignee!.role as OrgRole,
    },
  }
}

async function hydrateRequests(db: Db, rows: PaymentRequestLean[]) {
  const userIds = new Set<string>()
  for (const row of rows) {
    userIds.add(row.createdByUserId)
    userIds.add(row.assigneeUserId)
  }
  const users = withIds(
    userIds.size
      ? await db.User.find({ _id: { $in: [...userIds] } })
          .select('name role')
          .lean()
      : [],
  )
  const userById = new Map(users.map((user) => [user.id, user]))
  return rows.map((row) => {
    const createdBy = userById.get(row.createdByUserId)
    const assignee = userById.get(row.assigneeUserId)
    return {
      id: row._id,
      address: row.address,
      asset: row.asset,
      network: row.network,
      amountMinor: row.amountMinor,
      notes: row.notes,
      status: row.status,
      txUrl: row.txUrl,
      fileName: row.fileName,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      createdBy: { id: createdBy?.id ?? row.createdByUserId, name: createdBy?.name ?? '' },
      assignee: {
        id: assignee?.id ?? row.assigneeUserId,
        name: assignee?.name ?? '',
        role: (assignee?.role ?? 'MEMBER') as OrgRole,
      },
    }
  })
}

async function hydrateIncome(db: Db, row: IncomeEntryLean): Promise<Parameters<typeof mapIncome>[0]> {
  const createdBy = withId(await db.User.findById(row.createdByUserId).select('name').lean())
  const recipient = row.recipientUserId
    ? withId(await db.User.findById(row.recipientUserId).select('name role').lean())
    : null
  return {
    id: row._id,
    source: row.source,
    recipientKind: row.recipientKind,
    asset: row.asset,
    network: row.network,
    amountMinor: row.amountMinor,
    notes: row.notes,
    txUrl: row.txUrl,
    status: row.status,
    fileName: row.fileName,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    createdBy: { id: createdBy!.id, name: createdBy!.name },
    recipient: recipient
      ? { id: recipient.id, name: recipient.name, role: recipient.role as OrgRole }
      : null,
  }
}

async function hydrateIncomes(db: Db, rows: IncomeEntryLean[]) {
  const userIds = new Set<string>()
  for (const row of rows) {
    userIds.add(row.createdByUserId)
    if (row.recipientUserId) userIds.add(row.recipientUserId)
  }
  const users = withIds(
    userIds.size
      ? await db.User.find({ _id: { $in: [...userIds] } })
          .select('name role')
          .lean()
      : [],
  )
  const userById = new Map(users.map((user) => [user.id, user]))
  return rows.map((row) => {
    const createdBy = userById.get(row.createdByUserId)
    const recipient = row.recipientUserId ? userById.get(row.recipientUserId) : null
    return {
      id: row._id,
      source: row.source,
      recipientKind: row.recipientKind,
      asset: row.asset,
      network: row.network,
      amountMinor: row.amountMinor,
      notes: row.notes,
      txUrl: row.txUrl,
      status: row.status,
      fileName: row.fileName,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      createdBy: { id: createdBy?.id ?? row.createdByUserId, name: createdBy?.name ?? '' },
      recipient: recipient
        ? { id: recipient.id, name: recipient.name, role: recipient.role as OrgRole }
        : null,
    }
  })
}

function mapRequest(row: {
  id: string
  address: string
  asset: string
  network: string
  amountMinor: string
  notes: string
  status: 'PENDING' | 'APPROVED' | 'PAID'
  txUrl: string | null
  fileName: string | null
  createdAt: Date
  paidAt: Date | null
  createdBy: { id: string; name: string }
  assignee: { id: string; name: string; role: OrgRole }
}) {
  return {
    id: row.id,
    address: row.address,
    asset: row.asset,
    network: row.network,
    amount: formatAmount(BigInt(row.amountMinor)),
    notes: row.notes,
    status: row.status,
    txUrl: row.txUrl,
    fileName: row.fileName,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    createdBy: row.createdBy,
    assignee: row.assignee,
  }
}

function mapIncome(row: {
  id: string
  source: 'USER' | 'BOSS'
  recipientKind: 'BOSS' | 'USER'
  asset: string
  network: string
  amountMinor: string
  notes: string
  txUrl: string | null
  status: 'PENDING' | 'PM_CONFIRMED' | 'SENT_TO_BOSS' | 'CONFIRMED'
  fileName: string | null
  createdAt: Date
  confirmedAt: Date | null
  createdBy: { id: string; name: string }
  recipient: { id: string; name: string; role: OrgRole } | null
}) {
  return {
    id: row.id,
    source: row.source,
    recipientKind: row.recipientKind,
    asset: row.asset,
    network: row.network,
    amount: formatAmount(BigInt(row.amountMinor)),
    notes: row.notes,
    txUrl: row.txUrl,
    status: row.status,
    fileName: row.fileName,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    createdBy: row.createdBy,
    recipient: row.recipient,
  }
}

async function loadLedger(db: Db, organizationId: string) {
  const [incomeRows, requestRows, managerDocs] = await Promise.all([
    db.IncomeEntry.find({ organizationId })
      .select(
        'amountMinor source recipientKind recipientUserId createdByUserId createdAt status confirmedAt',
      )
      .lean(),
    db.PaymentRequest.find({ organizationId })
      .select('amountMinor status assigneeUserId assigneeRole createdByUserId paidAt')
      .lean(),
    db.User.find({ organizationId, role: 'PAYMENT_MANAGER' }).select('name').sort({ name: 1 }).lean(),
  ])
  const managers = withIds(managerDocs).map((user) => ({ id: user.id, name: user.name }))
  const incomes: IncomeRow[] = incomeRows.map((row) => ({
    amountMinor: BigInt(row.amountMinor),
    source: row.source,
    recipientKind: row.recipientKind,
    recipientUserId: row.recipientUserId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    status: row.status,
    confirmedAt: row.confirmedAt,
  }))
  const requests: RequestRow[] = requestRows.map((row) => ({
    amountMinor: BigInt(row.amountMinor),
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeRole: row.assigneeRole as AssigneeRole,
    createdByUserId: row.createdByUserId,
    paidAt: row.paidAt,
  }))
  const known = new Set(managers.map((item) => item.id))
  const extraIds = new Set<string>()
  for (const row of incomes) {
    if (
      (row.status === 'PM_CONFIRMED' ||
        row.status === 'SENT_TO_BOSS' ||
        row.status === 'CONFIRMED') &&
      row.recipientUserId &&
      (row.source === 'BOSS' || row.recipientKind === 'USER') &&
      !known.has(row.recipientUserId)
    ) {
      extraIds.add(row.recipientUserId)
    }
  }
  for (const row of requests) {
    if (
      row.status === 'PAID' &&
      row.assigneeRole !== 'OWNER' &&
      row.assigneeRole !== 'ADMIN' &&
      !known.has(row.assigneeUserId)
    ) {
      extraIds.add(row.assigneeUserId)
    }
  }
  const extras = extraIds.size
    ? withIds(
        await db.User.find({ _id: { $in: [...extraIds] }, organizationId }).select('name').lean(),
      ).map((user) => ({ id: user.id, name: user.name }))
    : []
  const people = [...managers]
  for (const id of extraIds) {
    people.push(extras.find((item) => item.id === id) ?? { id, name: 'Former payment manager' })
  }
  return [incomes, requests, people] as const
}
