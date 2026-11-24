import { sanitizeAuditMetadata } from '@screenvault/shared'
import type { Db } from './db.js'

export async function writeAudit(
  db: Db,
  entry: {
    organizationId: string
    actorUserId?: string | null
    action: string
    resourceType: string
    resourceId?: string | null
    metadata?: Record<string, unknown>
    ipAddress?: string | null
    userAgent?: string | null
  },
): Promise<void> {
  const metadata = sanitizeAuditMetadata(entry.metadata)
  await db.AuditLog.create({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    metadata: metadata ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
  })
}