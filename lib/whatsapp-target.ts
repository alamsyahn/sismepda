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
