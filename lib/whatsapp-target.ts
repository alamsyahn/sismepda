/**
 * Resolusi grup tujuan.
 *
 * MURNI: menerima daftar grup, mengembalikan keputusan. Tidak memanggil
 * WhatsApp, sehingga aturan "grup mana yang dipakai" dapat diuji tanpa akun.
 *
 * PRINSIP: nama grup hanya dipakai SEKALI, saat mencari. Setelah ketemu, yang
 * disimpan dan dipakai mengirim adalah JID. Nama grup dapat berubah atau
 * kembar; JID tidak. Karena itu pengiriman terjadwal tidak pernah mencari nama
 * ulang.
 */
import type { WhatsAppGroup } from "@/lib/whatsapp-transport"

/**
 * Nama grup tujuan saat ini.
 *
 * Disimpan sebagai daftar, bukan konstanta tunggal, supaya penambahan tujuan
 * berikutnya tidak menuntut pembongkaran struktur data.
 */
export const DEFAULT_TARGET_GROUP_NAME = "REKAP ABSENSI SISWA"

export type TargetResolution =
  | { status: "RESOLVED"; jid: string; name: string }
  | { status: "NOT_FOUND"; searchedName: string }
  | { status: "AMBIGUOUS"; searchedName: string; candidates: WhatsAppGroup[] }

/** Perbandingan nama: abaikan besar-kecil huruf dan spasi berlebih. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase()
}

/** JID grup WhatsApp selalu berakhiran `@g.us`. */
export function isGroupJid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9-]+@g\.us$/.test(value.trim())
}

/**
 * Cari grup berdasarkan nama.
 *
 * Nama kembar dilaporkan AMBIGUOUS alih-alih diam-diam memilih yang pertama:
 * memilih sendiri berarti berpotensi mengirim rekap absensi siswa ke grup yang
 * salah, dan tidak ada yang akan menyadarinya.
 */
export function resolveTargetGroup(
  groups: readonly WhatsAppGroup[],
  name: string = DEFAULT_TARGET_GROUP_NAME,
): TargetResolution {
  const wanted = normalize(name)
  const matches = groups.filter((group) => normalize(group.name) === wanted)

  if (matches.length === 0) return { status: "NOT_FOUND", searchedName: name }
  if (matches.length > 1) return { status: "AMBIGUOUS", searchedName: name, candidates: [...matches] }
  return { status: "RESOLVED", jid: matches[0].jid, name: matches[0].name }
}

export type TargetState =
  | { status: "RESOLVED"; jid: string; name: string }
  | { status: "NOT_RESOLVED" }
  | { status: "INVALID"; jid: string }

/** Mode tujuan sebuah jenis pesan. Cerminan enum Prisma, tanpa impor Prisma. */
export type DestinationMode = "DEFAULT" | "OVERRIDE"

/** Grup default lintas jenis pesan. */
export type DefaultDestination = {
  jid: string | null
  name: string | null
}

/** Konfigurasi tujuan milik satu jenis pesan. */
export type ReportDestination = {
  mode: DestinationMode
  jid: string | null
  name: string | null
}

/**
 * Tujuan akhir satu jenis pesan.
 *
 * SATU-SATUNYA tempat aturan "default atau override" hidup. Pengiriman
 * terjadwal dan "Kirim sekarang" sama-sama melewati fungsi ini, karena dua
 * jalur yang menghitung tujuan sendiri-sendiri pasti berbeda suatu saat — dan
 * bedanya baru ketahuan setelah pesan mendarat di grup yang salah.
 *
 * Murni: tidak menyentuh database maupun WhatsApp, sehingga seluruh matriks
 * default/override dapat diuji tanpa akun.
 */
export function resolveDestination(
  report: ReportDestination,
  fallback: DefaultDestination,
): TargetState {
  // Override dibaca apa adanya. Override yang belum diisi TIDAK diam-diam
  // jatuh kembali ke default: admin yang memilih "grup berbeda" sedang
  // menyatakan pesan ini tidak boleh ikut default, dan menebaknya berarti
  // mengirim ke grup yang justru ingin dihindari.
  if (report.mode === "OVERRIDE") {
    return targetStateOf(report.jid, report.name)
  }
  return targetStateOf(fallback.jid, fallback.name)
}

/**
 * Apakah konfigurasi tersimpan siap dipakai mengirim.
 *
 * Dipanggil sebelum setiap pengiriman. Bila JID tersimpan tidak berbentuk JID
 * grup yang sah, pengiriman DIBATALKAN — tidak pernah jatuh kembali ke
 * pencarian nama, karena itulah cara pesan berakhir di grup yang keliru.
 */
export function targetStateOf(
  jid: string | null | undefined,
  name: string | null | undefined,
): TargetState {
  if (!jid) return { status: "NOT_RESOLVED" }
  if (!isGroupJid(jid)) return { status: "INVALID", jid }
  return { status: "RESOLVED", jid, name: name ?? jid }
}

export type AutomaticBlock = "NO_DEFAULT" | "NO_OVERRIDE" | "INVALID_TARGET"

/**
 * Bagaimana tujuan sebuah jenis pesan ditampilkan.
 *
 * JID mentah tidak pernah menjadi label: ia tidak berarti apa pun bagi admin.
 * Yang tampil adalah nama grup — kecuali saat nama belum diketahui, di mana
 * kejujuran lebih berguna daripada menampilkan angka panjang.
 */
export type DestinationDisplay =
  | { kind: "DEFAULT"; label: string }
  | { kind: "OVERRIDE"; label: string }
  | { kind: "MISSING"; label: string }
  | { kind: "STALE"; label: string }

/**
 * Label tujuan untuk layar.
 *
 * `groups` boleh `null` yang berarti "daftar grup tidak diketahui saat ini"
 * (belum terhubung, atau pengambilan gagal). Dalam keadaan itu tidak ada yang
 * disimpulkan tentang keberadaan grup: menandai tujuan tersimpan sebagai hilang
 * hanya karena satu fetch gagal akan membuat admin mengira konfigurasinya
 * rusak.
 */
export function destinationDisplay(
  report: ReportDestination,
  fallback: DefaultDestination,
  groups: readonly WhatsAppGroup[] | null,
): DestinationDisplay {
  const target = resolveDestination(report, fallback)
  if (target.status !== "RESOLVED") {
    return {
      kind: "MISSING",
      label: report.mode === "OVERRIDE" ? "Grup khusus belum dipilih" : "Grup default belum dipilih",
    }
  }

  const live = groups?.find((group) => group.jid === target.jid) ?? null

  // JID tersimpan tidak ada di daftar terbaru. Konfigurasi TIDAK dihapus dan
  // TIDAK diganti diam-diam ke grup lain; admin diberi tahu agar bisa memilih
  // ulang secara sadar.
  if (groups && !live) {
    // Nama snapshot bisa kosong (mis. tujuan lama yang disimpan sebelum nama
    // ikut dicatat). Menampilkan string kosong akan terlihat seperti "tidak ada
    // tujuan", padahal JID-nya tersimpan — karena itu JID yang ditampilkan
    // sebagai petunjuk terakhir, bukan sebagai label utama.
    return {
      kind: "STALE",
      label: target.name
        ? `${target.name} (tidak ditemukan)`
        : `Grup tidak ditemukan (${target.jid})`,
    }
  }

  // Nama grup dapat berubah. Yang tampil adalah nama terbaru; tujuannya tetap
  // JID yang sama.
  const label = live?.name ?? target.name
  return report.mode === "OVERRIDE"
    ? { kind: "OVERRIDE", label }
    : { kind: "DEFAULT", label }
}

export const STALE_DESTINATION_MESSAGE =
  "Grup tersimpan tidak ditemukan pada daftar grup saat ini."


/**
 * Bolehkah pengiriman otomatis diaktifkan untuk jenis ini?
 *
 * Mengaktifkan jadwal tanpa tujuan yang sah berarti menjadwalkan kegagalan yang
 * baru ketahuan besok pagi saat pesan tidak muncul di grup. Karena itu
 * pemeriksaan ini dijalankan SERVER sebelum menyimpan, bukan sekadar oleh UI —
 * UI hanya menampilkan alasannya lebih awal.
 */
export function automaticBlockFor(
  report: ReportDestination,
  fallback: DefaultDestination,
): AutomaticBlock | null {
  const target = resolveDestination(report, fallback)
  if (target.status === "RESOLVED") return null
  if (target.status === "INVALID") return "INVALID_TARGET"
  return report.mode === "OVERRIDE" ? "NO_OVERRIDE" : "NO_DEFAULT"
}

/** Pesan untuk admin. Satu kalimat, menyebut tindakan yang harus dilakukan. */
export const AUTOMATIC_BLOCK_MESSAGES: Record<AutomaticBlock, string> = {
  NO_DEFAULT: "Pilih grup tujuan terlebih dahulu sebelum mengaktifkan pengiriman otomatis.",
  NO_OVERRIDE:
    "Jadwal ini memakai grup khusus yang belum dipilih. Pilih grup tujuan terlebih dahulu sebelum mengaktifkan pengiriman otomatis.",
  INVALID_TARGET: "Identitas grup tujuan tidak valid. Pilih ulang grup tujuan.",
}
