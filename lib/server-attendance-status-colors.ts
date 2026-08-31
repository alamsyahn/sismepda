import "server-only"

import { prisma } from "@/lib/prisma"
import {
  DEFAULT_STATUS_COLORS,
  parseStatusColors,
  type AttendanceStatusColors,
} from "@/lib/attendance-status-colors"

/**
 * Warna status global dibaca sekali di server lalu diinjeksikan sebagai CSS
 * variable, sehingga setiap komponen memakai sumber yang sama tanpa
 * mengambil ulang data dan tanpa kedip warna saat halaman dimuat.
 */
export async function readAttendanceStatusColors(): Promise<AttendanceStatusColors> {
  try {
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { attendanceStatusColors: true },
    })
    return parseStatusColors(setting?.attendanceStatusColors)
  } catch (error) {
    console.error("Gagal memuat warna status absensi", error)
    return DEFAULT_STATUS_COLORS
  }
}
