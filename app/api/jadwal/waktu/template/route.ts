import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import {
  createTemplateFromDay,
  createTimeTemplate,
  deleteTimeTemplate,
  duplicateTimeTemplate,
  listTimeTemplates,
  updateTimeTemplate,
} from "@/lib/server-schedule"
import { MAX_ASC_PERIOD } from "@/lib/schedule-time"
import { SCHEDULE_SLOT_KINDS } from "@/lib/schedule-constants"

/**
 * Template waktu: struktur satu hari yang disimpan untuk dipakai ulang.
 *
 * Template adalah SUMBER SALINAN, bukan referensi hidup. Tidak ada kolom yang
 * menautkan sebuah hari ke template asalnya — justru itulah yang membuat
 * menghapus template tidak pernah merusak jadwal hari mana pun.
 */
const slotPayload = z.object({
  position: z.number().int().min(1).max(60),
  kind: z.enum(SCHEDULE_SLOT_KINDS),
  name: z.string().trim().min(1).max(60),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  ascPeriod: z.number().int().min(1).max(MAX_ASC_PERIOD).nullable(),
})

const createPayload = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("slots"),
    name: z.string().trim().min(1).max(80),
    slots: z.array(slotPayload).min(1).max(60),
  }),
  z.object({
    source: z.literal("day"),
    name: z.string().trim().min(1).max(80),
    profileId: z.string().min(1),
    day: z.number().int().min(1).max(7),
  }),
  z.object({ source: z.literal("duplicate"), templateId: z.string().min(1) }),
])

const updatePayload = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  slots: z.array(slotPayload).min(1).max(60),
})

/** Daftar template. Termasuk kewenangan baca modul Jadwal, bukan kewenangan kelola. */
export async function GET() {
  try {
    await requireSchedulePermission("schedule.own.read")
    return NextResponse.json({ templates: await listTimeTemplates() })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat template waktu")
  }
}

/** Membuat template: dari isian bebas, dari sebuah hari, atau duplikat template lain. */
export async function POST(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const body = createPayload.parse(await request.json())

    switch (body.source) {
      case "slots": {
        const template = await createTimeTemplate({
          name: body.name,
          slots: body.slots,
          actorId: viewer.id,
        })
        return NextResponse.json({ template })
      }
      case "day": {
        const template = await createTemplateFromDay({
          profileId: body.profileId,
          day: body.day,
          name: body.name,
          actorId: viewer.id,
        })
        return NextResponse.json({ template })
      }
      case "duplicate": {
        const template = await duplicateTimeTemplate({
          templateId: body.templateId,
          actorId: viewer.id,
        })
        return NextResponse.json({ template })
      }
    }
  } catch (error) {
    return authFailureResponse(error, "Template waktu tidak valid")
  }
}

/** Mengubah nama/isi template. Tidak menyentuh hari mana pun yang pernah memakainya. */
export async function PUT(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const body = updatePayload.parse(await request.json())
    const template = await updateTimeTemplate({
      templateId: body.templateId,
      name: body.name,
      slots: body.slots,
      actorId: viewer.id,
    })
    return NextResponse.json({ template })
  } catch (error) {
    return authFailureResponse(error, "Template waktu tidak valid")
  }
}

/** Menghapus template. Konfigurasi hari yang dibuat darinya tetap utuh. */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const templateId = new URL(request.url).searchParams.get("templateId")
    if (!templateId) return NextResponse.json({ error: "Template belum dipilih" }, { status: 400 })

    await deleteTimeTemplate({ templateId, actorId: viewer.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Gagal menghapus template waktu")
  }
}
