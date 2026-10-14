import { z } from "zod"
import { parseSchoolDate } from "./school-date"

export const FITNESS_NORM_URL = "https://tksi.kemendikdasmen.go.id/home/fase/4/prosedur/59"
export const FITNESS_PROTOCOLS = {
  TKSI_D_20M_2023: "TKSI Fase D · Beep Test 20 m (2023)",
  BEEP_20M_OTHER: "Beep Test 20 m · audio lain (tanpa kategori)",
} as const
export const FITNESS_STATUSES = {
  TESTED: "Sudah tes", NOT_TESTED: "Belum tes", ABSENT: "Tidak ikut", INVALID: "Tes tidak valid",
} as const
export type FitnessStatus = keyof typeof FITNESS_STATUSES
export type FitnessProtocol = keyof typeof FITNESS_PROTOCOLS
const rowSchema = z.object({
  studentId: z.string().min(1).max(100),
  version: z.number().int().nonnegative(),
  status: z.enum(["TESTED", "NOT_TESTED", "ABSENT", "INVALID"]),
  level: z.number().int().min(1).max(21).nullable(),
  shuttle: z.number().int().min(1).max(30).nullable(),
  note: z.string().trim().max(1000),
}).strict().superRefine((r, ctx) => {
  if (r.status === "TESTED" ? r.level === null || r.shuttle === null : r.level !== null || r.shuttle !== null) {
    ctx.addIssue({ code: "custom", message: "Level dan balikan hanya diisi lengkap untuk status sudah tes." })
  }
})
export const fitnessBatchSchema = z.object({
  classId: z.string().min(1).max(100),
  testedAt: z.string().refine(v => !!parseSchoolDate(v), "Tanggal tes tidak valid"),
  protocol: z.enum(["TKSI_D_20M_2023", "BEEP_20M_OTHER"]),
  audioLabel: z.string().trim().min(3, "Isi nama atau versi audio").max(160),
  rows: z.array(rowSchema).min(1).max(200),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.rows.map(r => r.studentId)).size !== v.rows.length) ctx.addIssue({ code: "custom", message: "Siswa tidak boleh berulang." })
})
export type FitnessBatch = z.infer<typeof fitnessBatchSchema>
export type FitnessInputRow = FitnessBatch["rows"][number]
export type FitnessResultView = FitnessInputRow & {
  id: string; testedAt: string; protocol: FitnessProtocol; audioLabel: string;
  genderAtTest: string | null; gradeAtTest: string; recordedByName: string; updatedAt: string;
}
export type FitnessRosterRow = { id: string; name: string; gender: string | null; grade: string; result: FitnessResultView | null }

/** Norm pinned to the published TKSI Fase D table, never a whole-fitness score.
 * The source leaves girls L1 B8 onward below L2 B1 undefined. Do not invent cutoffs.
 * Scores are compared as integer pairs; 4/10 is not decimal 4.1.
 */
export function fitnessCategory(value: {
  status: string; protocol: string; level: number | null; shuttle: number | null;
  genderAtTest: string | null; gradeAtTest: string;
}): string {
  if (value.status !== "TESTED") return "—"
  if (value.protocol !== "TKSI_D_20M_2023") return "Tanpa norma"
  if (!["7", "8", "9", "VII", "VIII", "IX"].includes(value.gradeAtTest.toUpperCase().trim())) return "Di luar Fase D"
  if (!value.level || !value.shuttle) return "Belum lengkap"
  const score = value.level * 100 + value.shuttle
  if (value.genderAtTest === "LAKI_LAKI") {
    if (score > 707) return "Baik sekali"
    if (score >= 404) return "Baik"
    if (score >= 202) return "Sedang"
    if (score >= 102) return "Kurang"
    return "Kurang sekali"
  }
  if (value.genderAtTest === "PEREMPUAN") {
    if (score > 405) return "Baik sekali"
    if (score >= 303) return "Baik"
    if (score >= 201) return "Sedang"
    if (score >= 102 && score <= 107) return "Kurang"
    if (score < 102) return "Kurang sekali"
    return "Batas norma perlu verifikasi"
  }
  return "Jenis kelamin belum diisi"
}

export function sameFitnessInput(a: FitnessInputRow, b: FitnessInputRow): boolean {
  return a.status === b.status && a.level === b.level && a.shuttle === b.shuttle && a.note === b.note
}
