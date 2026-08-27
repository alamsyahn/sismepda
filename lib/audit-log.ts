import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"

/** Entities tracked in the audit trail. Extend as other features adopt it. */
export type AuditEntity = "TeacherWorkbook" | "TeacherWorkbookItemStatus" | "User"

export type AuditAction =
  | "WORKBOOK_LINK_UPDATED"
  | "WORKBOOK_ITEM_STATUS_CHANGED"
  | "WORKBOOK_SUPERVISION_SCOPE_CHANGED"

export type AuditEntry = {
  actorId: string | null
  action: AuditAction
  entity: AuditEntity
  entityId: string
  /** The teacher the change is about, when different from the actor. */
  targetUserId?: string | null
  summary?: string | null
  before?: Prisma.InputJsonValue | null
  after?: Prisma.InputJsonValue | null
}

type AuditClient = Pick<typeof prisma, "auditLog">

/**
 * Append one audit entry. Pass a transaction client to keep the log atomic with
 * the change it describes.
 */
export async function recordAuditLog(entry: AuditEntry, client: AuditClient = prisma) {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      targetUserId: entry.targetUserId ?? null,
      summary: entry.summary ?? null,
      ...(entry.before === undefined || entry.before === null ? {} : { before: entry.before }),
      ...(entry.after === undefined || entry.after === null ? {} : { after: entry.after }),
    },
  })
}

/** Recent audit entries for one teacher, newest first. */
export async function readAuditLogForUser(targetUserId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { targetUserId },
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      summary: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}
