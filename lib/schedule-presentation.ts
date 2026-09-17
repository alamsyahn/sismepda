/**
 * Aturan TAMPILAN modul Jadwal.
 *
 * Semuanya fungsi murni: tidak menyentuh DOM, Prisma, maupun `Date`. Yang
 * diputuskan di sini hanyalah bagaimana data yang SUDAH ada ditampilkan —
 * nada semantic sebuah slot, slot mana yang sedang berlangsung, dan urutan
 * kelas. Tidak ada aturan jadwal baru yang lahir di berkas ini.
 *
 * Dipisah dari komponen supaya dapat diuji tanpa peramban, dan supaya kelima
 * tab memakai bahasa visual yang sama alih-alih masing-masing menebak.
 */
import type { CurrentSlotResult, TimeSlot } from "@/lib/schedule-time"

/**
 * Nada visual sebuah baris jadwal.
 *
 * Sengaja hanya empat. Memberi warna per mata pelajaran akan membuat layar
 * menjadi pelangi tanpa menambah informasi: yang perlu dibedakan sekilas
 * adalah JENIS barisnya, bukan identitas mapelnya.
 */
export type SlotTone = "lesson" | "activity" | "break" | "empty"

/**
 * Kelas Tailwind untuk tiap nada.
 *
 * Warna tidak pernah menjadi satu-satunya pembeda — setiap nada juga punya
 * label teks di UI ("Istirahat", "Kegiatan sekolah", "Tidak ada jadwal").
 * Ini syarat aksesibilitas, bukan preferensi gaya.
 */
export const SLOT_TONE_CLASS: Record<SlotTone, string> = {
  // Pelajaran adalah isi utama: tanpa tint supaya ia yang paling menonjol.
  lesson: "",
  activity: "bg-slate-500/[0.06] dark:bg-slate-400/[0.08]",
  break: "bg-amber-500/[0.07] dark:bg-amber-400/[0.09]",
  empty: "",
}

/** Nada untuk satu slot, dengan tahu ada/tidaknya entri pelajaran. */
export function slotTone(slot: Pick<TimeSlot, "kind">, hasEntry: boolean): SlotTone {
  if (slot.kind === "ISTIRAHAT") return "break"
  if (slot.kind !== "PELAJARAN") return "activity"
  return hasEntry ? "lesson" : "empty"
}

/**
 * Label jenis baris untuk slot bukan pelajaran.
 *
 * Teksnya dipertahankan apa adanya dari struktur waktu (`slot.name`) bila ada,
 * karena sekolah menamai sendiri kegiatannya — "Upacara Bendera", "Sapa Wali",
 * "Literasi". Menggantinya dengan istilah generik justru menghilangkan
 * informasi yang sudah diketik admin.
 */
export function slotKindLabel(slot: Pick<TimeSlot, "kind" | "name">): string {
  if (slot.kind === "ISTIRAHAT") return "Istirahat"
  if (slot.kind === "PELAJARAN") return "Jam pelajaran"
  return slot.name.trim() || "Kegiatan sekolah"
}

/**
 * Apakah slot ini yang sedang berlangsung.
 *
 * Dihitung dari `ScheduleNowContext.current` yang SUDAH diproyeksikan ke zona
 * waktu sekolah oleh server. Komponen tidak boleh memanggil `Date` sendiri:
 * selain memunculkan kembali bug UTC vs WIB, jam yang dihitung di peramban
 * berbeda dari yang dirender server dan memicu hydration mismatch.
 *
 * Wajib cocok HARI dan slotnya — tanpa `isToday`, jam ke-3 Senin akan ikut
 * menyala saat membuka jadwal Kamis.
 */
export function isCurrentSlot(
  current: CurrentSlotResult,
  slot: Pick<TimeSlot, "id">,
  isToday: boolean,
): boolean {
  if (!isToday) return false
  if (current.state === "outside") return false
  return current.slot.id === slot.id
}

/** Tingkat dari nama kelas; 0 bila tidak dikenali. */
function gradeRank(grade: string): number {
  const normalized = grade.trim().toUpperCase()
  if (normalized === "VII") return 1
  if (normalized === "VIII") return 2
  if (normalized === "IX") return 3
  return 0
}

/**
 * Urutan kelas yang dibaca manusia: VII A … VII I, VIII A …, IX A … IX I.
 *
 * Basis data mengurutkan `name` secara alfabet, sehingga "IX A" mendahului
 * "VII A" — benar secara leksikografis, membingungkan bagi pengguna. Urutan
 * diperbaiki di lapisan tampilan saja; tidak ada kolom atau indeks yang
 * berubah.
 *
 * Kelas dengan tingkat tak dikenal tidak dibuang, hanya ditaruh di belakang:
 * menyembunyikan data karena namanya tak terduga adalah kegagalan diam-diam.
 */
export function sortClassesForDisplay<T extends { name: string; grade: string }>(
  classes: readonly T[],
): T[] {
  return [...classes].sort((a, b) => {
    const rankA = gradeRank(a.grade)
    const rankB = gradeRank(b.grade)
    if (rankA !== rankB) {
      if (rankA === 0) return 1
      if (rankB === 0) return -1
      return rankA - rankB
    }
    return a.name.localeCompare(b.name, "id", { numeric: true, sensitivity: "base" })
  })
}
