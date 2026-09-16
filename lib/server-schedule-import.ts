/**
 * Impor jadwal dari aSc TimeTables: parse → petakan → pratinjau → terapkan.
 *
 * SERVER-ONLY (mengimpor Prisma).
 *
 * Alurnya sengaja dua langkah dan tidak pernah satu langkah. Mengunggah berkas
 * TIDAK menyentuh jadwal aktif: ia hanya menghasilkan satu baris
 * `ScheduleImport` berstatus PREVIEW berisi hasil parse ternormalisasi. Jadwal
 * baru lahir saat admin menekan Terapkan, dalam satu transaksi.
 */

import type { Prisma } from "@/app/generated/prisma/client"

import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { parseAscTimetable, type AscTimetable } from "@/lib/asc-timetable-parser"
import {
  buildMappingPlan,
  normalizeName,
  normalizePersonName,
  type InternalEntity,
  type MappingPlan,
} from "@/lib/asc-mapping"
import {
  diffSchedule,
  findConflicts,
  summarizeDiff,
  type ScheduleDiffSummary,
  type ScheduleEntryShape,
} from "@/lib/schedule-diff"
import {
  ensureActiveTimeProfile,
  listScheduleTeachers,
  readActiveEntries,
  readScheduleMasterData,
} from "@/lib/server-schedule"
import { lessonSlots } from "@/lib/schedule-time"

/** Satu-satunya sumber eksternal yang dikenal saat ini. */
const ASC_SOURCE = "ASC_TIMETABLES" as const

export type AscEntityType = "TEACHER" | "CLASS" | "SUBJECT"

/** Bentuk hasil parse yang disimpan pada `ScheduleImport.payload`. */
export type StoredImportPayload = {
  readonly teachers: readonly { readonly externalId: string; readonly name: string }[]
  readonly classes: readonly { readonly externalId: string; readonly name: string }[]
  readonly subjects: readonly { readonly externalId: string; readonly name: string }[]
  readonly placements: readonly {
    readonly day: number
    readonly period: number
    readonly teacherExternalId: string | null
    readonly classExternalId: string
    readonly subjectExternalId: string | null
    readonly room: string | null
  }[]
  readonly warnings: AscTimetable["warnings"]
  /** Jam milik aSc, disimpan HANYA untuk ditampilkan pada pratinjau. */
  readonly periods: AscTimetable["periods"]
}

/**
 * Meratakan penempatan aSc menjadi baris (hari, jam, kelas, guru, mapel).
 *
 * Satu card yang menyebut beberapa kelas menjadi beberapa baris: SISMEPDA
 * memandang jadwal per-kelas, dan kelas gabungan harus tampak pada tabel
 * masing-masing kelas.
 */
export function flattenPlacements(timetable: AscTimetable): StoredImportPayload["placements"] {
  const rows: StoredImportPayload["placements"][number][] = []
  for (const placement of timetable.placements) {
    const teacherIds: readonly (string | null)[] =
      placement.teacherExternalIds.length > 0 ? placement.teacherExternalIds : [null]
    for (const classExternalId of placement.classExternalIds) {
      for (const teacherExternalId of teacherIds) {
        rows.push({
          day: placement.day,
          period: placement.period,
          teacherExternalId,
          classExternalId,
          subjectExternalId: placement.subjectExternalId,
          room: placement.classroomName,
        })
      }
    }
  }
  return rows
}

export function toStoredPayload(timetable: AscTimetable): StoredImportPayload {
  return {
    teachers: timetable.teachers.map((item) => ({ externalId: item.externalId, name: item.name })),
    classes: timetable.classes.map((item) => ({ externalId: item.externalId, name: item.name })),
    subjects: timetable.subjects.map((item) => ({ externalId: item.externalId, name: item.name })),
    placements: flattenPlacements(timetable),
    warnings: timetable.warnings,
    periods: timetable.periods,
  }
}

/**
 * Mencatat satu berkas sebagai impor berstatus PREVIEW.
 *
 * Yang disimpan adalah hasil parse, bukan byte XML: berkas pengguna tidak
 * menumpuk di database dan tidak ada kolom biner baru.
 */
export async function createImportPreview(input: {
  readonly xml: string
  readonly fileName: string
  readonly fileSize: number
  readonly actorId: string
}): Promise<{ id: string }> {
  let timetable: AscTimetable
  try {
    timetable = parseAscTimetable(input.xml)
  } catch (error) {
    // Kegagalan parse tetap tercatat: admin perlu bukti bahwa berkasnya ditolak
    // dan mengapa, bukan sekadar toast yang hilang.
    await recordAuditLog({
      actorId: input.actorId,
      action: "SCHEDULE_IMPORT_FAILED",
      entity: "ScheduleImport",
      entityId: "-",
      summary: `Impor gagal dibaca: ${input.fileName}`,
      after: {
        fileName: input.fileName,
        fileSize: input.fileSize,
        error: (error as Error).message,
      } as unknown as Prisma.InputJsonValue,
    })
    throw new ApiError(400, (error as Error).message)
  }

  const created = await prisma.scheduleImport.create({
    data: {
      fileName: input.fileName,
      fileSize: input.fileSize,
      status: "PREVIEW",
      payload: toStoredPayload(timetable) as unknown as Prisma.InputJsonValue,
      uploadedById: input.actorId,
    },
    select: { id: true },
  })

  await recordAuditLog({
    actorId: input.actorId,
    action: "SCHEDULE_IMPORT_UPLOADED",
    entity: "ScheduleImport",
    entityId: created.id,
    summary: `Unggah ${input.fileName} (${timetable.placements.length} penempatan)`,
    after: {
      fileName: input.fileName,
      fileSize: input.fileSize,
      teachers: timetable.teachers.length,
      classes: timetable.classes.length,
      subjects: timetable.subjects.length,
      placements: timetable.placements.length,
    } as unknown as Prisma.InputJsonValue,
  })

  return created
}

type MappingTables = {
  readonly TEACHER: Map<string, InternalEntity>
  readonly CLASS: Map<string, InternalEntity>
  readonly SUBJECT: Map<string, InternalEntity>
}

async function readMappings(master: {
  readonly teachers: readonly InternalEntity[]
  readonly classes: readonly InternalEntity[]
  readonly subjects: readonly InternalEntity[]
}): Promise<MappingTables> {
  const rows = await prisma.scheduleExternalMapping.findMany({
    where: { source: ASC_SOURCE },
    select: { entityType: true, externalId: true, internalId: true },
  })

  const byId: Record<AscEntityType, Map<string, InternalEntity>> = {
    TEACHER: new Map(master.teachers.map((item) => [item.id, item])),
    CLASS: new Map(master.classes.map((item) => [item.id, item])),
    SUBJECT: new Map(master.subjects.map((item) => [item.id, item])),
  }

  const tables: MappingTables = { TEACHER: new Map(), CLASS: new Map(), SUBJECT: new Map() }
  for (const row of rows) {
    // Pemetaan yang menunjuk entity terhapus diperlakukan sebagai belum
    // terpetakan, bukan dipakai lalu gagal saat Apply.
    const internal = byId[row.entityType as AscEntityType]?.get(row.internalId)
    if (!internal) continue
    tables[row.entityType as AscEntityType].set(row.externalId, internal)
  }
  return tables
}

export type PreviewRow = {
  readonly day: number
  readonly period: number
  readonly className: string
  readonly subjectName: string
  readonly teacherName: string | null
  readonly room: string | null
}

export type SchedulePreview = {
  readonly importId: string
  readonly fileName: string
  readonly status: string
  readonly createdAt: Date
  readonly mapping: {
    readonly teachers: MappingPlan
    readonly classes: MappingPlan
    readonly subjects: MappingPlan
  }
  readonly diff: ScheduleDiffSummary
  readonly details: {
    readonly added: readonly PreviewRow[]
    readonly changed: readonly { readonly before: PreviewRow; readonly after: PreviewRow }[]
    readonly removed: readonly PreviewRow[]
  }
  /** Alasan Apply diblokir. Kosong berarti boleh diterapkan. */
  readonly blockers: readonly string[]
  readonly warnings: AscTimetable["warnings"]
  readonly unknownPeriods: readonly number[]
  readonly ascPeriods: AscTimetable["periods"]
}

type NameTables = {
  readonly classes: Map<string, string>
  readonly subjects: Map<string, string>
  readonly teachers: Map<string, string>
}

function labelize(entry: ScheduleEntryShape, names: NameTables): PreviewRow {
  return {
    day: entry.day,
    period: entry.period,
    className: names.classes.get(entry.classId) ?? "—",
    subjectName: names.subjects.get(entry.subjectId) ?? "—",
    teacherName: entry.teacherId ? (names.teachers.get(entry.teacherId) ?? null) : null,
    room: entry.room,
  }
}

/** Jumlah baris detail yang dikirim ke klien; sisanya diwakili ringkasan. */
const DETAIL_LIMIT = 200

function onlyReferenced<T extends { externalId: string }>(items: readonly T[], keep: ReadonlySet<string>): T[] {
  return items.filter((item) => keep.has(item.externalId))
}

/**
 * Menghitung pratinjau sebuah impor terhadap jadwal aktif.
 *
 * Murni baca — memanggilnya berulang kali tidak mengubah apa pun, sehingga
 * admin dapat memperbaiki pemetaan lalu memuat ulang sampai tidak ada blocker.
 */
export async function buildPreview(importId: string): Promise<SchedulePreview> {
  const record = await prisma.scheduleImport.findUnique({ where: { id: importId } })
  if (!record) throw new ApiError(404, "Data impor tidak ditemukan")
  if (record.payload === null) throw new ApiError(400, record.error ?? "Berkas impor tidak dapat dibaca")

  const payload = record.payload as unknown as StoredImportPayload

  const [master, profile, currentEntries] = await Promise.all([
    readScheduleMasterData(),
    ensureActiveTimeProfile(),
    readActiveEntries(),
  ])

  const teacherEntities: InternalEntity[] = master.teachers.map((item) => ({ id: item.id, name: item.name }))
  const mappings = await readMappings({
    teachers: teacherEntities,
    classes: master.classes,
    subjects: master.subjects,
  })

  // Hanya entity yang benar-benar dirujuk penempatan yang wajib dipetakan;
  // guru/kelas yang ada di XML tetapi tidak mengajar apa pun tidak menghalangi.
  const referencedTeachers = new Set<string>()
  const referencedClasses = new Set<string>()
  const referencedSubjects = new Set<string>()
  for (const row of payload.placements) {
    if (row.teacherExternalId) referencedTeachers.add(row.teacherExternalId)
    referencedClasses.add(row.classExternalId)
    if (row.subjectExternalId) referencedSubjects.add(row.subjectExternalId)
  }

  const mapping = {
    teachers: buildMappingPlan(
      onlyReferenced(payload.teachers, referencedTeachers),
      mappings.TEACHER,
      teacherEntities,
      { normalize: normalizePersonName },
    ),
    classes: buildMappingPlan(onlyReferenced(payload.classes, referencedClasses), mappings.CLASS, master.classes, {
      normalize: normalizeName,
    }),
    subjects: buildMappingPlan(
      onlyReferenced(payload.subjects, referencedSubjects),
      mappings.SUBJECT,
      master.subjects,
      { normalize: normalizeName },
    ),
  }

  const knownPeriods = new Set(lessonSlots(profile.slots).map((slot) => slot.ascPeriod as number))
  const unknownPeriods = [...new Set(payload.placements.map((row) => row.period))]
    .filter((period) => !knownPeriods.has(period))
    .sort((a, b) => a - b)

  const next = buildEntryShapes(payload, mappings, knownPeriods)

  const current: ScheduleEntryShape[] = currentEntries.map((entry) => ({
    id: entry.id,
    day: entry.day,
    period: entry.period,
    classId: entry.classId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId ?? "",
    room: entry.room,
  }))

  const diff = diffSchedule(current, next)
  const names: NameTables = {
    classes: new Map(master.classes.map((item) => [item.id, item.name])),
    subjects: new Map(master.subjects.map((item) => [item.id, item.name])),
    teachers: new Map(teacherEntities.map((item) => [item.id, item.name])),
  }

  const blockers: string[] = []
  if (mapping.teachers.unmappedCount > 0) blockers.push(`${mapping.teachers.unmappedCount} guru aSc belum dipetakan`)
  if (mapping.classes.unmappedCount > 0) blockers.push(`${mapping.classes.unmappedCount} kelas aSc belum dipetakan`)
  if (mapping.subjects.unmappedCount > 0) {
    blockers.push(`${mapping.subjects.unmappedCount} mata pelajaran aSc belum dipetakan`)
  }
  if (unknownPeriods.length > 0) {
    blockers.push(
      `Jam ke-${unknownPeriods.join(", ")} belum ada pada Waktu & Kegiatan; lengkapi struktur waktu lebih dulu`,
    )
  }
  const conflicts = findConflicts(next)
  if (conflicts.length > 0) blockers.push(`${conflicts.length} bentrok pada hasil impor`)

  return {
    importId: record.id,
    fileName: record.fileName,
    status: record.status,
    createdAt: record.createdAt,
    mapping,
    diff: summarizeDiff(diff),
    details: {
      added: diff.added.slice(0, DETAIL_LIMIT).map((entry) => labelize(entry, names)),
      changed: diff.changed.slice(0, DETAIL_LIMIT).map((pair) => ({
        before: labelize(pair.before, names),
        after: labelize(pair.after, names),
      })),
      removed: diff.removed.slice(0, DETAIL_LIMIT).map((entry) => labelize(entry, names)),
    },
    blockers,
    warnings: payload.warnings,
    unknownPeriods,
    ascPeriods: payload.periods,
  }
}

/**
 * Menerjemahkan penempatan aSc menjadi calon entri SISMEPDA.
 *
 * Baris yang kelas/mapel/jam-nya belum terpetakan dilewati: jumlahnya sudah
 * terwakili sebagai blocker, dan memasukkannya setengah jadi akan membuat
 * jadwal aktif berisi lubang yang tidak terlihat.
 */
function buildEntryShapes(
  payload: StoredImportPayload,
  mappings: MappingTables,
  knownPeriods: ReadonlySet<number>,
): ScheduleEntryShape[] {
  const rows: ScheduleEntryShape[] = []
  for (const row of payload.placements) {
    const schoolClass = mappings.CLASS.get(row.classExternalId)
    const subject = row.subjectExternalId ? mappings.SUBJECT.get(row.subjectExternalId) : null
    if (!schoolClass || !subject || !knownPeriods.has(row.period)) continue
    const teacher = row.teacherExternalId ? mappings.TEACHER.get(row.teacherExternalId) : null
    rows.push({
      day: row.day,
      period: row.period,
      classId: schoolClass.id,
      subjectId: subject.id,
      teacherId: teacher?.id ?? "",
      room: row.room,
    })
  }
  return rows
}

/** Menyimpan atau menghapus satu pemetaan external ID → ID internal. */
export async function saveMapping(input: {
  readonly entityType: AscEntityType
  readonly externalId: string
  readonly externalName: string | null
  readonly internalId: string | null
  readonly actorId: string
}): Promise<void> {
  if (input.internalId === null) {
    await prisma.scheduleExternalMapping.deleteMany({
      where: { source: ASC_SOURCE, entityType: input.entityType, externalId: input.externalId },
    })
    await recordAuditLog({
      actorId: input.actorId,
      action: "SCHEDULE_MAPPING_UPDATED",
      entity: "ScheduleExternalMapping",
      entityId: `${input.entityType}:${input.externalId}`,
      summary: `Hapus pemetaan ${input.entityType} ${input.externalId}`,
    })
    return
  }

  // ID internal diverifikasi ke tabel yang benar: menerima id sembarang akan
  // memasang jadwal pada entity yang tidak pernah dipilih admin.
  await assertInternalEntityExists(input.entityType, input.internalId)

  const saved = await prisma.scheduleExternalMapping.upsert({
    where: {
      source_entityType_externalId: {
        source: ASC_SOURCE,
        entityType: input.entityType,
        externalId: input.externalId,
      },
    },
    create: {
      source: ASC_SOURCE,
      entityType: input.entityType,
      externalId: input.externalId,
      internalId: input.internalId,
      externalName: input.externalName,
    },
    update: { internalId: input.internalId, externalName: input.externalName },
    select: { id: true },
  })

  await recordAuditLog({
    actorId: input.actorId,
    action: "SCHEDULE_MAPPING_UPDATED",
    entity: "ScheduleExternalMapping",
    entityId: saved.id,
    summary: `Petakan ${input.entityType} ${input.externalId}`,
    after: {
      entityType: input.entityType,
      externalId: input.externalId,
      internalId: input.internalId,
    } as unknown as Prisma.InputJsonValue,
  })
}

async function assertInternalEntityExists(entityType: AscEntityType, internalId: string): Promise<void> {
  if (entityType === "CLASS") {
    const found = await prisma.schoolClass.findUnique({ where: { id: internalId }, select: { id: true } })
    if (!found) throw new ApiError(404, "Kelas tidak ditemukan")
    return
  }
  if (entityType === "SUBJECT") {
    const found = await prisma.subject.findUnique({ where: { id: internalId }, select: { id: true } })
    if (!found) throw new ApiError(404, "Mata pelajaran tidak ditemukan")
    return
  }
  // Sengaja dibatasi pada populasi guru, bukan seluruh User: jadwal hanya boleh
  // menunjuk akun yang memang guru menurut SISMEPDA.
  const teachers = await listScheduleTeachers()
  if (!teachers.some((teacher) => teacher.id === internalId)) {
    throw new ApiError(404, "Guru tidak ditemukan pada populasi guru SISMEPDA")
  }
}

/**
 * Menerapkan impor: membuat revisi baru berisi seluruh hasil impor dan
 * menjadikannya aktif — dalam SATU transaksi.
 *
 * Bila gagal di tengah, revisi lama tetap aktif dan utuh. Semantiknya menimpa,
 * bukan menggabungkan: hasil impor menjadi baseline jadwal aktif yang baru, dan
 * suntingan manual yang berbeda dari XML sudah ditampilkan sebagai
 * `changed`/`removed` pada pratinjau sebelum admin menekan Terapkan.
 */
export async function applyImport(
  importId: string,
  actorId: string,
): Promise<{ revisionId: string; number: number; entryCount: number }> {
  const preview = await buildPreview(importId)
  if (preview.status !== "PREVIEW") throw new ApiError(409, "Impor ini sudah tidak dalam status pratinjau")
  if (preview.blockers.length > 0) {
    throw new ApiError(409, `Impor belum dapat diterapkan: ${preview.blockers.join("; ")}`)
  }

  const record = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: importId } })
  const payload = record.payload as unknown as StoredImportPayload

  const [master, profile] = await Promise.all([readScheduleMasterData(), ensureActiveTimeProfile()])
  const mappings = await readMappings({
    teachers: master.teachers.map((item) => ({ id: item.id, name: item.name })),
    classes: master.classes,
    subjects: master.subjects,
  })
  const knownPeriods = new Set(lessonSlots(profile.slots).map((slot) => slot.ascPeriod as number))

  const rows = buildEntryShapes(payload, mappings, knownPeriods).map((row) => ({
    day: row.day,
    period: row.period,
    classId: row.classId,
    subjectId: row.subjectId,
    teacherId: row.teacherId === "" ? null : row.teacherId,
    room: row.room,
  }))

  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.scheduleRevision.findFirst({ orderBy: { number: "desc" }, select: { number: true } })
    const revision = await tx.scheduleRevision.create({
      data: {
        number: (last?.number ?? 0) + 1,
        source: "ASC_IMPORT",
        active: false,
        note: `Impor aSc: ${record.fileName}`,
        summary: preview.diff as unknown as Prisma.InputJsonValue,
        createdById: actorId,
      },
      select: { id: true, number: true },
    })

    if (rows.length > 0) {
      await tx.scheduleEntry.createMany({ data: rows.map((row) => ({ ...row, revisionId: revision.id })) })
    }

    // Menonaktifkan yang lama dan mengaktifkan yang baru terjadi dalam
    // transaksi yang sama, jadi tidak pernah ada momen tanpa jadwal aktif.
    await tx.scheduleRevision.updateMany({ where: { active: true }, data: { active: false } })
    await tx.scheduleRevision.update({ where: { id: revision.id }, data: { active: true } })

    await tx.scheduleImport.update({
      where: { id: importId },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
        revisionId: revision.id,
        summary: preview.diff as unknown as Prisma.InputJsonValue,
      },
    })

    await recordAuditLog(
      {
        actorId,
        action: "SCHEDULE_IMPORT_APPLIED",
        entity: "ScheduleRevision",
        entityId: revision.id,
        summary: `Terapkan ${record.fileName} sebagai Versi ${revision.number} (${rows.length} penempatan)`,
        after: {
          importId,
          fileName: record.fileName,
          revisionNumber: revision.number,
          entries: rows.length,
          diff: preview.diff,
        } as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return revision
  })

  return { revisionId: result.id, number: result.number, entryCount: rows.length }
}

/** Membatalkan pratinjau yang tidak jadi diterapkan. */
export async function cancelImport(importId: string, actorId: string): Promise<void> {
  const record = await prisma.scheduleImport.findUnique({ where: { id: importId }, select: { status: true } })
  if (!record) throw new ApiError(404, "Data impor tidak ditemukan")
  if (record.status !== "PREVIEW") throw new ApiError(409, "Hanya pratinjau yang dapat dibatalkan")

  await prisma.scheduleImport.update({ where: { id: importId }, data: { status: "CANCELLED" } })
  await recordAuditLog({
    actorId,
    action: "SCHEDULE_IMPORT_CANCELLED",
    entity: "ScheduleImport",
    entityId: importId,
    summary: "Batalkan pratinjau impor",
  })
}

export type ScheduleImportListItem = {
  readonly id: string
  readonly fileName: string
  readonly fileSize: number
  readonly status: string
  readonly error: string | null
  readonly summary: unknown
  readonly createdAt: Date
  readonly appliedAt: Date | null
  readonly uploadedByName: string | null
}

/** Riwayat impor untuk panel "Kelola Jadwal". */
export async function listImports(limit = 10): Promise<readonly ScheduleImportListItem[]> {
  const rows = await prisma.scheduleImport.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      status: true,
      error: true,
      summary: true,
      createdAt: true,
      appliedAt: true,
      uploadedBy: { select: { name: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    status: row.status,
    error: row.error,
    summary: row.summary,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
    uploadedByName: row.uploadedBy?.name ?? null,
  }))
}
