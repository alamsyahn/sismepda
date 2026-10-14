/** Server boundary: readers and writers enforce current database permissions. */
import type { PrismaClient } from "@/app/generated/prisma/client"
import { fitnessBatchSchema, sameFitnessInput, type FitnessResultView, type FitnessProtocol } from "./fitness"
import { fromPrismaDate, requireSchoolDate, toPrismaDate, todayInSchoolTimeZone } from "./school-date"

export class FitnessError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
type Actor = { id: string; grants: ReadonlySet<string> }

async function runtime() {
  const [{ prisma }, { requirePermission }, { readSchoolTimeZone }] = await Promise.all([
    import("./prisma"), import("./rbac-access"), import("./server-school-time-zone"),
  ])
  const context = await requirePermission("euks.fitness.read")
  return { db: prisma, actor: { id: context.user.id, grants: context.grants }, today: todayInSchoolTimeZone(new Date(), await readSchoolTimeZone()) }
}

/** Batch is atomic; lock + version checks prevent unnoticed overwrites and duplicate sessions. */
export async function executeFitnessBatch(db: PrismaClient, actor: Actor, raw: unknown, today: string) {
  if (!actor.grants.has("euks.fitness.read") || !["euks.fitness.create", "euks.fitness.update"].some(p => actor.grants.has(p))) throw new FitnessError("Tidak memiliki izin mencatat kebugaran.", 403)
  const parsed = fitnessBatchSchema.safeParse(raw)
  if (!parsed.success) throw new FitnessError(parsed.error.issues[0]?.message ?? "Isian tidak valid")
  const input = parsed.data
  if (input.testedAt > requireSchoolDate(today)) throw new FitnessError("Tanggal tes tidak boleh di masa depan.")
  const testedAt = toPrismaDate(requireSchoolDate(input.testedAt))
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, name: true } })
    if (!user?.active) throw new FitnessError("Akun tidak aktif.", 401)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fitness:${input.classId}:${input.testedAt}:BEEP_TEST`}, 0))`
    const schoolClass = await tx.schoolClass.findUnique({ where: { id: input.classId }, select: { grade: true } })
    if (!schoolClass) throw new FitnessError("Kelas tidak ditemukan.", 404)
    let session = await tx.fitnessSession.findUnique({ where: { classId_testedAt_testType: { classId: input.classId, testedAt, testType: "BEEP_TEST" } } })
    if (session && (session.protocol !== input.protocol || session.audioLabel !== input.audioLabel)) throw new FitnessError("Protokol/audio sesi ini berbeda. Muat ulang tanggal tes yang dipilih.", 409)
    const students = await tx.student.findMany({ where: { id: { in: input.rows.map(r => r.studentId) }, OR: [{ classId: input.classId, active: true }, ...(session ? [{ fitnessResults: { some: { sessionId: session.id } } }] : [])] }, select: { id: true, gender: true } })
    if (students.length !== input.rows.length) throw new FitnessError("Ada siswa tidak aktif atau tidak termasuk kelas/sesi ini.", 400)
    if (!session) {
      if (!actor.grants.has("euks.fitness.create")) throw new FitnessError("Tidak memiliki izin membuat sesi tes.", 403)
      session = await tx.fitnessSession.create({ data: { classId: input.classId, testedAt, testType: "BEEP_TEST", protocol: input.protocol, audioLabel: input.audioLabel } })
    }
    let changed = 0
    const versions: Record<string, number> = {}
    for (const row of input.rows) {
      const current = await tx.fitnessResult.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: row.studentId } } })
      if (current && sameFitnessInput(row, { ...current, note: current.note ?? "" })) { versions[row.studentId] = current.version; continue }
      const permission = current ? "euks.fitness.update" : "euks.fitness.create"
      if (!actor.grants.has(permission)) throw new FitnessError("Tidak memiliki izin untuk salah satu perubahan. Tidak ada perubahan disimpan.", 403)
      if ((current?.version ?? 0) !== row.version) throw new FitnessError("Data telah berubah oleh petugas lain. Muat ulang sebelum menyimpan. Tidak ada perubahan disimpan.", 409)
      const student = students.find(s => s.id === row.studentId)!
      const values = { status: row.status, level: row.level, shuttle: row.shuttle, note: row.note || null, recordedById: actor.id, recordedByName: user.name }
      if (current) {
        await tx.fitnessResult.update({ where: { id: current.id }, data: { ...values, version: { increment: 1 } } })
      } else {
        await tx.fitnessResult.create({ data: { ...values, studentId: row.studentId, sessionId: session.id, genderAtTest: student.gender, gradeAtTest: schoolClass.grade } })
      }
      versions[row.studentId] = (current?.version ?? 0) + 1
      changed++
    }
    if (changed) await tx.auditLog.create({ data: { actorId: actor.id, entity: "FitnessSession", entityId: session.id, action: "SAVE", summary: `Memperbarui ${changed} catatan kebugaran` } })
    return { changed, versions }
  }, { timeout: 15000 })
}

type ResultWithSession = Awaited<ReturnType<PrismaClient["fitnessResult"]["findMany"]>>[number] & {
  session: { testedAt: Date; protocol: string; audioLabel: string }
}
function dto(r: ResultWithSession): FitnessResultView {
  return { id: r.id, studentId: r.studentId, version: r.version, status: r.status, level: r.level, shuttle: r.shuttle, note: r.note ?? "", genderAtTest: r.genderAtTest, gradeAtTest: r.gradeAtTest, recordedByName: r.recordedByName, updatedAt: r.updatedAt.toISOString(), testedAt: fromPrismaDate(r.session.testedAt), protocol: r.session.protocol as FitnessProtocol, audioLabel: r.session.audioLabel }
}
export async function saveFitnessBatch(raw: unknown) {
  const r = await runtime()
  return executeFitnessBatch(r.db, r.actor, raw, r.today)
}
export async function readFitnessRoster(classId: string, testedAt: string) {
  const r = await runtime()
  const date = toPrismaDate(requireSchoolDate(testedAt))
  const schoolClass = await r.db.schoolClass.findUnique({ where: { id: classId }, select: { grade: true } })
  if (!schoolClass) throw new FitnessError("Kelas tidak ditemukan.", 404)
  const [session, students] = await Promise.all([
    r.db.fitnessSession.findUnique({ where: { classId_testedAt_testType: { classId, testedAt: date, testType: "BEEP_TEST" } }, include: { results: { include: { session: true } } } }),
    r.db.student.findMany({ where: { OR: [{ classId, active: true }, { fitnessResults: { some: { session: { classId, testedAt: date, testType: "BEEP_TEST" } } } }] }, select: { id: true, name: true, gender: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ])
  return { today: r.today, session: session ? { protocol: session.protocol as FitnessProtocol, audioLabel: session.audioLabel } : null, rows: students.map(s => ({ ...s, grade: schoolClass.grade, result: session?.results.find(v => v.studentId === s.id) ? dto(session.results.find(v => v.studentId === s.id)!) : null })), canCreate: r.actor.grants.has("euks.fitness.create"), canUpdate: r.actor.grants.has("euks.fitness.update") }
}
export async function readStudentFitness(studentId: string) {
  const r = await runtime()
  const results = await r.db.fitnessResult.findMany({ where: { studentId }, include: { session: true }, orderBy: [{ session: { testedAt: "desc" } }, { id: "desc" }] })
  return results.map(dto)
}
