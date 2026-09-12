import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import {
  PROFILE_CONTACT_MAX,
  PROFILE_DESCRIPTION_MAX,
  PROFILE_LOCATION_MAX,
  PROFILE_NAME_MAX,
  PROFILE_SERVICE_HOURS_MAX,
  normalizeLabel,
} from "@/lib/euks-settings"

const PROFILE_ID = "default"

/** Teks kosong berarti "kosongkan", bukan "biarkan" — disimpan sebagai null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : normalizeLabel(value)))
    .nullable()
    .optional()

const payload = z.object({
  name: optionalText(PROFILE_NAME_MAX),
  location: optionalText(PROFILE_LOCATION_MAX),
  serviceHours: optionalText(PROFILE_SERVICE_HOURS_MAX),
  contact: optionalText(PROFILE_CONTACT_MAX),
  // Deskripsi multi-baris: spasi TIDAK dirapikan agar paragraf tetap utuh.
  description: z
    .string()
    .trim()
    .max(PROFILE_DESCRIPTION_MAX)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
})

export async function PUT(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.profile.update")
    const body = payload.parse(await request.json())

    const before = await prisma.euksProfile.findUnique({ where: { id: PROFILE_ID } })

    const saved = await prisma.$transaction(async (tx) => {
      const profile = await tx.euksProfile.upsert({
        where: { id: PROFILE_ID },
        create: { id: PROFILE_ID, ...body },
        update: body,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_PROFILE_UPDATED",
          entity: "EuksProfile",
          entityId: profile.id,
          summary: "Identitas UKS diperbarui",
          before: before
            ? {
                name: before.name,
                location: before.location,
                description: before.description,
                serviceHours: before.serviceHours,
                contact: before.contact,
              }
            : null,
          after: {
            name: profile.name,
            location: profile.location,
            description: profile.description,
            serviceHours: profile.serviceHours,
            contact: profile.contact,
          },
        },
        tx,
      )
      return profile
    })

    return NextResponse.json({
      name: saved.name,
      location: saved.location,
      description: saved.description,
      serviceHours: saved.serviceHours,
      contact: saved.contact,
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
