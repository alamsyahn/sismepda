import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import {
  ensureActiveTimeProfile,
  listScheduleTeachers,
  readActiveEntries,
  readNowContext,
} from "@/lib/server-schedule"
import { isScheduleDay } from "@/lib/schedule-constants"
import { slotByPeriod } from "@/lib/schedule-time"

/**
 * Guru yang TIDAK memiliki jadwal mengajar pada satu hari + jam pelajaran.
 *
 * Disebut "Jam Kosong Guru", bukan "Guru Tersedia": tidak adanya jadwal
 * mengajar tidak berarti guru itu bebas tugas (piket, rapat, dinas luar tidak
 * terekam modul ini). Penamaan ini bagian dari kontrak, bukan sekadar label.
 *
 * Basisnya adalah populasi guru SISMEPDA (role key `guru` + Data Master Guru +
 * akun aktif), bukan daftar `<teacher>` di berkas aSc.
 */
export async function GET(request: Request) {
  try {
    await requireSchedulePermission("schedule.free_teachers.read")

    const url = new URL(request.url)
    const day = Number(url.searchParams.get("day"))
    if (!isScheduleDay(day)) return NextResponse.json({ error: "Hari tidak valid" }, { status: 400 })

    const period = Number(url.searchParams.get("period"))
    const profile = await ensureActiveTimeProfile()
    const slots = slotByPeriod(profile.slots)

    // Nomor jam yang tidak ada pada struktur waktu ditolak, bukan dihitung
    // sebagai "semua guru kosong" — itu jawaban yang terlihat masuk akal
    // padahal pertanyaannya tidak sah.
    const slot = slots.get(period)
    if (!slot) {
      return NextResponse.json(
        { error: "Jam pelajaran tidak ditemukan pada struktur waktu aktif" },
        { status: 400 },
      )
    }

    const [teachers, entries, now] = await Promise.all([
      listScheduleTeachers(),
      readActiveEntries({ day }),
      readNowContext(profile.slots),
    ])

    const busy = new Map<string, { className: string; subjectName: string }>()
    for (const entry of entries) {
      if (entry.period !== period || !entry.teacherId) continue
      busy.set(entry.teacherId, { className: entry.className, subjectName: entry.subjectName })
    }

    const free = teachers.filter((teacher) => !busy.has(teacher.id))
    const teaching = teachers
      .filter((teacher) => busy.has(teacher.id))
      .map((teacher) => ({ ...teacher, ...busy.get(teacher.id)! }))

    return NextResponse.json({
      day,
      period,
      slot,
      free,
      teaching,
      totalTeachers: teachers.length,
      now,
    })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat jam kosong guru")
  }
}
