/**
 * Logika murni jadwal: deteksi bentrok dan diff impor.
 *
 * CLIENT-SAFE dan MURNI. Dipakai server (penegakan) dan klien (pratinjau),
 * sehingga aturan bentrok yang dilihat admin persis sama dengan yang ditolak
 * server.
 */

import { scheduleDayLabel } from "@/lib/schedule-constants"

/** Satu penempatan pelajaran, dinyatakan seluruhnya dengan ID internal. */
export type ScheduleEntryShape = {
  readonly id?: string
  readonly day: number
  readonly period: number
  readonly classId: string
  readonly subjectId: string
  readonly teacherId: string
  readonly room: string | null
}

export type ConflictKind = "teacher" | "class"

export type ScheduleConflict = {
  readonly kind: ConflictKind
  readonly day: number
  readonly period: number
  readonly entityId: string
  readonly message: string
}

function slotKey(day: number, period: number): string {
  return `${day}|${period}`
}

/**
 * Bentrok di dalam SATU himpunan penempatan.
 *
 * Dua aturan, keduanya mutlak:
 *   - satu kelas tidak dapat mengikuti dua pelajaran pada slot yang sama;
 *   - satu guru tidak dapat mengajar dua rombongan pada slot yang sama.
 *
 * Entri identik (kelas+guru+mapel sama persis) juga dilaporkan sebagai bentrok,
 * bukan diabaikan, karena duplikat pada slot yang sama selalu berarti data
 * salah — bukan pelajaran ganda yang sah.
 */
export function findConflicts(entries: readonly ScheduleEntryShape[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const byTeacher = new Map<string, ScheduleEntryShape>()
  const byClass = new Map<string, ScheduleEntryShape>()

  for (const entry of entries) {
    const teacherKey = `${entry.teacherId}|${slotKey(entry.day, entry.period)}`
    if (byTeacher.has(teacherKey)) {
      conflicts.push({
        kind: "teacher",
        day: entry.day,
        period: entry.period,
        entityId: entry.teacherId,
        message: `Guru sudah mengajar pada ${scheduleDayLabel(entry.day)} jam ke-${entry.period}`,
      })
    } else {
      byTeacher.set(teacherKey, entry)
    }

    const classKey = `${entry.classId}|${slotKey(entry.day, entry.period)}`
    if (byClass.has(classKey)) {
      conflicts.push({
        kind: "class",
        day: entry.day,
        period: entry.period,
        entityId: entry.classId,
        message: `Kelas sudah memiliki pelajaran pada ${scheduleDayLabel(entry.day)} jam ke-${entry.period}`,
      })
    } else {
      byClass.set(classKey, entry)
    }
  }

  return conflicts
}

/**
 * Bentrok yang timbul bila `candidate` ditambahkan/diubah di antara `existing`.
 *
 * `candidate.id` dikecualikan dari pembandingan supaya menyunting entri tanpa
 * memindahkan slotnya tidak dilaporkan bentrok dengan dirinya sendiri.
 */
export function findConflictsAgainst(
  existing: readonly ScheduleEntryShape[],
  candidate: ScheduleEntryShape,
): ScheduleConflict[] {
  const others = existing.filter((entry) => !candidate.id || entry.id !== candidate.id)
  const sameSlot = others.filter((entry) => entry.day === candidate.day && entry.period === candidate.period)
  return findConflicts([...sameSlot, candidate]).filter((conflict) =>
    conflict.kind === "teacher" ? conflict.entityId === candidate.teacherId : conflict.entityId === candidate.classId,
  )
}

/** Identitas slot sebuah entri: yang membuat dua entri "tempat yang sama". */
export function entrySlotFingerprint(entry: ScheduleEntryShape): string {
  return `${entry.day}|${entry.period}|${entry.classId}`
}

/** Isi sebuah entri: yang membuat dua entri "sama isinya". */
export function entryContentFingerprint(entry: ScheduleEntryShape): string {
  return `${entry.subjectId}|${entry.teacherId}|${entry.room ?? ""}`
}

export type ScheduleDiff = {
  readonly added: readonly ScheduleEntryShape[]
  readonly changed: readonly { readonly before: ScheduleEntryShape; readonly after: ScheduleEntryShape }[]
  readonly removed: readonly ScheduleEntryShape[]
  readonly unchanged: number
}

/**
 * Selisih jadwal aktif terhadap hasil impor.
 *
 * Perbandingan memakai (hari, jam, kelas) sebagai identitas slot: itulah yang
 * dilihat pengguna sebagai "kotak" pada tabel. Perubahan guru atau mapel pada
 * kotak yang sama muncul sebagai `changed`, bukan sepasang hapus+tambah, agar
 * pratinjau terbaca sebagaimana admin memikirkannya.
 *
 * Diff ini sengaja TIDAK menggabungkan suntingan manual dengan hasil impor.
 * Apply menjadikan hasil impor sebagai jadwal aktif yang baru; suntingan manual
 * yang berbeda dari XML akan tertimpa, dan justru itulah yang ditampilkan di
 * `changed`/`removed` sebelum admin menekan Terapkan.
 */
export function diffSchedule(
  current: readonly ScheduleEntryShape[],
  next: readonly ScheduleEntryShape[],
): ScheduleDiff {
  const currentBySlot = new Map<string, ScheduleEntryShape>()
  for (const entry of current) currentBySlot.set(entrySlotFingerprint(entry), entry)

  const added: ScheduleEntryShape[] = []
  const changed: { before: ScheduleEntryShape; after: ScheduleEntryShape }[] = []
  const matchedSlots = new Set<string>()
  let unchanged = 0

  for (const entry of next) {
    const key = entrySlotFingerprint(entry)
    const before = currentBySlot.get(key)
    if (!before) {
      added.push(entry)
      continue
    }
    matchedSlots.add(key)
    if (entryContentFingerprint(before) === entryContentFingerprint(entry)) unchanged += 1
    else changed.push({ before, after: entry })
  }

  const removed = current.filter((entry) => !matchedSlots.has(entrySlotFingerprint(entry)))

  return { added, changed, removed, unchanged }
}

export type ScheduleDiffSummary = {
  readonly added: number
  readonly changed: number
  readonly removed: number
  readonly unchanged: number
}

export function summarizeDiff(diff: ScheduleDiff): ScheduleDiffSummary {
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchanged,
  }
}

/**
 * Guru yang TIDAK mengajar pada satu slot.
 *
 * `teacherIds` wajib berisi populasi guru yang sudah disaring pemanggil
 * (punya role `guru`, tertaut Data Master Guru, dan aktif). Fungsi ini tidak
 * menyimpulkan siapa guru dari jadwal: guru yang belum punya jadwal sama sekali
 * justru harus tetap muncul.
 */
export function freeTeacherIds(
  teacherIds: readonly string[],
  entries: readonly ScheduleEntryShape[],
  day: number,
  period: number,
): string[] {
  const busy = new Set(
    entries.filter((entry) => entry.day === day && entry.period === period).map((entry) => entry.teacherId),
  )
  return teacherIds.filter((id) => !busy.has(id))
}
