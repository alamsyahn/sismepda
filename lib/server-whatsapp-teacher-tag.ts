/**
 * Siapa yang SEDANG mengajar kelas-kelas yang belum merekap — query saja.
 *
 * MENGAPA BERKAS TERPISAH
 *
 * `lib/whatsapp-teacher-tag.ts` memuat aturannya dan harus tetap murni supaya
 * dapat diuji tanpa database. Berkas ini hanyalah pembaca: ia menentukan slot
 * yang sedang berlangsung lewat modul Jadwal, lalu mengambil penempatan dan
 * nomor guru dalam DUA query untuk seluruh kelas sekaligus — bukan satu query
 * per kelas.
 *
 * MENTION ADALAH PENGAYAAN.
 *
 * Setiap kegagalan di sini — profil waktu belum ada, revisi jadwal belum ada,
 * database sedang bermasalah — berakhir sebagai peta kosong, sehingga pengingat
 * tetap terkirim dengan daftar kelas lengkap tanpa mention. Pesan yang tidak
 * sampai jauh lebih merugikan daripada pesan tanpa tag guru.
 *
 * SERVER-ONLY: mengimpor `lib/prisma.ts`.
 */
import { prisma } from "@/lib/prisma"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { isScheduleSlotKind, scheduleDayFromSchoolDate } from "@/lib/schedule-constants"
import { currentSlot, type TimeSlot } from "@/lib/schedule-time"
import { schoolMinutesOfDay, todayInSchoolTimeZone } from "@/lib/school-date"
import { teacherTagsFor, type TeacherTagJids } from "@/lib/whatsapp-teacher-tag"

/**
 * JID guru yang sedang mengajar, per `SchoolClass.id`.
 *
 * `classIds` dibatasi pada kelas yang benar-benar akan dicetak: sekolah dengan
 * 27 kelas tidak perlu membaca seluruh jadwal hari itu untuk menyebut tiga
 * kelas yang belum merekap.
 */
export async function readCurrentTeacherTags(
  classIds: readonly string[],
  now = new Date(),
): Promise<Map<string, TeacherTagJids>> {
  if (classIds.length === 0) return new Map()

  try {
    const timeZone = await readSchoolTimeZone()

    // Hari dan menit diproyeksikan ke zona waktu sekolah, bukan ke waktu
    // server: worker dapat berjalan di mesin ber-UTC.
    const day = scheduleDayFromSchoolDate(todayInSchoolTimeZone(now, timeZone))
    if (day === null) return new Map()

    // STRUKTUR WAKTU DIBACA LANGSUNG, BUKAN LEWAT `lib/server-schedule.ts`.
    //
    // Modul itu menarik `lib/api-errors.ts` → `lib/rbac-access.ts` → `@/auth`,
    // dan worker latar tidak punya sesi pengguna — di image produksi `auth.ts`
    // bahkan tidak ikut disalin, sehingga impornya mematikan worker. Hanya
    // HARI INI yang dibaca: struktur hari lain tidak menjawab "sekarang jam ke
    // berapa" pada sekolah yang hari Jumat-nya lebih pendek.
    const profileDay = await prisma.scheduleProfileDay.findFirst({
      where: { day, profile: { active: true } },
      select: {
        slots: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            kind: true,
            name: true,
            startMinute: true,
            endMinute: true,
            ascPeriod: true,
          },
        },
      },
    })

    const slots: readonly TimeSlot[] = (profileDay?.slots ?? []).flatMap((slot) =>
      isScheduleSlotKind(slot.kind) ? [{ ...slot, kind: slot.kind }] : [],
    )
    const current = currentSlot(slots, schoolMinutesOfDay(now, timeZone))
    // Istirahat, kegiatan, dan di luar jam sekolah berhenti SEBELUM query:
    // tidak ada period yang dapat ditanyakan, dan tidak ada guru yang sedang
    // mengajar untuk dipanggil.
    if (current.state !== "lesson") return new Map()

    const revision = await prisma.scheduleRevision.findFirst({
      where: { active: true },
      select: { id: true },
    })
    if (!revision) return new Map()

    const entries = await prisma.scheduleEntry.findMany({
      where: {
        revisionId: revision.id,
        day,
        period: current.period,
        classId: { in: [...classIds] },
      },
      select: { classId: true, teacherId: true, teacher: { select: { phone: true } } },
    })

    return teacherTagsFor({
      current,
      teachers: entries.map((entry) => ({
        classId: entry.classId,
        teacherId: entry.teacherId,
        phone: entry.teacher?.phone ?? null,
      })),
    })
  } catch (error) {
    // Satu baris, bukan stack per kelas: kegagalan di sini tidak menghentikan
    // apa pun, dan log yang membanjir justru menyembunyikan kesalahan nyata.
    console.warn("[whatsapp] gagal membaca guru yang sedang mengajar:", error)
    return new Map()
  }
}
