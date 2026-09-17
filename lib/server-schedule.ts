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
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import {
  DEFAULT_PROFILE_DAYS,
  DEFAULT_TIME_PROFILE_KEY,
  DEFAULT_TIME_SLOTS,
  currentSlot,
  findProfileDay,
  orderedDays,
  orderedSlots,
  representativeSlots,
  snapshotSlots,
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
// Profil waktu, hari, dan template
// ---------------------------------------------------------------------------

/**
 * Sebuah profil waktu beserta konfigurasi TIAP HARI-nya.
 *
 * `days` adalah otoritas jam dinding. Tidak ada lagi "struktur profil" generik:
 * pertanyaan "jam ke-4 pukul berapa" hanya dapat dijawab bersama sebuah hari.
 */
export type ScheduleProfileDayView = {
  readonly id: string
  readonly day: number
  readonly position: number
  readonly slots: readonly TimeSlot[]
}

export type ScheduleTimeProfileView = {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly active: boolean
  readonly days: readonly ScheduleProfileDayView[]
  /**
   * Struktur satu hari yang mewakili profil, untuk tampilan lintas-hari (grid
   * sepekan, pemilih jam). Turunan dari `days`, bukan sumber kebenaran.
   */
  readonly slots: readonly TimeSlot[]
}

export type ScheduleTimeTemplateView = {
  readonly id: string
  readonly name: string
  readonly updatedAt: string
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

type ProfileWithDays = {
  id: string
  key: string
  name: string
  active: boolean
  days: {
    id: string
    day: number
    position: number
    slots: {
      id: string
      position: number
      kind: string
      name: string
      startMinute: number
      endMinute: number
      ascPeriod: number | null
    }[]
  }[]
}

function toProfileView(profile: ProfileWithDays): ScheduleTimeProfileView {
  const days = orderedDays(
    profile.days.map((day) => ({
      id: day.id,
      day: day.day,
      position: day.position,
      slots: orderedSlots(day.slots.map(toTimeSlot)),
    })),
  )

  return {
    id: profile.id,
    key: profile.key,
    name: profile.name,
    active: profile.active,
    days,
    slots: representativeSlots(days),
  }
}

/** Bentuk `include` yang selalu dipakai supaya semua pembaca melihat data yang sama. */
const profileInclude = {
  days: {
    orderBy: { position: "asc" as const },
    include: { slots: { orderBy: { position: "asc" as const } } },
  },
}

/**
 * Profil waktu aktif beserta hari-harinya, dibuat dengan nilai bawaan bila
 * sekolah belum pernah menyetelnya.
 *
 * Pembuatan otomatis di sini aman dan disengaja: tanpa satu pun slot, seluruh
 * modul tidak dapat menerjemahkan nomor jam menjadi pukul, dan halaman akan
 * kosong tanpa penjelasan. Yang dibuat hanyalah struktur waktu — tidak ada
 * jadwal, guru, maupun kelas yang dikarang.
 */
export async function ensureActiveTimeProfile(): Promise<ScheduleTimeProfileView> {
  const existing = await prisma.scheduleTimeProfile.findFirst({
    where: { active: true },
    include: profileInclude,
  })
  if (existing && existing.days.length > 0) return toProfileView(existing)

  const created = await prisma.$transaction(async (tx) => {
    // Profil boleh sudah ada tetapi non-aktif (mis. dibuat lalu dinonaktifkan);
    // dalam hal itu ia diaktifkan kembali, bukan diduplikasi.
    const reusable =
      existing ??
      (await tx.scheduleTimeProfile.findUnique({ where: { key: DEFAULT_TIME_PROFILE_KEY } }))

    const profileId = reusable
      ? reusable.id
      : (
          await tx.scheduleTimeProfile.create({
            data: { key: DEFAULT_TIME_PROFILE_KEY, name: "Reguler", active: false },
            select: { id: true },
          })
        ).id

    await tx.scheduleTimeProfile.updateMany({ where: { active: true }, data: { active: false } })
    await tx.scheduleTimeProfile.update({ where: { id: profileId }, data: { active: true } })

    // Hari yang belum ada diisi struktur bawaan. Hari yang SUDAH ada tidak
    // pernah ditimpa — profil lama hanya kekurangan hari, bukan salah isi.
    const presentDays = new Set(
      (
        await tx.scheduleProfileDay.findMany({ where: { profileId }, select: { day: true } })
      ).map((row) => row.day),
    )

    for (const day of DEFAULT_PROFILE_DAYS) {
      if (presentDays.has(day)) continue
      await tx.scheduleProfileDay.create({
        data: {
          profileId,
          day,
          position: day,
          slots: {
            create: DEFAULT_TIME_SLOTS.map((slot) => ({ ...slot, profileId })),
          },
        },
      })
    }

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profileId }, include: profileInclude })
  })

  return toProfileView(created)
}

export async function listTimeProfiles(): Promise<readonly ScheduleTimeProfileView[]> {
  const profiles = await prisma.scheduleTimeProfile.findMany({
    include: profileInclude,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })
  return profiles.map(toProfileView)
}

/** Konfigurasi satu hari, dipastikan milik profil yang diminta. */
async function requireProfileDay(profileId: string, day: number) {
  const config = await prisma.scheduleProfileDay.findUnique({
    where: { profileId_day: { profileId, day } },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (!config) throw new ApiError(404, `Hari ${scheduleDayLabel(day)} belum dikonfigurasi pada profil ini`)
  return config
}

/**
 * Mengganti SELURUH struktur satu HARI dalam satu transaksi.
 *
 * Penggantian utuh dipilih daripada patch per baris karena aturan yang dijaga
 * (urutan unik, period unik, tanpa tumpang tindih) berlaku atas himpunan, bukan
 * atas baris tunggal — memvalidasi satu baris saja akan selalu membiarkan
 * keadaan antara yang tidak sah.
 *
 * Perubahan hanya menyentuh hari ini; hari lain pada profil yang sama tidak
 * pernah ikut berubah.
 */
export async function replaceDaySlots(input: {
  readonly profileId: string
  readonly day: number
  readonly slots: readonly TimeSlotInput[]
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  const problems = validateTimeStructure(input.slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const profile = await prisma.scheduleTimeProfile.findUnique({ where: { id: input.profileId } })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")

  const config = await requireProfileDay(profile.id, input.day)
  const before = orderedSlots(config.slots.map(toTimeSlot))

  const updated = await prisma.$transaction(async (tx) => {
    await writeDaySlots(tx, { profileId: profile.id, dayId: config.id, slots: input.slots })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_SLOTS_UPDATED",
        entity: "ScheduleProfileDay",
        entityId: config.id,
        summary: `Struktur waktu "${profile.name}" ${scheduleDayLabel(input.day)}: ${before.length} → ${input.slots.length} slot`,
        before: before as unknown as Prisma.InputJsonValue,
        after: input.slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
  })

  return toProfileView(updated)
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Delete-lalu-insert isi satu hari. SELALU dipanggil di dalam transaksi supaya
 * tidak pernah ada keadaan "baris lama sudah hilang, baris baru belum ada".
 */
async function writeDaySlots(
  tx: TransactionClient,
  input: { profileId: string; dayId: string; slots: readonly TimeSlotInput[] },
): Promise<void> {
  await tx.scheduleTimeSlot.deleteMany({ where: { dayId: input.dayId } })
  if (input.slots.length === 0) return
  await tx.scheduleTimeSlot.createMany({
    data: input.slots.map((slot) => ({
      profileId: input.profileId,
      dayId: input.dayId,
      position: slot.position,
      kind: slot.kind,
      name: slot.name.trim(),
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      ascPeriod: slot.ascPeriod,
    })),
  })
}

/** Menambahkan satu hari ke profil. Hari baru selalu dimulai kosong. */
export async function addProfileDay(input: {
  readonly profileId: string
  readonly day: number
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  const profile = await prisma.scheduleTimeProfile.findUnique({
    where: { id: input.profileId },
    include: { days: { select: { day: true, position: true } } },
  })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")
  if (profile.days.some((row) => row.day === input.day)) {
    throw new ApiError(409, `${scheduleDayLabel(input.day)} sudah ada pada profil ini`)
  }

  const nextPosition = profile.days.reduce((max, row) => Math.max(max, row.position), 0) + 1

  const updated = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleProfileDay.create({
      data: { profileId: profile.id, day: input.day, position: nextPosition },
      select: { id: true },
    })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_PROFILE_DAY_ADDED",
        entity: "ScheduleProfileDay",
        entityId: created.id,
        summary: `Hari ${scheduleDayLabel(input.day)} ditambahkan pada profil "${profile.name}"`,
        after: { day: input.day, position: nextPosition } as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
  })

  return toProfileView(updated)
}

/**
 * Menghapus satu hari beserta strukturnya.
 *
 * Penempatan jadwal (`ScheduleEntry`) pada hari itu TIDAK ikut dihapus: jadwal
 * dan struktur waktu adalah dua hal berbeda, dan menghapus jadwal diam-diam
 * lewat menu struktur waktu akan menjadi kehilangan data yang tidak diminta.
 */
export async function removeProfileDay(input: {
  readonly profileId: string
  readonly day: number
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  const profile = await prisma.scheduleTimeProfile.findUnique({
    where: { id: input.profileId },
    include: { days: { select: { id: true, day: true } } },
  })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")
  if (profile.days.length <= 1) {
    throw new ApiError(422, "Profil waktu harus memiliki minimal satu hari")
  }

  const config = await requireProfileDay(profile.id, input.day)

  const updated = await prisma.$transaction(async (tx) => {
    await tx.scheduleProfileDay.delete({ where: { id: config.id } })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_PROFILE_DAY_REMOVED",
        entity: "ScheduleProfileDay",
        entityId: config.id,
        summary: `Hari ${scheduleDayLabel(input.day)} dihapus dari profil "${profile.name}" (${config.slots.length} slot)`,
        before: orderedSlots(config.slots.map(toTimeSlot)) as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
  })

  return toProfileView(updated)
}

/**
 * Menyalin struktur satu hari ke hari lain pada profil yang sama.
 *
 * Hasilnya SALINAN: mengubah hari sumber setelah ini tidak pernah mengubah hari
 * tujuan, karena yang dibuat adalah baris baru, bukan referensi.
 */
export async function copyDayStructure(input: {
  readonly profileId: string
  readonly fromDay: number
  readonly toDay: number
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  if (input.fromDay === input.toDay) {
    throw new ApiError(422, "Hari sumber dan hari tujuan tidak boleh sama")
  }

  const profile = await prisma.scheduleTimeProfile.findUnique({ where: { id: input.profileId } })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")

  const source = await requireProfileDay(profile.id, input.fromDay)
  const target = await requireProfileDay(profile.id, input.toDay)

  const slots = snapshotSlots(source.slots.map(toTimeSlot))
  const problems = validateTimeStructure(slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const before = orderedSlots(target.slots.map(toTimeSlot))

  const updated = await prisma.$transaction(async (tx) => {
    await writeDaySlots(tx, { profileId: profile.id, dayId: target.id, slots })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_DAY_COPIED",
        entity: "ScheduleProfileDay",
        entityId: target.id,
        summary: `Struktur ${scheduleDayLabel(input.fromDay)} disalin ke ${scheduleDayLabel(input.toDay)} pada profil "${profile.name}"`,
        before: before as unknown as Prisma.InputJsonValue,
        after: slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
  })

  return toProfileView(updated)
}

// ---------------------------------------------------------------------------
// Template waktu — SALINAN, bukan referensi hidup
// ---------------------------------------------------------------------------

function toTemplateView(template: {
  id: string
  name: string
  updatedAt: Date
  slots: {
    id: string
    position: number
    kind: string
    name: string
    startMinute: number
    endMinute: number
    ascPeriod: number | null
  }[]
}): ScheduleTimeTemplateView {
  return {
    id: template.id,
    name: template.name,
    updatedAt: template.updatedAt.toISOString(),
    slots: orderedSlots(template.slots.map(toTimeSlot)),
  }
}

export async function listTimeTemplates(): Promise<readonly ScheduleTimeTemplateView[]> {
  const templates = await prisma.scheduleTimeTemplate.findMany({
    include: { slots: { orderBy: { position: "asc" } } },
    orderBy: { name: "asc" },
  })
  return templates.map(toTemplateView)
}

/** Membuat template dari isi apa pun yang sudah lolos validasi struktur. */
export async function createTimeTemplate(input: {
  readonly name: string
  readonly slots: readonly TimeSlotInput[]
  readonly actorId: string
}): Promise<ScheduleTimeTemplateView> {
  const name = input.name.trim()
  if (!name) throw new ApiError(422, "Nama template wajib diisi")

  const slots = snapshotSlots(input.slots as readonly TimeSlot[])
  const problems = validateTimeStructure(slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const existing = await prisma.scheduleTimeTemplate.findUnique({ where: { name } })
  if (existing) throw new ApiError(409, `Template "${name}" sudah ada`)

  const created = await prisma.$transaction(async (tx) => {
    const template = await tx.scheduleTimeTemplate.create({
      data: {
        name,
        slots: {
          create: slots.map((slot) => ({
            position: slot.position,
            kind: slot.kind,
            name: slot.name.trim(),
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
            ascPeriod: slot.ascPeriod,
          })),
        },
      },
      include: { slots: { orderBy: { position: "asc" } } },
    })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_TEMPLATE_CREATED",
        entity: "ScheduleTimeTemplate",
        entityId: template.id,
        summary: `Template waktu "${name}" dibuat (${slots.length} baris)`,
        after: slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return template
  })

  return toTemplateView(created)
}

/**
 * Menyimpan konfigurasi sebuah hari sebagai template.
 *
 * Yang disimpan adalah SNAPSHOT: tidak ada tautan balik ke hari sumber, sehingga
 * mengubah hari itu nanti tidak mengubah template.
 */
export async function createTemplateFromDay(input: {
  readonly profileId: string
  readonly day: number
  readonly name: string
  readonly actorId: string
}): Promise<ScheduleTimeTemplateView> {
  const config = await requireProfileDay(input.profileId, input.day)
  if (config.slots.length === 0) {
    throw new ApiError(422, `${scheduleDayLabel(input.day)} belum memiliki struktur waktu untuk disimpan`)
  }

  return createTimeTemplate({
    name: input.name,
    slots: snapshotSlots(config.slots.map(toTimeSlot)),
    actorId: input.actorId,
  })
}

/** Mengubah nama dan/atau isi template. Tidak pernah menyentuh hari mana pun. */
export async function updateTimeTemplate(input: {
  readonly templateId: string
  readonly name: string
  readonly slots: readonly TimeSlotInput[]
  readonly actorId: string
}): Promise<ScheduleTimeTemplateView> {
  const name = input.name.trim()
  if (!name) throw new ApiError(422, "Nama template wajib diisi")

  const slots = snapshotSlots(input.slots as readonly TimeSlot[])
  const problems = validateTimeStructure(slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const template = await prisma.scheduleTimeTemplate.findUnique({
    where: { id: input.templateId },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (!template) throw new ApiError(404, "Template tidak ditemukan")

  const clash = await prisma.scheduleTimeTemplate.findUnique({ where: { name } })
  if (clash && clash.id !== template.id) throw new ApiError(409, `Template "${name}" sudah ada`)

  const before = orderedSlots(template.slots.map(toTimeSlot))

  const updated = await prisma.$transaction(async (tx) => {
    await tx.scheduleTimeTemplateSlot.deleteMany({ where: { templateId: template.id } })
    await tx.scheduleTimeTemplateSlot.createMany({
      data: slots.map((slot) => ({
        templateId: template.id,
        position: slot.position,
        kind: slot.kind,
        name: slot.name.trim(),
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        ascPeriod: slot.ascPeriod,
      })),
    })
    await tx.scheduleTimeTemplate.update({ where: { id: template.id }, data: { name } })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_TEMPLATE_UPDATED",
        entity: "ScheduleTimeTemplate",
        entityId: template.id,
        summary: `Template waktu "${name}": ${before.length} → ${slots.length} baris`,
        before: before as unknown as Prisma.InputJsonValue,
        after: slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeTemplate.findUniqueOrThrow({
      where: { id: template.id },
      include: { slots: { orderBy: { position: "asc" } } },
    })
  })

  return toTemplateView(updated)
}

export async function duplicateTimeTemplate(input: {
  readonly templateId: string
  readonly actorId: string
}): Promise<ScheduleTimeTemplateView> {
  const template = await prisma.scheduleTimeTemplate.findUnique({
    where: { id: input.templateId },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (!template) throw new ApiError(404, "Template tidak ditemukan")

  // Nama wajib unik; akhiran dinaikkan sampai menemukan yang belum dipakai,
  // bukan menimpa template lain yang kebetulan bernama sama.
  const taken = new Set(
    (await prisma.scheduleTimeTemplate.findMany({ select: { name: true } })).map((row) => row.name),
  )
  let name = `${template.name} (salinan)`
  let counter = 2
  while (taken.has(name)) {
    name = `${template.name} (salinan ${counter})`
    counter += 1
  }

  return createTimeTemplate({
    name,
    slots: snapshotSlots(template.slots.map(toTimeSlot)),
    actorId: input.actorId,
  })
}

/**
 * Menghapus template.
 *
 * Aman menurut desain: tidak ada hari yang menunjuk template, sehingga jadwal
 * hari yang dulu dibuat dari template ini sama sekali tidak tersentuh.
 */
export async function deleteTimeTemplate(input: {
  readonly templateId: string
  readonly actorId: string
}): Promise<void> {
  const template = await prisma.scheduleTimeTemplate.findUnique({
    where: { id: input.templateId },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (!template) throw new ApiError(404, "Template tidak ditemukan")

  await prisma.$transaction(async (tx) => {
    await tx.scheduleTimeTemplate.delete({ where: { id: template.id } })
    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_TEMPLATE_DELETED",
        entity: "ScheduleTimeTemplate",
        entityId: template.id,
        summary: `Template waktu "${template.name}" dihapus (${template.slots.length} baris)`,
        before: orderedSlots(template.slots.map(toTimeSlot)) as unknown as Prisma.InputJsonValue,
      },
      tx,
    )
  })
}

/**
 * Menerapkan template ke sebuah hari: isi template DISALIN, hari lama diganti.
 *
 * Setelah ini hari berdiri sendiri. Mengedit atau menghapus templatenya tidak
 * akan mengubah hari ini lagi.
 */
export async function applyTemplateToDay(input: {
  readonly profileId: string
  readonly day: number
  readonly templateId: string
  readonly actorId: string
}): Promise<ScheduleTimeProfileView> {
  const profile = await prisma.scheduleTimeProfile.findUnique({ where: { id: input.profileId } })
  if (!profile) throw new ApiError(404, "Profil waktu tidak ditemukan")

  const template = await prisma.scheduleTimeTemplate.findUnique({
    where: { id: input.templateId },
    include: { slots: { orderBy: { position: "asc" } } },
  })
  if (!template) throw new ApiError(404, "Template tidak ditemukan")

  const target = await requireProfileDay(profile.id, input.day)
  const slots = snapshotSlots(template.slots.map(toTimeSlot))
  const problems = validateTimeStructure(slots)
  if (problems.length > 0) throw new ApiError(422, problems.join("; "))

  const before = orderedSlots(target.slots.map(toTimeSlot))

  const updated = await prisma.$transaction(async (tx) => {
    await writeDaySlots(tx, { profileId: profile.id, dayId: target.id, slots })

    await recordAuditLog(
      {
        actorId: input.actorId,
        action: "SCHEDULE_TIME_TEMPLATE_APPLIED",
        entity: "ScheduleProfileDay",
        entityId: target.id,
        summary: `Template "${template.name}" diterapkan ke ${scheduleDayLabel(input.day)} pada profil "${profile.name}"`,
        before: before as unknown as Prisma.InputJsonValue,
        after: slots as unknown as Prisma.InputJsonValue,
      },
      tx,
    )

    return tx.scheduleTimeProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
  })

  return toProfileView(updated)
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
export async function readNowContext(
  profile: ScheduleTimeProfileView,
  now = new Date(),
): Promise<ScheduleNowContext> {
  const timeZone = await readSchoolTimeZone()
  const today = todayInSchoolTimeZone(now, timeZone)
  const minuteOfDay = schoolMinutesOfDay(now, timeZone)
  const todayDay = scheduleDayFromSchoolDate(today)

  // "Sekarang jam ke berapa" hanya bermakna terhadap struktur HARI INI. Memakai
  // struktur hari lain akan menghasilkan jam berjalan yang salah pada sekolah
  // yang hari Jumat-nya lebih pendek.
  const todaySlots =
    todayDay === null ? [] : (findProfileDay(profile.days, todayDay)?.slots ?? [])

  return {
    timeZone,
    today,
    todayDay,
    minuteOfDay,
    current: currentSlot(todaySlots, minuteOfDay),
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
