import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import type { RbacAuditAction, RbacAuditEntity } from "@/lib/rbac-audit"

/** Entities tracked in the audit trail. Extend as other features adopt it. */
export type AuditEntity =
  | "TeacherWorkbook"
  | "TeacherWorkbookItemStatus"
  | "User"
  | "BosSetting"
  | "BosCategory"
  | "BosEntry"
  | "SarprasLocation"
  | "SarprasItemType"
  | "SarprasItem"
  | "EuksVisit"
  | "StudentHealthMeasurement"
  | "Attendance"
  | "EuksProfile"
  | "EuksOfficer"
  | "EuksFacility"
  | "EuksHeroImage"
  | "EuksHeroLogo"
  | "EuksComplaintOption"
  /// Konfigurasi kebijakan unggah (batas global + override per slot). Satu
  /// baris logis, jadi entityId selalu "default".
  | "UploadPolicy"
  /// Koneksi WhatsApp sekolah. Satu koneksi untuk seluruh sekolah, jadi
  /// entityId selalu "default".
  | "WhatsAppConnection"
  /// Satu baris WhatsAppSendLog — kiriman manual yang dipicu seorang pengguna.
  | "WhatsAppSendLog"
  /// Entitas RBAC. Didefinisikan di lib/rbac-audit.ts agar UI dapat mengenali
  /// baris RBAC tanpa ikut menarik lib/prisma.ts ke bundel klien.
  | RbacAuditEntity

export type AuditAction =
  | "WORKBOOK_LINK_UPDATED"
  | "WORKBOOK_ITEM_STATUS_CHANGED"
  | "WORKBOOK_SUPERVISION_SCOPE_CHANGED"
  | "BOS_BUDGET_UPDATED"
  | "BOS_ENTRY_CREATED"
  | "BOS_ENTRY_UPDATED"
  | "BOS_CATEGORY_CREATED"
  | "BOS_CATEGORY_UPDATED"
  | "BOS_ACCESS_CHANGED"
  | "SARPRAS_LOCATION_CREATED"
  | "SARPRAS_LOCATION_UPDATED"
  | "SARPRAS_LOCATION_DELETED"
  | "SARPRAS_ITEM_TYPE_CREATED"
  | "SARPRAS_ITEM_TYPE_UPDATED"
  | "SARPRAS_ITEM_TYPE_DELETED"
  | "SARPRAS_ITEM_CREATED"
  | "SARPRAS_ITEM_UPDATED"
  | "SARPRAS_ITEM_DELETED"
  | "SARPRAS_ACCESS_CHANGED"
  | "EUKS_VISIT_CREATED"
  | "EUKS_VISIT_UPDATED"
  | "EUKS_VISIT_DELETED"
  | "EUKS_MEASUREMENT_CREATED"
  | "EUKS_MEASUREMENT_DELETED"
  | "EUKS_PROFILE_UPDATED"
  | "EUKS_OFFICER_CREATED"
  | "EUKS_OFFICER_UPDATED"
  | "EUKS_OFFICER_DELETED"
  | "EUKS_OFFICER_PHOTO_UPDATED"
  | "EUKS_FACILITY_CREATED"
  | "EUKS_FACILITY_UPDATED"
  | "EUKS_FACILITY_DELETED"
  | "EUKS_FACILITY_PHOTO_UPDATED"
  | "EUKS_HERO_IMAGE_CREATED"
  | "EUKS_HERO_IMAGE_UPDATED"
  | "EUKS_HERO_IMAGE_DELETED"
  | "EUKS_HERO_IMAGE_PHOTO_UPDATED"
  | "EUKS_HERO_LOGO_CREATED"
  | "EUKS_HERO_LOGO_UPDATED"
  | "EUKS_HERO_LOGO_DELETED"
  | "EUKS_HERO_LOGO_FILE_UPDATED"
  | "EUKS_COMPLAINT_OPTION_CREATED"
  | "EUKS_COMPLAINT_OPTION_UPDATED"
  | "EUKS_SICK_ABSENCE_UPDATED"
  | "UPLOAD_POLICY_UPDATED"
  | "WHATSAPP_CONNECTION_STARTED"
  | "WHATSAPP_CONNECTION_RECONNECTED"
  | "WHATSAPP_LOGGED_OUT"
  | "WHATSAPP_SCHEDULE_TOGGLED"
  | "WHATSAPP_MESSAGE_SENT_MANUALLY"
  /// Mutasi data master guru dari Data Master > Guru.
  | "TEACHER_PROFILE_UPDATED"
  | "TEACHER_PHOTO_UPDATED"
  /// Aksi RBAC, disatukan ke trail yang sama agar tidak ada dua sistem audit.
  | RbacAuditAction

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
