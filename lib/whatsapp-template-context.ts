/**
 * Menyusun nilai placeholder dari data laporan.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Satu-satunya tempat yang menerjemahkan bentuk data laporan menjadi nama
 * placeholder yang dilihat admin. Dipisahkan dari mesin template
 * (`whatsapp-template.ts`) supaya mesin itu tetap tidak tahu apa-apa tentang
 * absensi, dan dipisahkan dari query supaya seluruh perhitungan di sini bisa
 * diuji tanpa database.
 *
 * MURNI: tanpa Prisma, tanpa jaringan, tanpa jam sistem.
 */
import { incompleteClasses, slotLabel } from "@/lib/whatsapp-messages"
import { reportClassName, type WhatsAppReportClass } from "@/lib/whatsapp-report"
import type { TemplateContext, WhatsAppTemplateKey } from "@/lib/whatsapp-template"

/**
 * Urutan status untuk daftar siswa tidak hadir.
 *
 * Inilah yang mempertahankan PENGELOMPOKAN pesan lama tanpa memerlukan
 * percabangan di dalam template: baris yang berstatus sama selalu berdampingan,
 * dalam urutan yang sama seperti bagian-bagian pesan sebelumnya.
 */
const ABSENCE_ORDER = ["SAKIT", "IZIN", "ALFA", "DISPENSASI"] as const
type AbsenceStatus = (typeof ABSENCE_ORDER)[number]

/** Placeholder kosong ditampilkan sebagai tanda hubung, bukan ruang kosong. */
const EMPTY = "-"

export type AbsentRow = {
  nama_siswa: string
  nama_kelas: string
  status: string
  keterangan: string
}

export type PendingClassRow = {
  nama_kelas: string
  wali_kelas: string
  jumlah_siswa_belum_diisi: string
}

/** Kelas yang belum merekap, dalam urutan tampilan laporan. */
export function pendingClassRows(
  classes: readonly WhatsAppReportClass[],
): PendingClassRow[] {
  return incompleteClasses(classes).map((schoolClass) => {
    const unfilled = new Set(
      schoolClass.students.filter((student) => student.status === null).map((s) => s.id),
    ).size
    return {
      nama_kelas: reportClassName(schoolClass.name),
      wali_kelas: schoolClass.homeroomName?.trim() || EMPTY,
      jumlah_siswa_belum_diisi: String(unfilled),
    }
  })
}

/**
 * Siswa tidak hadir, dikelompokkan menurut `ABSENCE_ORDER`.
 *
 * Deduplikasi per siswa dipertahankan dari implementasi lama: satu baris per
 * siswa, bukan satu baris per baris data.
 */
export function absentStudentRows(classes: readonly WhatsAppReportClass[]): AbsentRow[] {
  const byStatus = new Map<AbsenceStatus, AbsentRow[]>()

  for (const schoolClass of classes) {
    const seen = new Set<string>()
    for (const student of schoolClass.students) {
      if (student.status === null) continue
      if (seen.has(student.id)) continue
      seen.add(student.id)
      const status = student.status as AbsenceStatus
      const rows = byStatus.get(status) ?? []
      rows.push({
        nama_siswa: student.name,
        nama_kelas: reportClassName(schoolClass.name),
        status,
        keterangan: student.note?.trim() || EMPTY,
      })
      byStatus.set(status, rows)
    }
  }

  return ABSENCE_ORDER.flatMap((status) => byStatus.get(status) ?? [])
}

function countByStatus(rows: readonly AbsentRow[], status: AbsenceStatus): number {
  return rows.filter((row) => row.status === status).length
}

/**
 * Menentukan kondisi mana yang berlaku — INI KEPUTUSAN SISTEM, bukan admin.
 *
 * Kondisi sengaja dihitung di satu tempat agar template yang dipilih tidak
 * pernah bertentangan dengan angka yang ikut dikirim di dalamnya.
 */
export function templateKeyFor(
  type: "ATTENDANCE_MISSING" | "ATTENDANCE_ABSENT",
  classes: readonly WhatsAppReportClass[],
): WhatsAppTemplateKey {
  if (type === "ATTENDANCE_MISSING") {
    return incompleteClasses(classes).length > 0 ? "MISSING_PENDING" : "MISSING_COMPLETE"
  }
  return absentStudentRows(classes).length > 0 ? "ABSENT_PRESENT" : "ABSENT_NONE"
}

/** Semua nilai placeholder untuk satu pengiriman. */
export function buildTemplateContext(input: {
  dateLabel: string
  slot: string
  schoolName: string
  classes: readonly WhatsAppReportClass[]
}): TemplateContext {
  const { dateLabel, slot, schoolName, classes } = input
  const pending = pendingClassRows(classes)
  const absent = absentStudentRows(classes)

  // Siswa dihitung dari data yang sama dengan yang dipakai laporan di layar.
  // `students` pada laporan hanya memuat siswa yang BUKAN hadir, sehingga
  // jumlah siswa aktif tidak dapat disimpulkan dari sini; lihat catatan pada
  // `jumlah_siswa` di bawah.
  const totalClasses = classes.length

  return {
    scalars: {
      tanggal: dateLabel,
      waktu: slotLabel(slot),
      nama_sekolah: schoolName,
      jumlah_kelas: String(totalClasses),
      jumlah_kelas_belum_rekap: String(pending.length),
      jumlah_kelas_sudah_rekap: String(totalClasses - pending.length),
      jumlah_siswa: String(
        classes.reduce((sum, schoolClass) => sum + schoolClass.studentCount, 0),
      ),
      jumlah_tidak_hadir: String(absent.length),
      jumlah_sakit: String(countByStatus(absent, "SAKIT")),
      jumlah_izin: String(countByStatus(absent, "IZIN")),
      jumlah_dispensasi: String(countByStatus(absent, "DISPENSASI")),
      jumlah_alfa: String(countByStatus(absent, "ALFA")),
    },
    collections: {
      daftar_kelas_belum_rekap: pending,
      daftar_siswa_tidak_hadir: absent,
    },
  }
}
