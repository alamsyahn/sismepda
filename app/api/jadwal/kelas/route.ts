import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { ensureActiveTimeProfile, readActiveEntries, readNowContext } from "@/lib/server-schedule"
import { isScheduleDay } from "@/lib/schedule-constants"
import { findProfileDay } from "@/lib/schedule-time"
import { prisma } from "@/lib/prisma"

/**
 * Susunan satu kelas pada satu hari.
 *
 * `classId` WAJIB dan sengaja tanpa nilai bawaan: memilihkan kelas pertama
 * secara diam-diam akan membuat admin membaca jadwal kelas yang bukan yang
 * dimaksudnya. UI menampilkan empty state sampai kelas dipilih.
 */
export async function GET(request: Request) {
  try {
    await requireSchedulePermission("schedule.classes.read")

    const url = new URL(request.url)
    const classId = url.searchParams.get("classId")
    if (!classId) return NextResponse.json({ error: "Kelas belum dipilih" }, { status: 400 })

    const day = Number(url.searchParams.get("day"))
    if (!isScheduleDay(day)) return NextResponse.json({ error: "Hari tidak valid" }, { status: 400 })

    const schoolClass = await prisma.schoolClass.findUnique({
      where: { id: classId },
      select: { id: true, name: true },
    })
    if (!schoolClass) return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 })

    const profile = await ensureActiveTimeProfile()
    const [entries, now] = await Promise.all([
      readActiveEntries({ classId, day }),
      readNowContext(profile),
    ])

    // Struktur HARI yang diminta, bukan struktur generik profil: jam ke-4 pada
    // Jumat boleh berbeda jamnya dengan Senin.
    const slots = findProfileDay(profile.days, day)?.slots ?? []

    return NextResponse.json({ schoolClass, day, slots, entries, now })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat jadwal kelas")
  }
}
