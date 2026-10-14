import type { MenstruationSource } from "./menstruation"

/** Pure policy; linkedStudentId must come from current User.studentId, never URL/NIS/role. */
export function decideMenstruationAccess(grants: ReadonlySet<string>, linkedStudentId: string | null, action: "read" | "create" | "update" | "review", requestedStudentId?: string): { studentId: string; source: MenstruationSource } {
  if (requestedStudentId && grants.has(`euks.menstruation.${action}`)) return { studentId: requestedStudentId, source: "UKS" }
  if (action !== "review" && grants.has(`euks.menstruation.${action}.own`) && linkedStudentId && (!requestedStudentId || requestedStudentId === linkedStudentId)) return { studentId: linkedStudentId, source: "STUDENT" }
  throw new Error("FORBIDDEN")
}

/** Linked student comes from the current account's database relation. */
export function canReadOwnMenstruation(grants: ReadonlySet<string>, student: { active: boolean; gender: string | null } | null): boolean {
  return grants.has("euks.menstruation.read.own") && student?.active === true && student.gender === "PEREMPUAN"
}
