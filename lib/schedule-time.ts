/**
 * Logika murni struktur waktu harian (tab "Waktu & Kegiatan").
 *
 * CLIENT-SAFE.
 *
 * Berkas ini adalah OTORITAS atas pertanyaan "Jam ke-1 pukul berapa" dan
 * "sekarang jam ke berapa". Berkas aSc TIDAK pernah menjawab keduanya: XML
 * hanya menyebut nomor period, dan nomor itu diterjemahkan menjadi jam dinding
 * di sini lewat `ascPeriod`.
 */

import {
  MINUTES_PER_DAY,
  formatMinuteOfDay,
  isMinuteOfDay,
  isScheduleSlotKind,
  type ScheduleSlotKind,
} from "@/lib/schedule-constants"

export type TimeSlotInput = {
  readonly id?: string
  readonly position: number
  readonly kind: ScheduleSlotKind
  readonly name: string
  readonly startMinute: number
  readonly endMinute: number
  readonly ascPeriod: number | null
}

export type TimeSlot = TimeSlotInput & { readonly id: string }

/** Batas atas nomor period aSc yang masuk akal untuk satu hari sekolah. */
export const MAX_ASC_PERIOD = 20

/**
 * Memvalidasi SATU baris secara mandiri (tanpa melihat tetangganya).
 * Mengembalikan pesan Indonesia siap tampil, atau `null` bila sah.
 */
export function validateTimeSlot(slot: TimeSlotInput): string | null {
  if (!isScheduleSlotKind(slot.kind)) return "Jenis slot tidak dikenal"
  if (!slot.name.trim()) return "Nama slot wajib diisi"
  if (slot.name.trim().length > 60) return "Nama slot maksimal 60 karakter"
  if (!Number.isInteger(slot.position) || slot.position < 1) return "Urutan slot tidak valid"
  if (!isMinuteOfDay(slot.startMinute)) return "Jam mulai tidak valid"
  if (!isMinuteOfDay(slot.endMinute) && slot.endMinute !== MINUTES_PER_DAY) {
    return "Jam selesai tidak valid"
  }
  if (slot.endMinute <= slot.startMinute) return "Jam selesai harus setelah jam mulai"

  if (slot.kind === "PELAJARAN") {
    if (slot.ascPeriod === null) return "Slot pelajaran wajib punya nomor jam (period aSc)"
    if (!Number.isInteger(slot.ascPeriod) || slot.ascPeriod < 1 || slot.ascPeriod > MAX_ASC_PERIOD) {
      return `Nomor jam pelajaran harus antara 1 dan ${MAX_ASC_PERIOD}`
    }
  } else if (slot.ascPeriod !== null) {
    // Istirahat dan kegiatan tidak pernah dirujuk `card.period`; memberi mereka
    // nomor period akan membuat satu nomor menunjuk dua baris berbeda.
    return "Hanya slot pelajaran yang boleh memiliki nomor jam"
  }

  return null
}

/**
 * Memvalidasi SELURUH struktur satu profil: keunikan urutan, keunikan nomor
 * period, dan ketiadaan tumpang tindih waktu.
 *
 * Mengembalikan daftar masalah supaya admin melihat semuanya sekaligus, bukan
 * satu per satu tiap kali menyimpan.
 */
export function validateTimeStructure(slots: readonly TimeSlotInput[]): readonly string[] {
  const problems: string[] = []

  for (const slot of slots) {
    const problem = validateTimeSlot(slot)
    if (problem) problems.push(`${slot.name || "(tanpa nama)"}: ${problem}`)
  }

  const seenPositions = new Set<number>()
  const seenPeriods = new Set<number>()
  for (const slot of slots) {
    if (seenPositions.has(slot.position)) problems.push(`Urutan ${slot.position} dipakai lebih dari satu slot`)
    seenPositions.add(slot.position)

    if (slot.ascPeriod !== null) {
      if (seenPeriods.has(slot.ascPeriod)) {
        problems.push(`Nomor jam ${slot.ascPeriod} dipakai lebih dari satu slot`)
      }
      seenPeriods.add(slot.ascPeriod)
    }
  }

  // Tumpang tindih dicari pada urutan waktu, bukan urutan tampil: dua baris
  // dapat bertabrakan walau posisinya berjauhan di daftar.
  const ordered = [...slots]
    .filter((slot) => isMinuteOfDay(slot.startMinute) && slot.endMinute > slot.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute)

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (current.startMinute < previous.endMinute) {
      problems.push(
        `"${previous.name}" (${formatMinuteOfDay(previous.startMinute)}–${formatMinuteOfDay(previous.endMinute)}) ` +
          `bertabrakan dengan "${current.name}" (${formatMinuteOfDay(current.startMinute)}–${formatMinuteOfDay(current.endMinute)})`,
      )
    }
  }

  return problems
}

/** Slot yang urut menurut posisi tampil. */
export function orderedSlots<T extends { position: number }>(slots: readonly T[]): T[] {
  return [...slots].sort((a, b) => a.position - b.position)
}

/** Hanya slot pelajaran, urut menurut nomor period. */
export function lessonSlots<T extends TimeSlotInput>(slots: readonly T[]): T[] {
  return slots
    .filter((slot): slot is T & { ascPeriod: number } => slot.kind === "PELAJARAN" && slot.ascPeriod !== null)
    .sort((a, b) => a.ascPeriod - b.ascPeriod)
}

/** Peta nomor period → slot, untuk menerjemahkan penempatan menjadi jam dinding. */
export function slotByPeriod<T extends TimeSlotInput>(slots: readonly T[]): Map<number, T> {
  const map = new Map<number, T>()
  for (const slot of lessonSlots(slots)) map.set(slot.ascPeriod as number, slot)
  return map
}

export type CurrentSlotResult =
  | { readonly state: "lesson"; readonly slot: TimeSlot; readonly period: number }
  | { readonly state: "break"; readonly slot: TimeSlot }
  | { readonly state: "outside" }

/**
 * Slot yang sedang berlangsung pada menit tertentu.
 *
 * `minuteOfDay` WAJIB sudah diproyeksikan ke zona waktu sekolah oleh pemanggil
 * (`schoolMinutesOfDay`); fungsi ini tidak pernah menyentuh `Date`, sehingga
 * tidak mungkin menghidupkan kembali bug UTC vs WIB.
 *
 * `state: "break"` sengaja dibedakan dari `"outside"`: saat istirahat, tidak
 * ada guru yang sedang mengajar, tetapi berpura-pura ada "jam kosong" akan
 * menyesatkan — UI menampilkan konteksnya, bukan daftar palsu.
 */
export function currentSlot(slots: readonly TimeSlot[], minuteOfDay: number): CurrentSlotResult {
  if (!isMinuteOfDay(minuteOfDay)) return { state: "outside" }

  for (const slot of orderedSlots(slots)) {
    // Batas akhir eksklusif: pada menit pergantian, yang berlaku adalah slot
    // berikutnya.
    if (minuteOfDay < slot.startMinute || minuteOfDay >= slot.endMinute) continue
    if (slot.kind === "PELAJARAN" && slot.ascPeriod !== null) {
      return { state: "lesson", slot, period: slot.ascPeriod }
    }
    return { state: "break", slot }
  }

  return { state: "outside" }
}

/**
 * Period default untuk filter "Jam Kosong Guru".
 *
 * Bila sekarang sedang jam pelajaran, itulah defaultnya. Di luar itu tidak ada
 * default — pengguna memilih sendiri, karena menebak jam terdekat akan membuat
 * hasil terlihat seperti keadaan sekarang padahal bukan.
 */
export function defaultPeriodForNow(slots: readonly TimeSlot[], minuteOfDay: number): number | null {
  const result = currentSlot(slots, minuteOfDay)
  return result.state === "lesson" ? result.period : null
}

/** Struktur waktu bawaan saat sekolah belum pernah menyetelnya. */
export const DEFAULT_TIME_PROFILE_KEY = "reguler"

export const DEFAULT_TIME_SLOTS: readonly Omit<TimeSlotInput, "id">[] = [
  { position: 1, kind: "PELAJARAN", name: "Jam ke-1", startMinute: 7 * 60, endMinute: 7 * 60 + 40, ascPeriod: 1 },
  { position: 2, kind: "PELAJARAN", name: "Jam ke-2", startMinute: 7 * 60 + 40, endMinute: 8 * 60 + 20, ascPeriod: 2 },
  { position: 3, kind: "PELAJARAN", name: "Jam ke-3", startMinute: 8 * 60 + 20, endMinute: 9 * 60, ascPeriod: 3 },
  { position: 4, kind: "ISTIRAHAT", name: "Istirahat 1", startMinute: 9 * 60, endMinute: 9 * 60 + 20, ascPeriod: null },
  { position: 5, kind: "PELAJARAN", name: "Jam ke-4", startMinute: 9 * 60 + 20, endMinute: 10 * 60, ascPeriod: 4 },
  { position: 6, kind: "PELAJARAN", name: "Jam ke-5", startMinute: 10 * 60, endMinute: 10 * 60 + 40, ascPeriod: 5 },
  { position: 7, kind: "PELAJARAN", name: "Jam ke-6", startMinute: 10 * 60 + 40, endMinute: 11 * 60 + 20, ascPeriod: 6 },
  { position: 8, kind: "ISTIRAHAT", name: "Istirahat 2", startMinute: 11 * 60 + 20, endMinute: 11 * 60 + 50, ascPeriod: null },
  { position: 9, kind: "PELAJARAN", name: "Jam ke-7", startMinute: 11 * 60 + 50, endMinute: 12 * 60 + 30, ascPeriod: 7 },
  { position: 10, kind: "PELAJARAN", name: "Jam ke-8", startMinute: 12 * 60 + 30, endMinute: 13 * 60 + 10, ascPeriod: 8 },
]
