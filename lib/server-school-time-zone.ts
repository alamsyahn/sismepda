// TANPA `server-only`: modul ini kini juga dipakai worker WhatsApp, yang
// berjalan sebagai proses tsx biasa di luar bundler Next. `server-only` adalah
// penjaga khusus bundler dan akan mematikan proses itu saat start. Pola yang
// sama sudah dipakai lib/server-media-storage.ts dan lib/server-holidays.ts,
// yang juga dibagi dengan perkakas CLI.
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
