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

// Format "07:24" -> "07.24" (konvensi jam Indonesia)
export function formatJam(time: string, timeZone: string): string {
  const parsed = new Date(time)
  if (!Number.isNaN(parsed.getTime())) return formatSchoolTime(parsed, timeZone)
  return time.replace(".", ":")
}

export function currentJam(timeZone: string, now = new Date()): string {
  return formatSchoolTime(now, timeZone).replace(":", ".")
}
