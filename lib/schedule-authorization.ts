/**
 * Permission modul Jadwal dan pemetaannya ke kemampuan UI.
 *
 * CLIENT-SAFE: mengikuti pola `lib/sarpras-authorization.ts` supaya komponen
 * klien dapat menyembunyikan tab/tombol dari grant yang sama yang ditegakkan
 * server — tanpa menarik Prisma ke bundel peramban.
 *
 * Menyembunyikan tab BUKAN pengamanan. Setiap route handler memanggil
 * `requirePermission()` dengan key yang sama seperti di sini.
 */

/**
 * Key yang dijaga tiap route, dikelompokkan per resource.
 *
 * Satu-satunya tempat pasangan route↔permission modul ini ditulis, sehingga
 * tidak ada handler yang mengarang key sendiri.
 */
export const SCHEDULE_ROUTE_PERMISSIONS = {
  ownSchedule: { GET: "schedule.own.read" },
  teacherSchedule: { GET: "schedule.teachers.read" },
  classSchedule: { GET: "schedule.classes.read" },
  freeTeachers: { GET: "schedule.free_teachers.read" },
  entries: {
    POST: "schedule.entries.create",
    PATCH: "schedule.entries.update",
    DELETE: "schedule.entries.delete",
  },
  timeSlots: {
    GET: "schedule.own.read",
    POST: "schedule.time.manage",
    PATCH: "schedule.time.manage",
    DELETE: "schedule.time.manage",
  },
  imports: {
    GET: "schedule.import",
    POST: "schedule.import",
    PATCH: "schedule.import",
    DELETE: "schedule.import",
  },
  mappings: { GET: "schedule.import", PATCH: "schedule.import" },
  revisions: { GET: "schedule.revisions.read", POST: "schedule.revisions.rollback" },
} as const

export type ScheduleRuntimePermission =
  | "schedule.own.read"
  | "schedule.classes.read"
  | "schedule.free_teachers.read"
  | "schedule.teachers.read"
  | "schedule.entries.create"
  | "schedule.entries.update"
  | "schedule.entries.delete"
  | "schedule.time.manage"
  | "schedule.import"
  | "schedule.revisions.read"
  | "schedule.revisions.rollback"

/**
 * Permission mana pun yang membuat menu "Jadwal" layak tampil dan halamannya
 * boleh dibuka. Dipakai bersama oleh `lib/nav.ts` dan guard halaman supaya
 * keduanya tidak pernah berbeda pendapat.
 */
export const SCHEDULE_PAGE_PERMISSIONS: readonly ScheduleRuntimePermission[] = [
  "schedule.own.read",
  "schedule.classes.read",
  "schedule.free_teachers.read",
  "schedule.teachers.read",
  "schedule.entries.create",
  "schedule.entries.update",
  "schedule.entries.delete",
  "schedule.time.manage",
  "schedule.import",
  "schedule.revisions.read",
]

export function scheduleCapabilitiesFromGrants(grants: ReadonlySet<string>) {
  const has = (permission: ScheduleRuntimePermission) => grants.has(permission)

  const entries = {
    create: has("schedule.entries.create"),
    update: has("schedule.entries.update"),
    delete: has("schedule.entries.delete"),
  }

  return {
    ownRead: has("schedule.own.read"),
    classRead: has("schedule.classes.read"),
    freeTeachersRead: has("schedule.free_teachers.read"),
    /// Melihat jadwal guru LAIN. Jadwal sendiri tidak membutuhkan ini.
    teacherRead: has("schedule.teachers.read"),
    entries,
    /// Tab "Kelola Jadwal" tampil bila ada satu saja kewenangan pengelolaan.
    manage: entries.create || entries.update || entries.delete,
    timeManage: has("schedule.time.manage"),
    import: has("schedule.import"),
    revisionsRead: has("schedule.revisions.read"),
    rollback: has("schedule.revisions.rollback"),
  }
}

export type ScheduleCapabilities = ReturnType<typeof scheduleCapabilitiesFromGrants>

/** Tab yang benar-benar boleh dibuka pemakai ini, urut seperti di layar. */
export const SCHEDULE_TABS = ["saya", "kelas", "jam-kosong", "kelola", "waktu"] as const

export type ScheduleTab = (typeof SCHEDULE_TABS)[number]

export const SCHEDULE_TAB_LABELS: Record<ScheduleTab, string> = {
  saya: "Jadwal Saya",
  kelas: "Jadwal Kelas",
  "jam-kosong": "Jam Kosong Guru",
  kelola: "Kelola Jadwal",
  waktu: "Waktu & Kegiatan",
}

export function visibleScheduleTabs(capabilities: ScheduleCapabilities): ScheduleTab[] {
  const tabs: ScheduleTab[] = []
  // "Jadwal Saya" juga melayani pemakai non-guru yang berhak melihat jadwal
  // guru lain: bagi mereka tab ini adalah pencarian jadwal per guru.
  if (capabilities.ownRead || capabilities.teacherRead) tabs.push("saya")
  if (capabilities.classRead) tabs.push("kelas")
  if (capabilities.freeTeachersRead) tabs.push("jam-kosong")
  if (capabilities.manage || capabilities.import || capabilities.revisionsRead) tabs.push("kelola")
  if (capabilities.timeManage) tabs.push("waktu")
  return tabs
}
