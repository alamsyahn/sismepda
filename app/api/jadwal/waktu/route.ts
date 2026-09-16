import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { ensureActiveTimeProfile, replaceTimeSlots, readNowContext } from "@/lib/server-schedule"
import { MAX_ASC_PERIOD } from "@/lib/schedule-time"
import { SCHEDULE_SLOT_KINDS } from "@/lib/schedule-constants"

/**
 * Tab "Waktu & Kegiatan": struktur waktu harian sekolah.
 *
 * Inilah sumber kebenaran jam mulai/selesai. `starttime`/`endtime` di berkas
 * aSc tidak pernah menimpanya — XML hanya menyumbang NOMOR period.
 */
const slotPayload = z.object({
  position: z.number().int().min(1).max(60),
  kind: z.enum(SCHEDULE_SLOT_KINDS),
  name: z.string().trim().min(1).max(60),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  ascPeriod: z.number().int().min(1).max(MAX_ASC_PERIOD).nullable(),
})

const replacePayload = z.object({
  profileId: z.string().min(1),
  // Struktur kosong ditolak: modul tanpa satu pun slot tidak dapat
  // menerjemahkan nomor jam menjadi pukul, dan seluruh tampilan jadwal menjadi
  // kosong tanpa penjelasan.
  slots: z.array(slotPayload).min(1).max(60),
})

/** Struktur waktu aktif. Dibaca siapa pun yang boleh membuka modul Jadwal. */
export async function GET() {
  try {
    await requireSchedulePermission("schedule.own.read")
    const profile = await ensureActiveTimeProfile()
    const now = await readNowContext(profile.slots)
    return NextResponse.json({ profile, now })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat struktur waktu")
  }
}

/** Mengganti seluruh struktur satu profil dalam satu transaksi. */
export async function PUT(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.time.manage")
    const body = replacePayload.parse(await request.json())
    const profile = await replaceTimeSlots({
      profileId: body.profileId,
      slots: body.slots,
      actorId: viewer.id,
    })
    return NextResponse.json({ profile })
  } catch (error) {
    return authFailureResponse(error, "Struktur waktu tidak valid")
  }
}
