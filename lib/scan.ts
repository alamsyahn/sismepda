import { z } from "zod"

export const SCAN_PAGE_PERMISSIONS = [
  "scan.attendance.use",
  "scan.uks.use",
  "scan.history.read",
  "scan.cards.manage",
] as const
export const scanMode = z.enum(["attendance", "uks"])
export type ScanMode = z.infer<typeof scanMode>
export const scanInput = z
  .object({
    requestId: z.uuid(),
    mode: scanMode,
    source: z.enum(["CAMERA", "USB", "MANUAL"]),
    code: z.string().trim().min(1).max(180).optional(),
    studentId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (x) => (x.source === "MANUAL" ? Boolean(x.studentId) && !x.code : Boolean(x.code) && !x.studentId),
    "Sumber dan identitas scan tidak cocok",
  )
export const followUps = [
  "Kembali ke kelas",
  "Istirahat di UKS",
  "Dijemput orang tua",
  "Dirujuk ke fasilitas kesehatan",
  "Lainnya",
] as const
export const scanVisitInput = z
  .object({
    eventId: z.string().min(1).max(100),
    complaint: z.string().trim().min(2).max(500),
    treatment: z.string().trim().min(2).max(500),
    followUp: z.enum(followUps),
    detail: z.string().trim().max(300).default(""),
    notify: z.boolean(),
  })
  .strict()
  .refine((x) => x.followUp !== "Lainnya" || x.detail.length >= 2, "Rincian tindak lanjut wajib diisi")
export const SCAN_OUTCOMES: Record<string, string> = {
  PRESENT: "Kehadiran tersimpan",
  REPEAT: "Sudah hadir hari ini",
  CONFLICT: "Perlu ditinjau petugas",
  UNKNOWN: "QR tidak dikenali / kartu tidak aktif",
  HOLIDAY: "Hari libur",
  OUTSIDE_WINDOW: "Di luar waktu kehadiran",
  DRAFT: "Lengkapi kunjungan UKS",
  SAVED: "Kunjungan UKS tersimpan",
  CANCELLED: "Pencatatan dibatalkan",
}
export type ScanStudent = {
  id: string
  name: string
  nis: string | null
  nisn: string | null
  classId: string
  className: string
  homeroomName: string | null
  recipientReady: boolean
  credentialId?: string | null
}
export type ScanResult = {
  id: string
  outcome: string
  scannedAt: string
  schoolDate: string
  student: ScanStudent | null
  firstSeenAt: string | null
  visitId: string | null
  notifyStatus: string | null
  notifyError: string | null
  existingStatus: string | null
}
export type ScanHistoryRow = {
  id: string
  scannedAt: string
  mode: string
  source: string
  outcome: string
  className: string | null
  actorName: string
  student: { name: string; nis: string | null } | null
  visit: { id: string; notifyStatus: string | null } | null
}

export function isStudentQr(value: string): boolean {
  return /^SP1:[A-Za-z0-9_-]{32}$/.test(value) || /^SP2:[a-f0-9]{64}:[A-Za-z0-9_-]{43}$/.test(value)
}
export function scanWindowAllowed(minutes: number, open: string, close: string, autoLock: boolean): boolean {
  if (!autoLock) return true
  const read = (v: string) => (/^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : NaN)
  const start = read(open),
    end = read(close)
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    (start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end)
  )
}
