/**
 * Tag guru yang SEDANG mengajar sebuah kelas — logika MURNI.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Pengingat "Belum Semua Rekap" menjadi jauh lebih berguna bila baris kelas
 * ikut menyebut guru yang saat itu berada di kelas tersebut: dialah satu-satunya
 * orang yang dapat langsung menindaklanjuti. Yang menentukan siapa guru itu
 * adalah JADWAL, bukan wali kelas dan bukan tebakan.
 *
 * YANG SENGAJA TIDAK DILAKUKAN
 *
 * Tidak ada pencarian ke jam sebelum atau sesudah, dan tidak ada jatuh-balik ke
 * wali kelas. Di luar jam pelajaran memang TIDAK ADA guru yang sedang mengajar;
 * menyebut nama siapa pun di situ berarti memanggil orang yang tidak sedang
 * bertanggung jawab atas kelas itu.
 *
 * MURNI dan CLIENT-SAFE: tanpa Prisma, tanpa jaringan, tanpa jam sistem. Slot
 * yang sedang berlangsung diterima sebagai argumen, sehingga seluruh aturan di
 * sini dapat diuji tanpa database maupun waktu nyata.
 */
import { normalizeIndonesianPhone, personalJidFor } from "@/lib/phone-number"
import type { CurrentSlotResult } from "@/lib/schedule-time"

/** Nama variabel item yang dilihat admin di editor. Ditulis SEKALI di sini. */
export const TEACHER_TAG_PLACEHOLDER = "tag_guru_pengajar"

/**
 * JID guru yang sedang mengajar satu kelas.
 *
 * HANYA JID, bukan teksnya. Teks mention disusun renderer template dari JID ini
 * lewat `mentionText()`, sehingga bentuk `@628…` yang tercetak dan JID yang
 * ikut sebagai metadata tidak mungkin berbeda.
 */
export type TeacherTagJids = readonly string[]

/** Satu penempatan pada slot berjalan, sebagaimana dibaca dari modul Jadwal. */
export type TeachingSlotTeacher = {
  readonly classId: string
  readonly teacherId: string | null
  readonly phone: string | null
}

/**
 * Tag per kelas untuk slot yang SEDANG berlangsung.
 *
 * Mengembalikan peta kosong bila slot berjalan bukan pelajaran — istirahat,
 * kegiatan, atau di luar jam sekolah. Kelas yang tidak punya penempatan pada
 * slot itu, atau gurunya tanpa nomor yang dapat dinormalisasi, tidak muncul di
 * peta; pemanggil memperlakukan ketiadaan itu sebagai tag kosong, bukan sebagai
 * kegagalan.
 */
export function teacherTagsFor(input: {
  readonly current: CurrentSlotResult
  readonly teachers: readonly TeachingSlotTeacher[]
}): Map<string, TeacherTagJids> {
  const tags = new Map<string, TeacherTagJids>()
  if (input.current.state !== "lesson") return tags

  for (const row of input.teachers) {
    // Slot terisi tanpa guru yang dapat dipetakan bukan "guru anonim": tidak
    // ada seorang pun yang dapat dipanggil.
    if (!row.teacherId) continue
    const phone = normalizeIndonesianPhone(row.phone)
    if (!phone.valid) continue

    const jid = personalJidFor(phone.whatsapp)
    const existing = tags.get(row.classId) ?? []
    // Satu kelas dapat memiliki lebih dari satu penempatan pada slot yang sama
    // (kelas gabungan / team teaching); JID yang sama tidak diulang.
    if (existing.includes(jid)) continue
    tags.set(row.classId, [...existing, jid])
  }

  return tags
}

/** Bentuk mention di dalam teks WhatsApp: `@` diikuti deret digit, tanpa `+`. */
export function mentionText(jid: string): string {
  return `@${jid.split("@")[0]}`
}
