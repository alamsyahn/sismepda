import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { normalizeSubjectName, subjectNameProblem } from "@/lib/subject-constants"

/**
 * Data Master Mata Pelajaran.
 *
 * Model `Subject` sudah ada sejak awal dan dipakai jadwal, penugasan mengajar,
 * dan pemetaan impor aSc — tetapi selama ini barisnya hanya lahir diam-diam
 * lewat `upsert` dari alur lain, sehingga tidak ada satu tempat pun untuk
 * melihat atau merapikan daftarnya. Modul ini menjadikannya data master yang
 * dikelola secara sadar, TANPA mengubah skema: nama tetap `@unique` dan
 * seluruh relasi tetap menunjuk `Subject.id`.
 *
 * SERVER-ONLY: mengimpor `lib/prisma.ts`. Komponen klien yang butuh aturan
 * namanya mengimpor `lib/subject-constants.ts`.
 */

export type SubjectView = {
  readonly id: string
  readonly name: string
  /** Berapa banyak data lain yang memakainya; dipakai UI untuk menjelaskan kenapa hapus ditolak. */
  readonly usage: {
    readonly scheduleEntries: number
    readonly assignments: number
    readonly teacherSubjects: number
    readonly importMappings: number
  }
  /** Turunan `usage`: hanya mata pelajaran tak terpakai yang boleh dihapus. */
  readonly deletable: boolean
}

export class SubjectError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "SubjectError"
  }
}

/**
 * Seluruh mata pelajaran beserta pemakaiannya, diurutkan menurut nama.
 *
 * Pengurutan memakai `localeCompare` Indonesia di sisi aplikasi supaya "Bahasa
 * Indonesia" dan "bahasa inggris" berdampingan apa pun kapitalisasinya.
 */
export async function listSubjects(): Promise<SubjectView[]> {
  const [rows, mappings] = await Promise.all([
    prisma.subject.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: { scheduleEntries: true, assignments: true, teacherSubjects: true },
        },
      },
    }),
    // Pemetaan impor sengaja TIDAK berelasi foreign-key ke Subject
    // (`internalId` hanyalah string), supaya menghapus mata pelajaran tidak
    // pernah menghapus riwayat pemetaan secara beruntun. Karena itu
    // pemakaiannya dihitung lewat query terpisah, bukan `_count`.
    prisma.scheduleExternalMapping.groupBy({
      by: ["internalId"],
      where: { entityType: "SUBJECT" },
      _count: { _all: true },
    }),
  ])

  const mappingCount = new Map(mappings.map((row) => [row.internalId, row._count._all]))

  return rows
    .map((row) => {
      const usage = {
        scheduleEntries: row._count.scheduleEntries,
        assignments: row._count.assignments,
        teacherSubjects: row._count.teacherSubjects,
        importMappings: mappingCount.get(row.id) ?? 0,
      }
      const total =
        usage.scheduleEntries + usage.assignments + usage.teacherSubjects + usage.importMappings
      return { id: row.id, name: row.name, usage, deletable: total === 0 }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "id", { sensitivity: "base" }))
}

/**
 * Menolak nama yang bentrok dengan baris lain.
 *
 * Perbandingan dilakukan case-insensitive walaupun indeks unik database
 * case-sensitive: "Matematika" dan "matematika" adalah mata pelajaran yang sama
 * bagi sekolah, dan membiarkan keduanya masuk membuat pemetaan impor bercabang
 * ke dua ID berbeda.
 */
async function assertNameAvailable(name: string, exceptId?: string): Promise<void> {
  const existing = await prisma.subject.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true },
  })
  if (existing) {
    throw new SubjectError(`Mata pelajaran "${existing.name}" sudah ada`, 409)
  }
}

export async function createSubject(name: string, actorId: string): Promise<SubjectView> {
  const clean = normalizeSubjectName(name)
  const problem = subjectNameProblem(clean)
  if (problem) throw new SubjectError(problem, 400)

  await assertNameAvailable(clean)
  const created = await prisma.subject.create({ data: { name: clean }, select: { id: true, name: true } })

  await recordAuditLog({
    actorId,
    action: "SUBJECT_CREATED",
    entity: "Subject",
    entityId: created.id,
    after: { name: created.name },
  })

  return {
    id: created.id,
    name: created.name,
    usage: { scheduleEntries: 0, assignments: 0, teacherSubjects: 0, importMappings: 0 },
    deletable: true,
  }
}

/**
 * Mengganti nama satu mata pelajaran.
 *
 * ID tidak pernah berubah, sehingga jadwal, penugasan, dan pemetaan aSc yang
 * sudah ada langsung menampilkan nama baru tanpa dipetakan ulang.
 */
export async function renameSubject(id: string, name: string, actorId: string): Promise<SubjectView> {
  const clean = normalizeSubjectName(name)
  const problem = subjectNameProblem(clean)
  if (problem) throw new SubjectError(problem, 400)

  const before = await prisma.subject.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!before) throw new SubjectError("Mata pelajaran tidak ditemukan", 404)

  await assertNameAvailable(clean, id)
  await prisma.subject.update({ where: { id }, data: { name: clean } })

  await recordAuditLog({
    actorId,
    action: "SUBJECT_UPDATED",
    entity: "Subject",
    entityId: id,
    before: { name: before.name },
    after: { name: clean },
  })

  const refreshed = (await listSubjects()).find((item) => item.id === id)
  if (!refreshed) throw new SubjectError("Mata pelajaran tidak ditemukan", 404)
  return refreshed
}

/**
 * Menghapus mata pelajaran HANYA bila tidak dipakai apa pun.
 *
 * Sengaja tidak memakai penghapusan beruntun: menghapus satu mata pelajaran
 * tidak boleh ikut menghapus jadwal atau penugasan mengajar yang memakainya.
 */
export async function deleteSubject(id: string, actorId: string): Promise<void> {
  const subject = (await listSubjects()).find((item) => item.id === id)
  if (!subject) throw new SubjectError("Mata pelajaran tidak ditemukan", 404)

  if (!subject.deletable) {
    const parts: string[] = []
    if (subject.usage.scheduleEntries > 0) parts.push(`${subject.usage.scheduleEntries} penempatan jadwal`)
    if (subject.usage.assignments > 0) parts.push(`${subject.usage.assignments} penugasan mengajar`)
    if (subject.usage.teacherSubjects > 0) parts.push(`${subject.usage.teacherSubjects} keahlian guru`)
    if (subject.usage.importMappings > 0) parts.push(`${subject.usage.importMappings} pemetaan impor`)
    throw new SubjectError(
      `Mata pelajaran "${subject.name}" masih dipakai oleh ${parts.join(", ")}`,
      409,
    )
  }

  await prisma.subject.delete({ where: { id } })
  await recordAuditLog({
    actorId,
    action: "SUBJECT_DELETED",
    entity: "Subject",
    entityId: id,
    before: { name: subject.name },
  })
}
