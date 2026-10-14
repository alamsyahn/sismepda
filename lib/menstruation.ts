import { z } from "zod"
import { eachSchoolDate, requireSchoolDate, isSchoolDate, startOfSchoolWeek, addSchoolDays } from "./school-date"

/** Public wire contract. POST /api/e-uks/menstruation; never submit source/recorder.
 * Updates require current version. 409 returns conflictId; review accepts latest
 * version + explicit resolution. APPLY_PROPOSED overrides stale CAS only, never
 * contradictory facts: use KEEP_CURRENT then explicitly correct the opposing
 * week/episode with its latest id/version and resubmit. Complaint omission keeps
 * an existing weekly note; null explicitly clears it. Weekly rows are changed rows only; HAD is not
 * an episode and never invents a start. NONE is explicit no-menstruation.
 */
const date = z.string().refine(isSchoolDate, "Tanggal tidak valid")
const version = z.number().int().nonnegative()
const id = z.string().min(1).max(128)
const fields = { startDate: date, endDate: date.nullable(), complaint: z.string().trim().max(2000).nullable() }
const episode = z.object({ action: z.literal("episode"), requestId: z.uuid(), studentId: id.optional(), id: id.optional(), version: version.optional(), ...fields }).strict().refine(v => !v.id || v.version !== undefined, "Version wajib")
const nestedEpisode = z.object({ id: id.optional(), version: version.optional(), ...fields }).strict().refine(v => !v.id || v.version !== undefined, "Version wajib")
const row = z.object({ studentId: id, status: z.enum(["HAD", "NONE", "UNKNOWN"]), complaint: fields.complaint.optional(), version: version.optional(), episodeId: id.nullable().optional(), episode: nestedEpisode.optional() }).strict().refine(v => !v.episode || (v.status === "HAD" && !v.episodeId), "Episode hanya untuk HAD, pilih episodeId atau episode")
export const menstruationMutationSchema = z.discriminatedUnion("action", [
  episode,
  z.object({ action: z.literal("profile"), requestId: z.uuid(), studentId: id.optional(), version, neverMenstruated: z.boolean().nullable() }).strict(),
  z.object({ action: z.literal("weekly"), requestId: z.uuid(), classId: id, weekStart: date, rows: z.array(row).min(1).max(500) }).strict().refine(v => new Set(v.rows.map(r => r.studentId)).size === v.rows.length, "Siswa duplikat"),
  z.object({ action: z.literal("review"), requestId: z.uuid(), conflictId: id, version, resolution: z.enum(["KEEP_CURRENT", "APPLY_PROPOSED"]), reason: z.string().trim().min(1).max(1000) }).strict(),
])
export type MenstruationMutation = z.infer<typeof menstruationMutationSchema>
export type MenstruationSource = "STUDENT" | "UKS"
export type MenstruationEpisodeData = { id: string; version: number; startDate: string; endDate: string | null; complaint: string | null; source: MenstruationSource; recorder: { id: string; name: string }; updatedAt: string }
export type MenstruationWeeklyData = { id: string; studentId: string; weekStart: string; status: "HAD" | "NONE" | "UNKNOWN"; complaint: string | null; version: number; episodeId: string | null; source: MenstruationSource; recorder: { id: string; name: string }; updatedAt: string }
export type MenstruationCardData = { student: { id: string; name: string; classId: string }; today: string; profile: { neverMenstruated: boolean | null; version: number }; episodes: MenstruationEpisodeData[]; weeks: MenstruationWeeklyData[]; history: { id: string; source: MenstruationSource; action: string; createdAt: string; recorder: { id: string; name: string }; before: unknown; after: unknown }[]; conflicts: { id: string; targetType: string; targetId: string | null; currentVersion?: number; proposed: unknown; createdAt: string }[]; canCreate: boolean; canUpdate: boolean; canReview: boolean }
export type MenstruationWeekData = { classId: string; weekStart: string; today: string; students: { id: string; name: string; confirmation: MenstruationWeeklyData | null }[]; canCreate: boolean; canUpdate: boolean }
export function validateMenstruationDates(input: MenstruationMutation, today: string): void {
  if (input.action === "episode") {
    if (input.startDate > today || (input.endDate && input.endDate > today)) throw new Error("Tanggal aktual tidak boleh di masa depan")
    if (input.endDate && input.endDate < input.startDate) throw new Error("Tanggal akhir sebelum mulai")
    knownMenstruationDays(input)
  }
  if (input.action === "weekly") for(const row of input.rows) if(row.episode) {
    validateMenstruationDates({action:"episode",requestId:input.requestId,...row.episode},today)
    if(row.episode.startDate > addSchoolDays(requireSchoolDate(input.weekStart),6) || (row.episode.endDate ?? row.episode.startDate) < input.weekStart) throw new Error("Episode tidak terkait minggu")
  }
  if (input.action === "weekly" && (input.weekStart > today || startOfSchoolWeek(requireSchoolDate(input.weekStart)) !== input.weekStart)) throw new Error("Minggu harus dimulai Senin dan tidak di masa depan")
}

/** Project private JSON snapshots before they cross a single-student boundary.
 * Recursion also covers legacy conflict histories containing full batch proposals.
 */
export function projectMenstruationSnapshot(value: unknown, studentId: string): unknown {
  if (Array.isArray(value)) return value.filter(v => !v || typeof v !== "object" || !("studentId" in v) || v.studentId === studentId).map(v => projectMenstruationSnapshot(v, studentId))
  if (!value || typeof value !== "object") return value
  const object = value as Record<string, unknown>
  if (typeof object.studentId === "string" && object.studentId !== studentId) return null
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, projectMenstruationSnapshot(child, studentId)]))
}

export function knownMenstruationDays(episode: { startDate: string; endDate: string | null }): string[] {
  const start = requireSchoolDate(episode.startDate)
  return episode.endDate ? eachSchoolDate(start, requireSchoolDate(episode.endDate), { maxDays: 366 }) : [start]
}
