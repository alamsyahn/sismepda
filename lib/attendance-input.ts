import type { AttendanceStatus } from "@/lib/dashboard-data"
import { formatSchoolTime } from "@/lib/school-date"

export type InputStatus = "belum" | AttendanceStatus

export type RosterStudent = {
  id: string
  no: number
  name: string
  nis: string | null
  nisn: string | null
}

export type ClassOption = {
  id: string
  name: string
  total: number
  submitted: boolean
  submittedAt: string | null
  homeroom: string
}

/**
 * Menyaring daftar siswa berdasarkan nama untuk kotak pencarian Input Absensi.
 *
 * Hasilnya HANYA untuk tampilan. Penyimpanan absensi dan penghitungan status
 * harus tetap memakai daftar penuh, karena menyimpan daftar yang tersaring akan
 * menghapus status siswa yang sedang tersembunyi.
 *
 * Pencocokan mengabaikan huruf besar/kecil dan spasi berlebih di kedua sisi,
 * sehingga nama yang tersalin dari halaman lain (misalnya "Budi  Santoso")
 * tetap ditemukan. Kata kunci dipecah per kata dan semuanya harus muncul,
 * tetapi tidak harus berurutan: "santoso budi" tetap menemukan "Budi Santoso",
 * dan ini juga membuat nama yang diisikan otomatis dari halaman lain tetap
 * cocok meski urutan katanya berbeda.
 */
export function filterRosterByName<T extends { name: string }>(
  roster: readonly T[],
  query: string,
): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...roster]
  return roster.filter((student) => {
    const name = student.name.toLowerCase()
    return terms.every((term) => name.includes(term))
  })
}

// Urutan tampil status pada segmented buttons & ringkasan
export const INPUT_STATUS_ORDER: InputStatus[] = [
  "belum",
  "hadir",
  "sakit",
  "izin",
  "alfa",
  "dispensasi",
]

/**
 * Alasan ketidakhadiran. Di database keempat nilai ini tetap status tersendiri
 * (SAKIT/IZIN/ALFA/DISPENSASI); "Tidak Hadir" hanyalah pengelompokan di UI.
 */
export const ABSENCE_REASONS = ["sakit", "izin", "alfa", "dispensasi"] as const
export type AbsenceReason = (typeof ABSENCE_REASONS)[number]

/** Pilihan status utama pada form: hanya tiga. */
export type PrimaryStatus = "belum" | "hadir" | "tidakHadir"
export const PRIMARY_STATUS_ORDER: PrimaryStatus[] = ["belum", "hadir", "tidakHadir"]

export function isAbsenceReason(status: InputStatus): status is AbsenceReason {
  return (ABSENCE_REASONS as readonly string[]).includes(status)
}

/** Status tersimpan -> pilihan utama yang tampak terpilih di layar. */
export function primaryStatusOf(status: InputStatus): PrimaryStatus {
  if (isAbsenceReason(status)) return "tidakHadir"
  return status === "hadir" ? "hadir" : "belum"
}

// Status yang benar-benar terisi (bukan "belum")
export const FILLED_STATUS_ORDER: Exclude<InputStatus, "belum">[] = [
  "hadir",
  "sakit",
  "izin",
  "alfa",
  "dispensasi",
]

export type StatusConfig = {
  label: string
  token: string
  // gaya tombol saat aktif
  active: string
  // gaya badge ringkasan
  badge: string
}

export const inputStatusConfig: Record<InputStatus, StatusConfig> = {
  belum: {
    label: "Belum Diisi",
    token: "var(--muted-foreground)",
    active: "border-muted-foreground/30 bg-muted text-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  hadir: {
    label: "Hadir",
    token: "var(--chart-1)",
    active: "border-[var(--chart-1)]/35 bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
    badge: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
  },
  sakit: {
    label: "Sakit",
    token: "var(--status-sakit, var(--chart-4))",
    active: "border-[var(--status-sakit,var(--chart-4))]/40 bg-[var(--status-sakit,var(--chart-4))]/15 text-[var(--status-sakit,var(--chart-4))]",
    badge: "bg-[var(--status-sakit,var(--chart-4))]/15 text-[var(--status-sakit,var(--chart-4))]",
  },
  izin: {
    label: "Izin",
    token: "var(--status-izin, var(--chart-2))",
    active: "border-[var(--status-izin,var(--chart-2))]/35 bg-[var(--status-izin,var(--chart-2))]/12 text-[var(--status-izin,var(--chart-2))]",
    badge: "bg-[var(--status-izin,var(--chart-2))]/12 text-[var(--status-izin,var(--chart-2))]",
  },
  alfa: {
    label: "Alfa",
    token: "var(--status-alfa, var(--chart-5))",
    active: "border-[var(--status-alfa,var(--chart-5))]/35 bg-[var(--status-alfa,var(--chart-5))]/12 text-[var(--status-alfa,var(--chart-5))]",
    badge: "bg-[var(--status-alfa,var(--chart-5))]/12 text-[var(--status-alfa,var(--chart-5))]",
  },
  dispensasi: {
    label: "Dispensasi",
    token: "var(--status-dispensasi, var(--chart-6))",
    active: "border-[var(--status-dispensasi,var(--chart-6))]/35 bg-[var(--status-dispensasi,var(--chart-6))]/15 text-[var(--status-dispensasi,var(--chart-6))]",
    badge: "bg-[var(--status-dispensasi,var(--chart-6))]/15 text-[var(--status-dispensasi,var(--chart-6))]",
  },
}

export const primaryStatusConfig: Record<PrimaryStatus, StatusConfig> = {
  belum: inputStatusConfig.belum,
  hadir: inputStatusConfig.hadir,
  tidakHadir: {
    label: "Tidak Hadir",
    token: "var(--chart-4)",
    active: "border-[var(--chart-4)]/40 bg-[var(--chart-4)]/12 text-foreground",
    badge: "bg-[var(--chart-4)]/12 text-foreground",
  },
}

/**
 * Teks kontekstual field keterangan. Label, placeholder, dan pesan error
 * mengikuti alasan yang dipilih supaya pengguna tahu persis apa yang diminta.
 */
export const absenceNoteCopy: Record<
  AbsenceReason,
  { label: string; placeholder: string; error: string }
> = {
  sakit: {
    label: "Keterangan sakit",
    placeholder: "Contoh: Demam",
    error: "Masukkan keterangan sakit",
  },
  izin: {
    label: "Keterangan izin",
    placeholder: "Contoh: Acara Keluarga",
    error: "Masukkan keterangan izin",
  },
  alfa: {
    label: "Keterangan alfa",
    placeholder: "Contoh: Tidak ada surat",
    error: "Masukkan keterangan alfa",
  },
  dispensasi: {
    label: "Keterangan dispensasi",
    placeholder: "Contoh: Mengikuti kompetisi sepakbola",
    error: "Masukkan keterangan dispensasi",
  },
}

/** Keterangan hanya wajib ketika siswa tidak hadir dengan alasan tertentu. */
export function requiresNote(status: InputStatus): boolean {
  return isAbsenceReason(status)
}

export function isNoteMissing(status: InputStatus, note: string | undefined): boolean {
  return requiresNote(status) && (note ?? "").trim() === ""
}

/**
 * Keterangan hanya boleh "selesai secara lokal" jika benar-benar berisi.
 * Ini murni status tampilan: data tetap belum tersimpan ke database, sehingga
 * UI tidak boleh memakai kata "Tersimpan".
 */
export function canFinalizeNote(note: string | undefined): boolean {
  return (note ?? "").trim() !== ""
}

/**
 * Keterangan lama tidak boleh terbawa ketika alasan ketidakhadiran berganti:
 * "Acara Keluarga" tidak masuk akal setelah izin diubah menjadi sakit.
 * Mengembalikan keterangan yang seharusnya berlaku setelah perpindahan.
 */
export function noteAfterStatusChange(
  previous: InputStatus,
  next: InputStatus,
  note: string | undefined,
): string {
  if (previous === next) return note ?? ""
  return ""
}

/**
 * Siswa yang menghalangi penyimpanan: tidak hadir dengan alasan terpilih tetapi
 * keterangannya masih kosong. Urutannya mengikuti roster penuh supaya tombol
 * Simpan bisa langsung melompat ke siswa bermasalah pertama.
 */
export function studentsMissingNote<T extends { id: string }>(
  roster: readonly T[],
  statuses: Record<string, InputStatus>,
  notes: Record<string, string>,
): T[] {
  return roster.filter((student) => isNoteMissing(statuses[student.id] ?? "belum", notes[student.id]))
}

// Format "07:24" -> "07.24" (konvensi jam Indonesia)
export function formatJam(time: string, timeZone: string): string {
  const parsed = new Date(time)
  if (!Number.isNaN(parsed.getTime())) return formatSchoolTime(parsed, timeZone)
  return time.replace(".", ":")
}

export function currentJam(timeZone: string, now = new Date()): string {
  return formatSchoolTime(now, timeZone).replace(":", ".")
}
