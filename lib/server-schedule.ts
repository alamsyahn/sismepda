/**
 * Akses data modul Jadwal.
 *
 * SERVER-ONLY (mengimpor `lib/prisma.ts`). Komponen klien hanya boleh
 * mengimpor TIPE dari berkas ini — mengimpor value akan memecah bundel
 * peramban (lihat docs/architecture/overview.md).
 */

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { ApiError } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { schoolMinutesOfDay, todayInSchoolTimeZone } from "@/lib/school-date"
import {
  scheduleDayFromSchoolDate,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import {
  DEFAULT_TIME_PROFILE_KEY,
  DEFAULT_TIME_SLOTS,
  currentSlot,
  orderedSlots,
  validateTimeStructure,
  type CurrentSlotResult,
  type TimeSlot,
  type TimeSlotInput,
} from "@/lib/schedule-time"
import {
  findConflictsAgainst,
  summarizeDiff,
  diffSchedule,
  type ScheduleEntryShape,
} from "@/lib/schedule-diff"

/**
 * Role kanonik yang menentukan seseorang adalah GURU untuk modul ini.
 *
 * Key, bukan nama tampilan: nama role boleh diubah admin dan boleh berduplikat,
 * sehingga mencocokkan "Guru" sebagai teks akan ikut menangkap role lain yang
 * kebetulan bernama sama. Role lama `legacy_guru` sengaja TIDAK disertakan —
 * migrasi keanggotaannya dikerjakan terpisah dan di luar modul ini.
 */
export const TEACHER_ROLE_KEY = "guru"

export type ScheduleTeacher = {
  readonly id: string
  readonly name: string
}

/**
 * Populasi guru untuk modul Jadwal.
 *
 * Tiga syarat, ketiganya wajib:
 *   1. memegang role dengan key `guru` (otorisasi/identitas peran);
 *   2. tertaut Data Master Guru (`User.isTeacher` — identitas bisnis);
 *   3. akun aktif.
 *
 * Konsekuensi yang disengaja: akun yang hanya memegang `legacy_guru` tidak
 * dihitung, dan baris Data Master Guru tanpa role `guru` juga tidak. Daftar
 * guru tidak pernah diambil dari `<teacher>` di XML.
 */
export async function listScheduleTeachers(): Promise<ScheduleTeacher[]> {
  const teachers = await prisma.user.findMany({
    where: {
      ...teacherPopulationWhere(),
      active: true,
      rbacRoles: { some: { role: { key: TEACHER_ROLE_KEY } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  return teachers
}

/** Apakah akun ini termasuk populasi guru modul Jadwal. */
export async function isScheduleTeacher(userId: string): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: {
      id: userId,
      ...teacherPopulationWhere(),
      active: true,
      rbacRoles: { some: { role: { key: TEACHER_ROLE_KEY } } },
    },
    select: { id: true },
  })
  return found !== null
}

// ---------------------------------------------------------------------------
// Profil waktu
// ---------------------------------------------------------------------------

export type ScheduleTimeProfileView = {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly active: boolean
  readonly slots: readonly TimeSlot[]
}

function toTimeSlot(row: {
  id: string
  position: number
  kind: string
  name: string
  startMinute: number
  endMinute: number
  ascPeriod: number | null
}): TimeSlot {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind as TimeSlot["kind"],
    name: row.name,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    ascPeriod: row.ascPeriod,
  }
}

/**
 * Profil waktu aktif, dibuat dengan nilai bawaan bila sekolah belum pernah
 * menyetelnya.
 *
 * Pembuatan otomatis di sini aman dan disengaja: tanpa satu pun slot, seluruh
 * modul tidak dapat menerjemahkan nomor jam menjadi pukul, dan halaman akan
 * kosong tanpa penjelasan. Yang dibuat hanyalah struktur waktu — tidak ada
 * jadwal, guru, maupun kelas yang dikarang.
 */
export async function ensureActiveTimeProfile(): Promise<ScheduleTimeProfileView> {
  const existing = await prisma.scheduleTimeProfile.findFirst({
    where: { active: true },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (existing) {
    return {
      id: existing.id,
      key: existing.key,
      name: existing.name,
      active: existing.active,
      slots: existing.slots.map(toTimeSlot),
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    // Profil boleh sudah ada tetapi non-aktif (mis. dibuat lalu dinonaktifkan);
    // dalam hal itu ia diaktifkan kembali, bukan diduplikasi.
    const reusable = await tx.scheduleTimeProfile.findUnique({
      where: { key: DEFAULT_TIME_PROFILE_KEY },
      include: { slots: true },
    })

    if (reusable) {
      await tx.scheduleTimeProfile.updateMany({ where: { active: true }, data: { active: false } })
      await tx.scheduleTimeProfile.update({ where: { id: reusable.id }, data: { active: true } })
      return tx.scheduleTimeProfile.findUniqueOrThrow({
        where: { id: reusable.id },
        include: { slots: { orderBy: { position: "asc" } } },
      })
    }

    await tx.scheduleTimeProfile.updateMany({ where: { active: true }, data: { active: false } })
    return tx.scheduleTimeProfile.create({
      data: {
        key: DEFAULT_TIME_PROFILE_KEY,
        name: "Reguler",
        active: true,
        slots: { create: DEFAULT_TIME_SLOTS.map((slot) => ({ ...slot })) },
      },
      include: { slots: { orderBy: { position: "asc" } } },
    })
  })

  return {
    id: created.id,
    key: created.key,
    name: created.name,
    active: created.active,
    slots: created.slots.map(toTimeSlot),
  }
}

export async function listTimeProfiles(): Promise<readonly ScheduleTimeProfileView[]> {
  const profiles = await prisma.scheduleTimeProfile.findMany({
    include: { slots: { orderBy: { position: "asc" } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })
  return profiles.map((profile) => ({
    id: profile.id,
    key: profile.key,
    name: profile.name,
    active: profile.active,
    slots: profile.slots.map(toTimeSlot),
  }))
}

/**
 * Mengganti SELURUH struktur satu profil dalam satu transaksi.
 *
 * Penggantian utuh dipilih daripada patch per baris karena aturan yang dijaga
 * (urutan unik, period unik, tanpa tumpang tindih) berlaku atas himpunan, bukan
 * atas baris tunggal — memvalidasi satu baris saja akan selalu membiarkan
 * keadaan antara yang tidak sah.
 */
export async function replaceTimeSlots(input: {
  readonly profileId: string
  readonly slots: readonly TimeSlotInput[]
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  const problems = validateTimeStructure(input.slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const profile = await prisma.scheduleTimeProfile.findUnique({
    where: { id: input.profileId },
    include: { slots: true },
  })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")

  const before = orderedSlots(profile.slots.map(toTimeSlot))

  const updated = await prisma.$transaction(async (tx) => {
    await tx.scheduleTimeSlot.deleteMany({ where: { profileId: profile.id } })
    await tx.scheduleTimeSlot.createMany({
      data: input.slots.map((slot) => ({
        profileId: profile.id,
        position: slot.position,
        kind: slot.kind,
        name: slot.name.trim(),
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        ascPeriod: slot.ascPeriod,
      })),
    })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_SLOTS_UPDATED",
        entity: "ScheduleTimeProfile",
        entityId: profile.id,
        summary: `Struktur waktu "${profile.name}": ${before.length} → ${input.slots.length} slot`,
        before: before as unknown as Prisma.InputJsonValue,
        after: input.slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { slots: { orderBy: { position: "asc" } } },
    })
  })

  return {
    id: updated.id,
    key: updated.key,
    name: updated.name,
    active: updated.active,
    slots: updated.slots.map(toTimeSlot),
  }
}

// ---------------------------------------------------------------------------
// Revisi dan penempatan
// ---------------------------------------------------------------------------

export type ScheduleRevisionView = {
  readonly id: string
  readonly number: number
  readonly source: "ASC_IMPORT" | "MANUAL" | "ROLLBACK"
  readonly active: boolean
  readonly note: string | null
  readonly summary: unknown
  readonly createdAt: Date
  readonly createdByName: string | null
  readonly entryCount: number
}

/**
 * Revisi aktif, dibuat kosong bila belum ada.
 *
 * Revisi kosong lebih jujur daripada ketiadaan revisi: suntingan manual pertama
 * memerlukan wadah, dan membuatnya saat itu juga akan membuat nomor versi
 * melompat tanpa alasan yang terlihat.
 */
export async function ensureActiveRevision(actorId: string | null): Promise<{ id: string; number: number }> {
  const active = await prisma.scheduleRevision.findFirst({
    where: { active: true },
    select: { id: true, number: true },
  })
  if (active) return active

  return prisma.$transaction(async (tx) => {
    const again = await tx.scheduleRevision.findFirst({ where: { active: true }, select: { id: true, number: true } })
    if (again) return again

    const latest = await tx.scheduleRevision.findFirst({ orderBy: { number: "desc" }, select: { number: true } })
    await tx.scheduleRevision.updateMany({ where: { active: true }, data: { active: false } })
    const created = await tx.scheduleRevision.create({
      data: {
        number: (latest?.number ?? 0) + 1,
        source: "MANUAL",
        active: true,
        note: "Jadwal awal",
        createdById: actorId,
      },
      select: { id: true, number: true },
    })
    return created
  })
}

export async function listRevisions(limit = 30): Promise<readonly ScheduleRevisionView[]> {
  const revisions = await prisma.scheduleRevision.findMany({
    orderBy: { number: "desc" },
    take: limit,
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { entries: true } },
    },
  })

  return revisions.map((revision) => ({
    id: revision.id,
    number: revision.number,
    source: revision.source,
    active: revision.active,
    note: revision.note,
    summary: revision.summary,
    createdAt: revision.createdAt,
    createdByName: revision.createdBy?.name ?? null,
    entryCount: revision._count.entries,
  }))
}

export type ScheduleEntryView = {
  readonly id: string
  readonly day: number
  readonly period: number
  readonly classId: string
  readonly className: string
  readonly subjectId: string
  readonly subjectName: string
  readonly teacherId: string | null
  readonly teacherName: string | null
  readonly room: string | null
}

const ENTRY_SELECT = {
  id: true,
  day: true,
  period: true,
  classId: true,
  subjectId: true,
  teacherId: true,
  room: true,
  schoolClass: { select: { name: true } },
  subject: { select: { name: true } },
  teacher: { select: { name: true } },
} as const

type EntryRow = {
  id: string
  day: number
  period: number
  classId: string
  subjectId: string
  teacherId: string | null
  room: string | null
  schoolClass: { name: string }
  subject: { name: string }
  teacher: { name: string } | null
}

function toEntryView(row: EntryRow): ScheduleEntryView {
  return {
    id: row.id,
    day: row.day,
    period: row.period,
    classId: row.classId,
    className: row.schoolClass.name,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    teacherId: row.teacherId,
    teacherName: row.teacher?.name ?? null,
    room: row.room,
  }
}

/** Seluruh penempatan pada revisi aktif; `[]` bila belum ada revisi. */
export async function readActiveEntries(filter?: {
  readonly teacherId?: string
  readonly classId?: string
  readonly day?: number
}): Promise<readonly ScheduleEntryView[]> {
  const revision = await prisma.scheduleRevision.findFirst({ where: { active: true }, select: { id: true } })
  if (!revision) return []

  const rows = await prisma.scheduleEntry.findMany({
    where: {
      revisionId: revision.id,
      ...(filter?.teacherId ? { teacherId: filter.teacherId } : {}),
      ...(filter?.classId ? { classId: filter.classId } : {}),
      ...(filter?.day ? { day: filter.day } : {}),
    },
    select: ENTRY_SELECT,
    orderBy: [{ day: "asc" }, { period: "asc" }],
  })

  return rows.map(toEntryView)
}

/** Bentuk murni untuk deteksi bentrok; entri tanpa guru tidak pernah bentrok guru. */
function toShape(entry: ScheduleEntryView): ScheduleEntryShape {
  return {
    id: entry.id,
    day: entry.day,
    period: entry.period,
    classId: entry.classId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId ?? "",
    room: entry.room,
  }
}

export type ScheduleEntryInput = {
  readonly day: number
  readonly period: number
  readonly classId: string
  readonly subjectId: string
  readonly teacherId: string | null
  readonly room: string | null
}

/**
 * Memastikan setiap ID yang dikirim klien benar-benar merujuk entity yang ada
 * DAN sah untuk perannya. Tanpa ini, payload dapat menautkan jadwal ke akun
 * mana pun, termasuk yang bukan guru.
 */
async function assertEntityReferences(input: ScheduleEntryInput): Promise<void> {
  const [schoolClass, subject] = await Promise.all([
    prisma.schoolClass.findUnique({ where: { id: input.classId }, select: { id: true } }),
    prisma.subject.findUnique({ where: { id: input.subjectId }, select: { id: true } }),
  ])
  if (!schoolClass) throw new ApiError(422, "Kelas tidak ditemukan")
  if (!subject) throw new ApiError(422, "Mata pelajaran tidak ditemukan")

  if (input.teacherId && !(await isScheduleTeacher(input.teacherId))) {
    throw new ApiError(422, "Guru tidak ditemukan atau tidak memiliki role guru")
  }
}

async function assertNoConflict(
  revisionId: string,
  candidate: ScheduleEntryShape,
): Promise<void> {
  const rows = await prisma.scheduleEntry.findMany({
    where: { revisionId, day: candidate.day, period: candidate.period },
    select: ENTRY_SELECT,
  })
  const existing = rows.map(toEntryView).map(toShape)
  const conflicts = findConflictsAgainst(existing, candidate)
  if (conflicts.length > 0) throw new ApiError(409, conflicts[0].message)
}

export async function createEntry(input: ScheduleEntryInput, actorId: string): Promise<ScheduleEntryView> {
  await assertEntityReferences(input)
  const revision = await ensureActiveRevision(actorId)

  await assertNoConflict(revision.id, {
    day: input.day,
    period: input.period,
    classId: input.classId,
    subjectId: input.subjectId,
    teacherId: input.teacherId ?? "",
    room: input.room,
  })

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleEntry.create({
      data: {
        revisionId: revision.id,
        day: input.day,
        period: input.period,
        classId: input.classId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        room: input.room,
      },
      select: ENTRY_SELECT,
    })

    await recordAuditLog(
      {
        actorId,
        action: "SCHEDULE_ENTRY_CREATED",
        entity: "ScheduleEntry",
        entityId: row.id,
        summary: `Tambah jadwal ${row.schoolClass.name} hari ${input.day} jam ke-${input.period}`,
        after: toEntryView(row) as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return row
  })

  return toEntryView(created)
}

export async function updateEntry(
  entryId: string,
  input: ScheduleEntryInput,
  actorId: string,
): Promise<ScheduleEntryView> {
  await assertEntityReferences(input)

  const current = await prisma.scheduleEntry.findUnique({ where: { id: entryId }, select: ENTRY_SELECT })
  if (!current) throw new ApiError(404, "Jadwal tidak ditemukan")

  const revision = await prisma.scheduleEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: { revisionId: true, revision: { select: { active: true } } },
  })
  // Revisi lama adalah riwayat. Menyuntingnya akan mengubah masa lalu dan
  // membuat rollback mengembalikan sesuatu yang tidak pernah benar-benar ada.
  if (!revision.revision.active) throw new ApiError(409, "Hanya jadwal aktif yang dapat diubah")

  await assertNoConflict(revision.revisionId, {
    id: entryId,
    day: input.day,
    period: input.period,
    classId: input.classId,
    subjectId: input.subjectId,
    teacherId: input.teacherId ?? "",
    room: input.room,
  })

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleEntry.update({
      where: { id: entryId },
      data: {
        day: input.day,
        period: input.period,
        classId: input.classId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        room: input.room,
      },
      select: ENTRY_SELECT,
    })

    await recordAuditLog(
      {
        actorId,
        action: "SCHEDULE_ENTRY_UPDATED",
        entity: "ScheduleEntry",
        entityId: entryId,
        summary: `Ubah jadwal ${row.schoolClass.name} hari ${input.day} jam ke-${input.period}`,
        before: toEntryView(current) as unknown as Prisma.InputJsonValue,
        after: toEntryView(row) as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return row
  })

  return toEntryView(updated)
}

export async function deleteEntry(entryId: string, actorId: string): Promise<void> {
  const current = await prisma.scheduleEntry.findUnique({
    where: { id: entryId },
    select: { ...ENTRY_SELECT, revision: { select: { active: true } } },
  })
  if (!current) throw new ApiError(404, "Jadwal tidak ditemukan")
  if (!current.revision.active) throw new ApiError(409, "Hanya jadwal aktif yang dapat diubah")

  await prisma.$transaction(async (tx) => {
    await tx.scheduleEntry.delete({ where: { id: entryId } })
    await recordAuditLog(
      {
        actorId,
        action: "SCHEDULE_ENTRY_DELETED",
        entity: "ScheduleEntry",
        entityId: entryId,
        summary: `Hapus jadwal ${current.schoolClass.name} hari ${current.day} jam ke-${current.period}`,
        before: toEntryView(current) as unknown as Prisma.InputJsonValue,
      },
      tx,
    )
  })
}

/**
 * Rollback: menyalin isi sebuah revisi menjadi REVISI BARU yang aktif.
 *
 * Revisi lama tidak pernah diaktifkan ulang dan tidak pernah dihapus, sehingga
 * "Versi 6 = salinan Versi 3" tetap terbaca di riwayat dan nomor versi tidak
 * pernah mundur.
 */
export async function rollbackToRevision(revisionId: string, actorId: string): Promise<ScheduleRevisionView> {
  const source = await prisma.scheduleRevision.findUnique({
    where: { id: revisionId },
    include: { entries: true },
  })
  if (!source) throw new ApiError(404, "Versi jadwal tidak ditemukan")
  if (source.active) throw new ApiError(409, "Versi ini sudah menjadi jadwal aktif")

  const created = await prisma.$transaction(async (tx) => {
    const latest = await tx.scheduleRevision.findFirst({ orderBy: { number: "desc" }, select: { number: true } })
    await tx.scheduleRevision.updateMany({ where: { active: true }, data: { active: false } })

    const revision = await tx.scheduleRevision.create({
      data: {
        number: (latest?.number ?? 0) + 1,
        source: "ROLLBACK",
        active: true,
        note: `Pengembalian dari Versi ${source.number}`,
        summary: { rolledBackFrom: source.number, entryCount: source.entries.length },
        createdById: actorId,
      },
    })

    if (source.entries.length > 0) {
      await tx.scheduleEntry.createMany({
        data: source.entries.map((entry) => ({
          revisionId: revision.id,
          day: entry.day,
          period: entry.period,
          classId: entry.classId,
          subjectId: entry.subjectId,
          teacherId: entry.teacherId,
          room: entry.room,
        })),
      })
    }

    await recordAuditLog(
      {
        actorId,
        action: "SCHEDULE_REVISION_ROLLED_BACK",
        entity: "ScheduleRevision",
        entityId: revision.id,
        summary: `Kembali ke Versi ${source.number} (${source.entries.length} penempatan) sebagai Versi ${revision.number}`,
      },
      tx,
    )

    return revision
  })

  return {
    id: created.id,
    number: created.number,
    source: created.source,
    active: created.active,
    note: created.note,
    summary: created.summary,
    createdAt: created.createdAt,
    createdByName: null,
    entryCount: source.entries.length,
  }
}

// ---------------------------------------------------------------------------
// Konteks tampilan
// ---------------------------------------------------------------------------

export type ScheduleNowContext = {
  readonly timeZone: string
  readonly today: string
  /** Hari sekolah hari ini; `null` pada hari Minggu. */
  readonly todayDay: ScheduleDay | null
  readonly minuteOfDay: number
  readonly current: CurrentSlotResult
}

/**
 * "Hari ini" dan "sekarang jam ke berapa", keduanya diproyeksikan ke zona waktu
 * sekolah yang tersimpan di setelan — tidak ada `Asia/Jakarta` yang ditanam di
 * modul ini dan tidak ada jam yang dihitung dari waktu server.
 */
export async function readNowContext(slots: readonly TimeSlot[], now = new Date()): Promise<ScheduleNowContext> {
  const timeZone = await readSchoolTimeZone()
  const today = todayInSchoolTimeZone(now, timeZone)
  const minuteOfDay = schoolMinutesOfDay(now, timeZone)

  return {
    timeZone,
    today,
    todayDay: scheduleDayFromSchoolDate(today),
    minuteOfDay,
    current: currentSlot(slots, minuteOfDay),
  }
}

export type ScheduleMasterData = {
  readonly classes: readonly { id: string; name: string; grade: string }[]
  readonly subjects: readonly { id: string; name: string }[]
  readonly teachers: readonly ScheduleTeacher[]
}

/** Data master untuk combobox editor manual dan pemetaan impor. */
export async function readScheduleMasterData(): Promise<ScheduleMasterData> {
  const [classes, subjects, teachers] = await Promise.all([
    prisma.schoolClass.findMany({ select: { id: true, name: true, grade: true }, orderBy: { name: "asc" } }),
    prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listScheduleTeachers(),
  ])
  return { classes, subjects, teachers }
}

/** Selisih ringkas antara revisi aktif dan sekumpulan penempatan calon. */
export async function summarizeAgainstActive(next: readonly ScheduleEntryShape[]) {
  const current = (await readActiveEntries()).map(toShape)
  return summarizeDiff(diffSchedule(current, next))
}
