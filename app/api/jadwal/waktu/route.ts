import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import {
  addProfileDay,
  applyTemplateToDay,
  copyDayStructure,
  ensureActiveTimeProfile,
  listTimeTemplates,
  readNowContext,
  removeProfileDay,
  replaceDaySlots,
} from "@/lib/server-schedule"
import { MAX_ASC_PERIOD } from "@/lib/schedule-time"
import { SCHEDULE_SLOT_KINDS } from "@/lib/schedule-constants"

/**
 * Tab "Waktu & Kegiatan": struktur waktu sekolah, PER HARI.
 *
 * Inilah sumber kebenaran jam mulai/selesai. `starttime`/`endtime` di berkas
 * aSc tidak pernah menimpanya — XML hanya menyumbang NOMOR period, dan jam
 * dindingnya ditentukan profil + hari + nomor itu.
 */
const slotPayload = z.object({
  position: z.number().int().min(1).max(60),
  kind: z.enum(SCHEDULE_SLOT_KINDS),
  name: z.string().trim().min(1).max(60),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  ascPeriod: z.number().int().min(1).max(MAX_ASC_PERIOD).nullable(),
})

/** 1 = Senin .. 7 = Minggu. Angka, bukan label: label boleh berubah. */
const dayPayload = z.number().int().min(1).max(7)

const replacePayload = z.object({
  profileId: z.string().min(1),
  day: dayPayload,
  // Struktur kosong ditolak: hari tanpa satu pun slot tidak dapat
  // menerjemahkan nomor jam menjadi pukul, dan tampilan jadwal hari itu
  // menjadi kosong tanpa penjelasan. Hari yang memang libur dihapus dari
  // profil, bukan disimpan sebagai daftar kosong.
  slots: z.array(slotPayload).min(1).max(60),
})

const mutationPayload = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addDay"), profileId: z.string().min(1), day: dayPayload }),
  z.object({ action: z.literal("removeDay"), profileId: z.string().min(1), day: dayPayload }),
  z.object({
    action: z.literal("copyDay"),
    profileId: z.string().min(1),
    fromDay: dayPayload,
    toDay: dayPayload,
  }),
  z.object({
    action: z.literal("applyTemplate"),
    profileId: z.string().min(1),
    day: dayPayload,
    templateId: z.string().min(1),
  }),
])

/** Struktur waktu aktif + daftar template. Dibaca siapa pun yang boleh membuka modul Jadwal. */
export async function GET() {
  try {
    await requireSchedulePermission("schedule.own.read")
    const profile = await ensureActiveTimeProfile()
    const [now, templates] = await Promise.all([readNowContext(profile), listTimeTemplates()])
    return NextResponse.json({ profile, templates, now })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat struktur waktu")
  }
}

/** Mengganti seluruh struktur SATU HARI dalam satu transaksi. */
export async function PUT(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const body = replacePayload.parse(await request.json())
    const profile = await replaceDaySlots({
      profileId: body.profileId,
      day: body.day,
      slots: body.slots,
      actorId: viewer.id,
    })
    return NextResponse.json({ profile })
  } catch (error) {
    return authFailureResponse(error, "Struktur waktu tidak valid")
  }
}

/**
 * Operasi hari: tambah, hapus, salin dari hari lain, terapkan template.
 *
 * Semuanya menulis SALINAN. Tidak ada satu pun yang menautkan hari ke template
 * atau ke hari sumber, sehingga perubahan berikutnya di sumber tidak pernah
 * merembet ke hari yang sudah jadi.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const body = mutationPayload.parse(await request.json())

    switch (body.action) {
      case "addDay": {
        const profile = await addProfileDay({
          profileId: body.profileId,
          day: body.day,
          actorId: viewer.id,
        })
        return NextResponse.json({ profile })
      }
      case "removeDay": {
        const profile = await removeProfileDay({
          profileId: body.profileId,
          day: body.day,
          actorId: viewer.id,
        })
        return NextResponse.json({ profile })
      }
      case "copyDay": {
        const profile = await copyDayStructure({
          profileId: body.profileId,
          fromDay: body.fromDay,
          toDay: body.toDay,
          actorId: viewer.id,
        })
        return NextResponse.json({ profile })
      }
      case "applyTemplate": {
        const profile = await applyTemplateToDay({
          profileId: body.profileId,
          day: body.day,
          templateId: body.templateId,
          actorId: viewer.id,
        })
        return NextResponse.json({ profile })
      }
    }
  } catch (error) {
    return authFailureResponse(error, "Operasi struktur waktu gagal")
  }
}
