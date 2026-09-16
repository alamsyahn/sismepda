/**
 * Query data laporan WhatsApp — DATA SAJA, tanpa otorisasi.
 *
 * MENGAPA TIDAK ADA `requirePermission()` DI SINI
 *
 * Modul ini dipakai dua pemanggil dengan sifat berbeda:
 *
 *   web request  → guard permission → readWhatsAppReportClasses()
 *   worker latar → readWhatsAppReportClasses()
 *
 * Worker WhatsApp adalah proses Node biasa tanpa request, tanpa cookie, dan
 * tanpa sesi pengguna. Menaruh `requirePermission()` di dalam fungsi query
 * memaksa jalur worker mengimpor `@/auth` (Auth.js), yang membaca cookie
 * permintaan yang tidak pernah ada — dan di image produksi berkas `auth.ts`
 * memang tidak ikut disalin, sehingga worker mati dengan MODULE_NOT_FOUND.
 *
 * Pemisahan ini BUKAN pelemahan otorisasi. Surface yang dapat dijangkau
 * pengguna tetap wajib melewati `getWhatsAppReportClasses()` di
 * `lib/whatsapp-access.ts`, yang menuntut `reports.whatsapp.read.all`. Yang
 * memakai fungsi ini secara langsung hanyalah eksekusi latar tepercaya yang
 * hanya bisa dijalankan dari deployment internal, bukan oleh pengguna.
 *
 * SERVER-ONLY: mengimpor `lib/prisma.ts`.
 */
import { sortClasses } from "@/lib/class-order"
import { prisma } from "@/lib/prisma"
import type { WhatsAppReportClass, WhatsAppReportStudent } from "@/lib/whatsapp-report"
import { fromPrismaDate, toPrismaDate } from "@/lib/school-date"

export async function readWhatsAppReportClasses(date: Date): Promise<WhatsAppReportClass[]> {
  const prismaDate = toPrismaDate(fromPrismaDate(date))

  const rows = await prisma.schoolClass.findMany({
    select: {
      id: true,
      name: true,
      grade: true,
      // Nama wali kelas dipakai placeholder `{{wali_kelas}}` pada template
      // pesan. Diambil di sini agar tidak ada query tambahan per kelas.
      homeroomUser: { select: { name: true } },
      students: {
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
      attendanceDays: {
        where: { date: prismaDate },
        take: 1,
        select: {
          attendances: {
            // `note` dipakai placeholder `{{keterangan}}`.
            select: { studentId: true, status: true, note: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  })

  return sortClasses(rows).map((schoolClass) => {
    const day = schoolClass.attendanceDays[0]
    const attendanceByStudent = new Map(
      day?.attendances.map((attendance) => [attendance.studentId, attendance]) ?? [],
    )
    const students: WhatsAppReportStudent[] = schoolClass.students.flatMap((student) => {
      const attendance = attendanceByStudent.get(student.id)
      if (attendance?.status === "HADIR") return []
      return [
        {
          id: student.id,
          name: student.name,
          status: attendance?.status ?? null,
          note: attendance?.note ?? null,
        },
      ]
    })

    return {
      id: schoolClass.id,
      name: schoolClass.name,
      grade: schoolClass.grade,
      submitted: Boolean(day),
      homeroomName: schoolClass.homeroomUser?.name ?? null,
      studentCount: schoolClass.students.length,
      students,
    }
  })
}
