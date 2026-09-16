/**
 * Parser berkas ekspor aSc TimeTables (XML).
 *
 * CLIENT-SAFE dan MURNI: menerima teks XML, mengembalikan struktur terurai.
 * Tidak menyentuh database, berkas, maupun jaringan.
 *
 * Dua keputusan yang menentukan bentuk berkas ini:
 *
 * 1. Penempatan sesungguhnya ada di `<card>`, bukan di `<lesson>`. Satu lesson
 *    dapat memiliki banyak card (beberapa pertemuan per minggu), jadi jadwal
 *    dibangun dari card yang di-resolve balik ke lesson-nya lewat `lessonid` —
 *    tidak pernah dari urutan node.
 *
 * 2. `starttime`/`endtime` milik aSc DIABAIKAN sebagai sumber kebenaran jam.
 *    Jam dinding SISMEPDA berasal dari tab "Waktu & Kegiatan". Nilai aSc hanya
 *    dibawa sebagai informasi tampilan pada pratinjau.
 */

import { XMLParser } from "fast-xml-parser"

export const ASC_SOURCE = "ASC_TIMETABLES"

export type AscEntity = {
  readonly externalId: string
  readonly name: string
  /** Nama pendek aSc, bila ada. Berguna sebagai kandidat pencocokan kedua. */
  readonly shortName: string | null
}

export type AscPeriodInfo = {
  readonly period: number
  readonly name: string | null
  readonly startTime: string | null
  readonly endTime: string | null
}

export type AscPlacement = {
  readonly cardId: string | null
  readonly lessonId: string
  readonly period: number
  /** 1 = Senin .. 6 = Sabtu. */
  readonly day: number
  readonly teacherExternalIds: readonly string[]
  readonly classExternalIds: readonly string[]
  readonly subjectExternalId: string | null
  readonly classroomName: string | null
}

export type AscParseWarning = {
  readonly code:
    | "card_without_lesson"
    | "card_without_period"
    | "card_without_day"
    | "lesson_without_subject"
    | "lesson_without_teacher"
    | "lesson_without_class"
    | "duplicate_placement"
    | "unknown_reference"
  readonly message: string
  readonly count: number
}

export type AscTimetable = {
  readonly teachers: readonly AscEntity[]
  readonly classes: readonly AscEntity[]
  readonly subjects: readonly AscEntity[]
  readonly periods: readonly AscPeriodInfo[]
  readonly placements: readonly AscPlacement[]
  readonly warnings: readonly AscParseWarning[]
}

export class AscParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AscParseError"
  }
}

/**
 * Parser XML dikonfigurasi seketat mungkin.
 *
 * `processEntities: false` mematikan ekspansi entitas, sehingga berkas yang
 * dibuat berbahaya (billion laughs / XXE bergaya entitas) tidak dapat
 * meledakkan memori proses. aSc tidak pernah membutuhkan entitas kustom.
 */
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: false,
    allowBooleanAttributes: true,
    isArray: (name) =>
      ["period", "daysdef", "weeksdef", "termsdef", "subject", "teacher", "class", "group", "classroom", "lesson", "card"].includes(
        name,
      ),
  })
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function attr(node: unknown, name: string): string | null {
  if (typeof node !== "object" || node === null) return null
  const raw = (node as Record<string, unknown>)[`@${name}`]
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  return text === "" ? null : text
}

function readEntities(nodes: unknown[], label: string): AscEntity[] {
  const seen = new Map<string, AscEntity>()
  for (const node of nodes) {
    const externalId = attr(node, "id")
    if (!externalId) continue
    const name = attr(node, "name") ?? attr(node, "short") ?? `${label} ${externalId}`
    // Definisi ganda dengan id sama: yang pertama dipertahankan supaya hasil
    // parse tidak bergantung pada urutan node.
    if (!seen.has(externalId)) {
      seen.set(externalId, { externalId, name, shortName: attr(node, "short") })
    }
  }
  return [...seen.values()]
}

/** "id1,id2" atau "id1 id2" → daftar id, tanpa entri kosong. */
function idList(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

/**
 * Bitmask hari aSc → nomor hari SISMEPDA.
 *
 * aSc menuliskan hari sebagai string biner berposisi, contoh "100000" = hari
 * pertama. Satu card bisa menyala pada beberapa hari sekaligus, dan masing-
 * masing menjadi penempatan tersendiri.
 */
export function daysFromMask(mask: string | null): number[] {
  if (!mask) return []
  const days: number[] = []
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === "1") days.push(index + 1)
  }
  return days
}

function parsePeriodNumber(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

type Bucket = Map<AscParseWarning["code"], { message: string; count: number }>

function warn(bucket: Bucket, code: AscParseWarning["code"], message: string): void {
  const current = bucket.get(code)
  if (current) current.count += 1
  else bucket.set(code, { message, count: 1 })
}

/**
 * Mengurai teks XML aSc.
 *
 * Melempar `AscParseError` hanya untuk kegagalan yang membuat berkas tidak
 * bermakna (XML rusak, tidak ada timetable, tidak ada penempatan sama sekali).
 * Cacat per-baris menjadi `warnings` supaya satu card rusak tidak menggagalkan
 * ribuan card yang sehat.
 */
export function parseAscTimetable(xml: string): AscTimetable {
  if (typeof xml !== "string" || xml.trim() === "") {
    throw new AscParseError("Berkas XML kosong")
  }

  let document: unknown
  try {
    document = createParser().parse(xml)
  } catch (error) {
    throw new AscParseError(`Berkas XML tidak dapat dibaca: ${(error as Error).message}`)
  }

  if (typeof document !== "object" || document === null) {
    throw new AscParseError("Struktur XML tidak dikenali")
  }

  const root = document as Record<string, unknown>
  const timetable = (root["timetable"] ?? root["docroot"] ?? root) as Record<string, unknown>
  if (typeof timetable !== "object" || timetable === null) {
    throw new AscParseError("Elemen <timetable> tidak ditemukan")
  }

  const pick = (container: Record<string, unknown>, group: string, item: string): unknown[] => {
    const holder = container[group]
    if (holder && typeof holder === "object") {
      const inner = (holder as Record<string, unknown>)[item]
      if (inner !== undefined) return asArray(inner)
    }
    // Sebagian ekspor menaruh koleksi langsung di akar tanpa pembungkus.
    return asArray(container[item])
  }

  const teachers = readEntities(pick(timetable, "teachers", "teacher"), "Guru")
  const classes = readEntities(pick(timetable, "classes", "class"), "Kelas")
  const subjects = readEntities(pick(timetable, "subjects", "subject"), "Mapel")
  const groupNodes = pick(timetable, "groups", "group")
  const classroomNodes = pick(timetable, "classrooms", "classroom")
  const lessonNodes = pick(timetable, "lessons", "lesson")
  const cardNodes = pick(timetable, "cards", "card")

  const periods: AscPeriodInfo[] = []
  const seenPeriods = new Set<number>()
  for (const node of pick(timetable, "periods", "period")) {
    const period = parsePeriodNumber(attr(node, "period") ?? attr(node, "name") ?? attr(node, "short"))
    if (period === null || seenPeriods.has(period)) continue
    seenPeriods.add(period)
    periods.push({
      period,
      name: attr(node, "name"),
      // Dibawa hanya untuk ditampilkan pada pratinjau; bukan sumber kebenaran.
      startTime: attr(node, "starttime"),
      endTime: attr(node, "endtime"),
    })
  }
  periods.sort((a, b) => a.period - b.period)

  /** groupid → classid, supaya lesson yang menunjuk grup tetap menemukan kelasnya. */
  const groupToClass = new Map<string, string>()
  for (const node of groupNodes) {
    const groupId = attr(node, "id")
    const classId = attr(node, "classid")
    if (groupId && classId) groupToClass.set(groupId, classId)
  }

  const classroomNames = new Map<string, string>()
  for (const node of classroomNodes) {
    const id = attr(node, "id")
    const name = attr(node, "name") ?? attr(node, "short")
    if (id && name) classroomNames.set(id, name)
  }

  const bucket: Bucket = new Map()

  type Lesson = {
    readonly teacherIds: readonly string[]
    readonly classIds: readonly string[]
    readonly subjectId: string | null
    readonly classroomIds: readonly string[]
  }

  const lessons = new Map<string, Lesson>()
  for (const node of lessonNodes) {
    const lessonId = attr(node, "id")
    if (!lessonId) continue

    const classIds = new Set(idList(attr(node, "classids")))
    for (const groupId of idList(attr(node, "groupids"))) {
      const classId = groupToClass.get(groupId)
      if (classId) classIds.add(classId)
    }

    const subjectId = attr(node, "subjectid")
    const teacherIds = idList(attr(node, "teacherids"))

    if (!subjectId) warn(bucket, "lesson_without_subject", "Pelajaran tanpa mata pelajaran diabaikan")
    if (teacherIds.length === 0) warn(bucket, "lesson_without_teacher", "Pelajaran tanpa guru diabaikan")
    if (classIds.size === 0) warn(bucket, "lesson_without_class", "Pelajaran tanpa kelas diabaikan")

    lessons.set(lessonId, {
      teacherIds,
      classIds: [...classIds],
      subjectId,
      classroomIds: idList(attr(node, "classroomids")),
    })
  }

  const placements: AscPlacement[] = []
  const seenPlacements = new Set<string>()

  for (const node of cardNodes) {
    const lessonId = attr(node, "lessonid")
    if (!lessonId) {
      warn(bucket, "card_without_lesson", "Penempatan tanpa lessonid diabaikan")
      continue
    }

    const lesson = lessons.get(lessonId)
    if (!lesson) {
      warn(bucket, "unknown_reference", "Penempatan menunjuk pelajaran yang tidak ada")
      continue
    }

    const period = parsePeriodNumber(attr(node, "period"))
    if (period === null) {
      warn(bucket, "card_without_period", "Penempatan tanpa nomor jam diabaikan")
      continue
    }

    const days = daysFromMask(attr(node, "days"))
    if (days.length === 0) {
      warn(bucket, "card_without_day", "Penempatan tanpa hari diabaikan")
      continue
    }

    const classroomId = attr(node, "classroomids") ?? lesson.classroomIds[0] ?? null
    const classroomName = classroomId
      ? (classroomNames.get(idList(classroomId)[0] ?? classroomId) ?? null)
      : null

    for (const day of days) {
      // Hari di luar Senin–Sabtu tidak dipakai SISMEPDA.
      if (day < 1 || day > 6) continue

      const fingerprint = `${lessonId}|${period}|${day}`
      if (seenPlacements.has(fingerprint)) {
        warn(bucket, "duplicate_placement", "Penempatan ganda pada pelajaran, jam, dan hari yang sama")
        continue
      }
      seenPlacements.add(fingerprint)

      placements.push({
        cardId: attr(node, "id"),
        lessonId,
        period,
        day,
        teacherExternalIds: lesson.teacherIds,
        classExternalIds: lesson.classIds,
        subjectExternalId: lesson.subjectId,
        classroomName,
      })
    }
  }

  if (placements.length === 0) {
    throw new AscParseError("Tidak ada penempatan jadwal yang dapat dibaca dari berkas ini")
  }

  const warnings: AscParseWarning[] = [...bucket.entries()].map(([code, value]) => ({
    code,
    message: value.message,
    count: value.count,
  }))

  return { teachers, classes, subjects, periods, placements, warnings }
}

/** Entitas aSc yang benar-benar dirujuk penempatan — hanya ini yang perlu dipetakan. */
export function referencedExternalIds(timetable: AscTimetable): {
  teachers: Set<string>
  classes: Set<string>
  subjects: Set<string>
} {
  const teachers = new Set<string>()
  const classes = new Set<string>()
  const subjects = new Set<string>()

  for (const placement of timetable.placements) {
    for (const id of placement.teacherExternalIds) teachers.add(id)
    for (const id of placement.classExternalIds) classes.add(id)
    if (placement.subjectExternalId) subjects.add(placement.subjectExternalId)
  }

  return { teachers, classes, subjects }
}
