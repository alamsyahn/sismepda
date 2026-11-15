import { NextResponse } from "next/server"
import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { DEFAULT_PHOTO_FRAMING, photoFramingSchema } from "@/lib/euks-photo-framing"
import { prisma } from "@/lib/prisma"
import { verifySameOrigin } from "@/lib/same-origin"

const settings = {
  officer: { permission: "euks.officers.update", entity: "EuksOfficer", action: "EUKS_OFFICER_PHOTO_UPDATED" },
  facility: { permission: "euks.facilities.update", entity: "EuksFacility", action: "EUKS_FACILITY_PHOTO_UPDATED" },
  hero: { permission: "euks.hero_images.update", entity: "EuksHeroImage", action: "EUKS_HERO_IMAGE_PHOTO_UPDATED" },
} as const

export function photoFramingFromForm(form: FormData) {
  const raw = form.get("framing")
  if (raw === null) return DEFAULT_PHOTO_FRAMING
  if (typeof raw !== "string" || raw.length > 250) throw new ApiError(400, "Pengaturan foto tidak valid.")
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new ApiError(400, "Pengaturan foto tidak valid.") }
  return photoFramingSchema.parse(value)
}

const edit = z.strictObject({ framing: photoFramingSchema, version: z.iso.datetime() })

export async function saveEuksPhotoFraming(request: Request, kind: keyof typeof settings, id: string) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) throw new ApiError(origin.status, origin.error)
    const config = settings[kind]
    const viewer = await requireEuksPermission(config.permission)
    const { framing, version } = edit.parse(await request.json().catch(() => null))
    await prisma.$transaction(async tx => {
      const args = { where: { id, photoUpdatedAt: new Date(version) }, data: { photoFraming: framing } }
      const updated = kind === "officer" ? await tx.euksOfficer.updateMany(args)
        : kind === "facility" ? await tx.euksFacility.updateMany(args)
        : await tx.euksHeroImage.updateMany(args)
      if (!updated.count) throw new ApiError(409, "Foto sudah berubah. Muat ulang sebelum mengatur tampilannya.")
      await recordAuditLog({
        actorId: viewer.id, action: config.action, entity: config.entity, entityId: id,
        summary: "Bingkai foto E-UKS diperbarui.", after: { framing },
      }, tx)
    })
    return NextResponse.json({ framing })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
