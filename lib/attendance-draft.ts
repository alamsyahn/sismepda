/**
 * Draft sementara Input Absensi dan posisi kembali dari Profil Siswa.
 *
 * Membuka profil siswa adalah navigasi halaman penuh di App Router, sehingga
 * komponen Input Absensi ter-unmount dan seluruh state form hilang. Isian yang
 * belum ditekan Simpan disimpan sementara di `sessionStorage` supaya tidak
 * terasa hilang saat pengguna kembali.
 *
 * Semua fungsi di sini murni (storage diinjeksikan) agar dapat diuji tanpa DOM.
 * Tidak ada kaitan dengan database: draft hanya hidup di tab browser dan dibuang
 * setelah penyimpanan berhasil.
 */

import type { InputStatus } from "@/lib/attendance-input"

export const ATTENDANCE_DRAFT_KEY = "sismepda:absensi-input:draft"
export const ATTENDANCE_RETURN_KEY = "sismepda:absensi-input:return"

export type AttendanceDraft = {
  classId: string
  date: string
  statuses: Record<string, InputStatus>
  notes: Record<string, string>
  /** Siswa yang dipilih "Tidak Hadir" tetapi alasannya belum ditentukan. */
  absentPending: Record<string, boolean>
}

export type AttendanceReturnPosition = {
  classId: string
  date: string
  studentId: string
}

const VALID_STATUSES: readonly InputStatus[] = [
  "belum",
  "hadir",
  "sakit",
  "izin",
  "alfa",
  "dispensasi",
]

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string")
  )
}

export function serializeDraft(draft: AttendanceDraft): string {
  return JSON.stringify(draft)
}

/**
 * Membaca draft dan menolaknya jika tidak cocok dengan kelas/tanggal yang sedang
 * dibuka. Draft sengaja di-scope: kembali ke kelas atau tanggal lain tidak boleh
 * memunculkan isian milik konteks lain.
 */
export function parseDraft(raw: string | null, classId: string, date: string): AttendanceDraft | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const candidate = parsed as Partial<AttendanceDraft>
  if (candidate.classId !== classId || candidate.date !== date) return null
  if (!classId || !date) return null
  if (!isRecordOfStrings(candidate.statuses)) return null
  if (!isRecordOfStrings(candidate.notes)) return null

  const statuses: Record<string, InputStatus> = {}
  for (const [studentId, status] of Object.entries(candidate.statuses)) {
    if ((VALID_STATUSES as readonly string[]).includes(status)) {
      statuses[studentId] = status as InputStatus
    }
  }
  const absentPending: Record<string, boolean> = {}
  const rawPending = candidate.absentPending
  if (rawPending && typeof rawPending === "object" && !Array.isArray(rawPending)) {
    for (const [studentId, pending] of Object.entries(rawPending)) {
      if (pending === true) absentPending[studentId] = true
    }
  }

  return { classId, date, statuses, notes: { ...candidate.notes }, absentPending }
}

export type RosterState = {
  statuses: Record<string, InputStatus>
  notes: Record<string, string>
  absentPending: Record<string, boolean>
}

/**
 * Menimpa state hasil server dengan draft lokal.
 *
 * Data server tetap menjadi dasar; draft hanya berlaku untuk siswa yang memang
 * ada pada roster saat ini, sehingga draft basi (siswa pindah/dihapus) tidak
 * pernah ikut terkirim. Tanpa draft, state server dikembalikan apa adanya —
 * data server tidak pernah ditimpa secara otomatis di luar draft pengguna.
 */
export function applyDraft(
  server: RosterState,
  draft: AttendanceDraft | null,
  studentIds: readonly string[],
): RosterState {
  if (!draft) return server
  const statuses = { ...server.statuses }
  const notes = { ...server.notes }
  const absentPending: Record<string, boolean> = {}
  for (const studentId of studentIds) {
    if (studentId in draft.statuses) statuses[studentId] = draft.statuses[studentId]
    if (studentId in draft.notes) notes[studentId] = draft.notes[studentId]
    if (draft.absentPending[studentId]) absentPending[studentId] = true
  }
  return { statuses, notes, absentPending }
}

/** Draft hanya berbeda dari server jika ada nilai yang benar-benar berubah. */
export function draftDiffersFromServer(server: RosterState, restored: RosterState): boolean {
  const keys = new Set([
    ...Object.keys(server.statuses),
    ...Object.keys(restored.statuses),
    ...Object.keys(server.notes),
    ...Object.keys(restored.notes),
  ])
  for (const key of keys) {
    if ((server.statuses[key] ?? "belum") !== (restored.statuses[key] ?? "belum")) return true
    if ((server.notes[key] ?? "") !== (restored.notes[key] ?? "")) return true
  }
  return Object.keys(restored.absentPending).length > 0
}

export function serializeReturnPosition(position: AttendanceReturnPosition): string {
  return JSON.stringify(position)
}

/**
 * Posisi kembali hanya berlaku sekali dan hanya untuk kelas/tanggal yang sama,
 * supaya scroll otomatis tidak terjadi pada konteks yang tidak diminta.
 */
export function parseReturnPosition(
  raw: string | null,
  classId: string,
  date: string,
): AttendanceReturnPosition | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const candidate = parsed as Partial<AttendanceReturnPosition>
  if (typeof candidate.studentId !== "string" || candidate.studentId === "") return null
  if (candidate.classId !== classId || candidate.date !== date) return null
  return { classId, date, studentId: candidate.studentId }
}

/** Id elemen baris siswa; dipakai untuk scroll kembali ke siswa yang diklik. */
export function studentRowId(studentId: string, variant: "desktop" | "mobile"): string {
  return variant === "desktop" ? `student-${studentId}` : `student-mobile-${studentId}`
}

/** URL Input Absensi dengan konteks kelas/tanggal yang sedang dibuka. */
export function attendanceInputHref(classId: string, date: string): string {
  const params = new URLSearchParams()
  if (classId) params.set("classId", classId)
  if (date) params.set("date", date)
  const query = params.toString()
  return query ? `/absensi/input?${query}` : "/absensi/input"
}
