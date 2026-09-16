import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import {
  ensureActiveTimeProfile,
  readActiveEntries,
  readNowContext,
  isScheduleTeacher,
} from "@/lib/server-schedule"
import { isScheduleDay } from "@/lib/schedule-constants"

/**
 * Jadwal mingguan satu guru.
 *
 * Tanpa `teacherId`, yang dikembalikan adalah jadwal pemanggil sendiri — inilah
 * yang membuat tab "Jadwal Saya" langsung terisi tanpa memilih nama lebih dulu.
 * Meminta jadwal guru LAIN adalah kewenangan terpisah (`schedule.teachers.read`),
 * sehingga guru biasa tidak dapat menebak id orang lain lewat query string.
 */
export async function GET(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.own.read")
    const url = new URL(request.url)
    const requested = url.searchParams.get("teacherId")

    const teacherId = requested ?? viewer.id
    if (teacherId !== viewer.id && !viewer.capabilities.teacherRead) {
      return NextResponse.json({ error: "Tidak diizinkan melihat jadwal guru lain" }, { status: 403 })
    }

    // Pemakai non-guru yang berwenang boleh menanyakan guru mana pun, tetapi
    // tidak boleh menanyakan dirinya sendiri dan memperoleh hasil seolah-olah
    // ia guru: id yang bukan populasi guru selalu ditolak eksplisit.
    if (!(await isScheduleTeacher(teacherId))) {
      return NextResponse.json(
        {
          error:
            teacherId === viewer.id
              ? "Akun Anda belum terhubung dengan Data Master Guru"
              : "Guru tidak ditemukan",
          code: teacherId === viewer.id ? "NO_TEACHER_PROFILE" : "TEACHER_NOT_FOUND",
        },
        { status: 404 },
      )
    }

    const dayParam = url.searchParams.get("day")
    const day = dayParam === null ? undefined : Number(dayParam)
    if (day !== undefined && !isScheduleDay(day)) {
      return NextResponse.json({ error: "Hari tidak valid" }, { status: 400 })
    }

    const profile = await ensureActiveTimeProfile()
    const [entries, now] = await Promise.all([
      readActiveEntries({ teacherId, ...(day === undefined ? {} : { day }) }),
      readNowContext(profile.slots),
    ])

    return NextResponse.json({ teacherId, slots: profile.slots, entries, now })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat jadwal guru")
  }
}
