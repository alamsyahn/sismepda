import "server-only"

import { prisma } from "@/lib/prisma"
import { resolveSchoolTimeZone } from "@/lib/school-time-zone"

export async function readSchoolTimeZone(): Promise<string> {
  try {
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { timeZone: true },
    })
    return resolveSchoolTimeZone(setting?.timeZone)
  } catch (error) {
    console.error("Gagal memuat zona waktu sekolah", error)
    return resolveSchoolTimeZone(undefined)
  }
}
