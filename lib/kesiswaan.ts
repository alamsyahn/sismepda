import { z } from "zod"
import { parseSchoolDate } from "@/lib/school-date"

export const KS_READ = ["kesiswaan.read.all", "kesiswaan.read.own"] as const
export const KS_LEVELS = ["Lokal", "Provinsi", "Nasional", "Internasional"] as const
export const KS_STAGES = [
  "Belum dinilai",
  "Perlu bimbingan",
  "Mulai berkembang",
  "Berkembang",
  "Mandiri",
] as const
const id = z.string().min(1).max(100)
const text = z.string().trim().min(1).max(200)
const date = z.string().refine((v) => !!parseSchoolDate(v), "Tanggal tidak valid")
const version = z.number().int().positive()
export const periodInput = z
  .object({
    year: z.string().regex(/^\d{4}\/\d{4}$/),
    semester: z.enum(["Ganjil", "Genap"]),
    start: date,
    end: date,
  })
  .refine((v) => v.start <= v.end, "Rentang periode tidak valid")
export const activityInput = z.object({
  id: id.optional(),
  version: version.optional(),
  periodId: id,
  name: text,
  kind: text,
  coachIds: z.array(id).min(1).max(20),
  schedule: z.string().trim().max(200),
  venue: z.string().trim().max(200),
  description: z.string().trim().max(2000),
  active: z.boolean(),
})
export const memberInput = z
  .object({
    id: id.optional(),
    version: version.optional(),
    activityId: id,
    studentId: id,
    joined: date,
    left: date.nullable(),
  })
  .refine((v) => !v.left || v.left >= v.joined, "Tanggal keluar sebelum bergabung")
export const sessionInput = z.object({
  id: id.optional(),
  version: version.optional(),
  activityId: id,
  date,
  topic: text,
  status: z.enum(["DRAFT", "CANCELLED"]).default("DRAFT"),
})
export const attendanceInput = z.object({
  sessionId: id,
  version,
  mode: z.enum(["draft", "final", "correct"]),
  reason: z.string().trim().max(2000).default(""),
  rows: z
    .array(
      z.object({
        id,
        status: z.enum(["H", "S", "I", "A"]).nullable(),
        note: z.string().trim().max(500),
      }),
    )
    .max(5000),
})
export const achievementInput = z.object({
  id: id.optional(),
  version: version.optional(),
  periodId: id,
  activityId: id.nullable(),
  title: text,
  organizer: text,
  date,
  level: z.enum(KS_LEVELS),
  result: text,
  participantIds: z.array(id).min(1).max(500),
  evidence: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => !v || /^https:\/\//i.test(v), "Bukti harus berupa tautan HTTPS"),
  status: z.enum(["DRAFT", "SUBMITTED", "VERIFIED", "REVISION"]),
})
export const reviewInput = z.object({
  id: id.optional(),
  version: version.optional(),
  memberId: id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  skill: z.enum(KS_STAGES),
  teamwork: z.enum(KS_STAGES),
  independence: z.enum(KS_STAGES),
  note: z.string().trim().max(2000),
})
export const followupInput = z.object({
  id: id.optional(),
  version: version.optional(),
  activityId: id,
  finding: z.string().trim().min(1).max(2000),
  owner: text,
  due: date,
  done: z.boolean(),
})

export function attendanceProblem(
  existingIds: string[],
  rows: { id: string; status: string | null }[],
  final: boolean,
) {
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    rows.length !== existingIds.length ||
    rows.some((r) => !existingIds.includes(r.id))
  )
    return "Daftar presensi berubah. Muat ulang pertemuan."
  if (final && (!rows.length || rows.some((r) => !r.status)))
    return "Lengkapi seluruh presensi sebelum finalisasi."
  return null
}

export function completedReview(r: { skill: string; teamwork: string; independence: string }) {
  return [r.skill, r.teamwork, r.independence].every((stage) => stage !== "Belum dinilai")
}
export function memberInMonth(m: { joined: string; left: string | null }, month: string) {
  return m.joined.slice(0, 7) <= month && (!m.left || m.left.slice(0, 7) >= month)
}
export function memberAt(m: { joined: string; left: string | null }, at: string) {
  return m.joined.slice(0, 10) <= at && (!m.left || m.left.slice(0, 10) >= at)
}

export function attendanceMetrics(
  sessions: { status: string; attendance: { status: string | null }[] }[],
) {
  const recorded = sessions.filter((s) => s.status !== "CANCELLED")
  const slots = recorded.flatMap((s) => s.attendance)
  const finals = recorded.filter((s) => s.status === "FINAL").flatMap((s) => s.attendance)
  const present = finals.filter((r) => r.status === "H").length
  return {
    slots: slots.length,
    filled: slots.filter((r) => r.status).length,
    finalCount: finals.length,
    present,
    rate: finals.length ? Math.round((present / finals.length) * 1000) / 10 : null,
    breakdown: ["H", "S", "I", "A"].map((status) => ({
      status,
      count: finals.filter((r) => r.status === status).length,
    })),
  }
}
