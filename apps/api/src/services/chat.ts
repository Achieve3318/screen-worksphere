import { errorCodes } from '@screenvault/types'
import type { Db } from '../db.js'
import type { AuthContext } from '../context.js'
import { ApiError, notFound } from '../errors.js'
import { withId } from '../models/index.js'

export type ChatPerson = {
  id: string
  name: string
  email: string
  lastBody: string | null
  lastAt: string | null
  incomingBody: string | null
  incomingAt: string | null
  unread: number
}

export type ChatLine = {
  id: string
  senderId: string
  body: string
  createdAt: string
}

export async function listChatPeople(db: Db, auth: AuthContext): Promise<ChatPerson[]> {
  const peers = await db.User.find({
    organizationId: auth.organizationId,
    _id: { $ne: auth.userId },
    disabledAt: null,
  })
    .select('name email')
    .lean()

  const rows = await Promise.all(
    peers.map(async (peerRaw) => {
      const peer = withId(peerRaw)!
      const pair = {
        organizationId: auth.organizationId,
        $or: [
          { senderId: auth.userId, recipientId: peer.id },
          { senderId: peer.id, recipientId: auth.userId },
        ],
      }
      const read = await db.ChatRead.findOne({ userId: auth.userId, peerId: peer.id }).lean()
      const readAt = read?.readAt ?? new Date(0)
      const [lastMsg, incomingMsg, unread] = await Promise.all([
        db.ChatMessage.findOne(pair).sort({ createdAt: -1 }).lean(),
        db.ChatMessage.findOne({
          organizationId: auth.organizationId,
          senderId: peer.id,
          recipientId: auth.userId,
        })
          .sort({ createdAt: -1 })
          .lean(),
        db.ChatMessage.countDocuments({
          organizationId: auth.organizationId,
          senderId: peer.id,
          recipientId: auth.userId,
          createdAt: { $gt: readAt },
        }),
      ])
      return {
        id: peer.id,
        name: peer.name,
        email: peer.email,
        lastBody: lastMsg?.body ?? null,
        lastAt: lastMsg?.createdAt ? new Date(lastMsg.createdAt).toISOString() : null,
        incomingBody: incomingMsg?.body ?? null,
        incomingAt: incomingMsg?.createdAt ? new Date(incomingMsg.createdAt).toISOString() : null,
        unread,
      }
    }),
  )

  return rows
    .sort((a, b) => {
      if (a.unread !== b.unread) return b.unread - a.unread
      if (a.lastAt !== b.lastAt) return (b.lastAt ?? '').localeCompare(a.lastAt ?? '')
      return a.name.localeCompare(b.name)
    })
}

export async function listChatMessages(
  db: Db,
  auth: AuthContext,
  peerId: string,
): Promise<ChatLine[]> {
  await assertPeer(db, auth, peerId)
  const rows = await db.ChatMessage.find({
    organizationId: auth.organizationId,
    $or: [
      { senderId: auth.userId, recipientId: peerId },
      { senderId: peerId, recipientId: auth.userId },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(80)
    .lean()
  return rows.reverse().map((row) => toLine(withId(row)!))
}

export async function sendChatMessage(
  db: Db,
  auth: AuthContext,
  input: { recipientId: string; body: string },
): Promise<ChatLine> {
  const body = input.body.trim()
  if (!body || body.length > 2000) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Write a message up to 2000 characters.')
  }
  await assertPeer(db, auth, input.recipientId)
  const created = await db.ChatMessage.create({
    organizationId: auth.organizationId,
    senderId: auth.userId,
    recipientId: input.recipientId,
    body,
  })
  const line = withId(created.toObject())
  if (!line) throw new ApiError(500, 'INTERNAL', 'The message could not be sent.')
  await markChatRead(db, auth, input.recipientId)
  return toLine(line)
}

export async function markChatRead(db: Db, auth: AuthContext, peerId: string): Promise<void> {
  await assertPeer(db, auth, peerId)
  await db.ChatRead.updateOne(
    { userId: auth.userId, peerId },
    { $set: { readAt: new Date() } },
    { upsert: true },
  )
}

async function assertPeer(db: Db, auth: AuthContext, peerId: string): Promise<void> {
  if (peerId === auth.userId) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Choose someone else to message.')
  }
  const peer = await db.User.findOne({
    _id: peerId,
    organizationId: auth.organizationId,
    disabledAt: null,
  })
    .select('_id')
    .lean()
  if (!peer) throw notFound('That person was not found.')
}

function toLine(row: { id: string; senderId: string; body: string; createdAt: Date }): ChatLine {
  return {
    id: row.id,
    senderId: row.senderId,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}