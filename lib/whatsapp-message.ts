/**
 * Kartu pesan WhatsApp — aturan murni yang berlaku untuk KETIGA jenis kartu.
 *
 * MENGAPA MODUL TERSENDIRI DAN MURNI
 *
 * Pertanyaan-pertanyaan di sini ("kartu ini boleh dijadwalkan?", "kunci
 * idempotensi occurrence ini apa?", "urutan setelah kartu dinaikkan jadi
 * bagaimana?") dijawab di tiga tempat sekaligus: worker latar, route handler,
 * dan halaman admin. Menjawabnya di masing-masing tempat berarti tiga jawaban
 * yang bisa berbeda, dan yang berbeda diam-diam adalah yang paling berbahaya:
 * kunci idempotensi yang tidak sama berarti satu occurrence terkirim dua kali.
 *
 * CLIENT-SAFE: tanpa Prisma, tanpa Node API. Halaman admin mengimpor modul ini
 * apa adanya, sehingga yang ditampilkan di layar adalah aturan yang sama
 * dengan yang ditegakkan server.
 */
import { scheduleFor, type WhatsAppMessageType } from "@/lib/whatsapp-schedule"

/** Sinkron dengan enum Prisma `WhatsAppMessageKind`, tanpa mengimpor klien. */
export type WhatsAppMessageKind = "BUILTIN" | "CUSTOM" | "MANUAL"

/** ID kartu hasil migrasi. Deterministik, jadi aman disebut di kode dan tes. */
export const BUILTIN_MESSAGE_IDS: Readonly<Record<WhatsAppMessageType, string>> = {
  ATTENDANCE_MISSING: "wa-msg-attendance-missing",
  ATTENDANCE_ABSENT: "wa-msg-attendance-absent",
  EUKS_VISIT_NOTIFICATION: "wa-msg-euks-visit-notification",
}

export const MANUAL_MESSAGE_ID = "wa-msg-manual"

/** Judul dan deskripsi kartu "Pesan manual" — dipakai migrasi dan UI. */
export const MANUAL_MESSAGE_TITLE = "Pesan manual"
export const MANUAL_MESSAGE_DESCRIPTION =
  "Kirim pesan bebas ke grup WhatsApp tanpa template dan tanpa jadwal."

/**
 * Bentuk kartu pesan seperti yang dipakai logika, bukan seperti yang disimpan.
 *
 * Sengaja hanya memuat field yang menentukan PERILAKU. Kolom tampilan
 * (`title`, `description`) memang ikut karena kartu manual dan kartu custom
 * dinamai admin, tetapi tidak ada satu pun keputusan di modul ini yang
 * bergantung pada teksnya.
 */
export type WhatsAppMessageIdentity = {
  id: string
  kind: WhatsAppMessageKind
  /** Terisi HANYA untuk `kind = "BUILTIN"`. */
  builtinType: WhatsAppMessageType | null
}

/**
 * Apakah kartu ini punya jadwal?
 *
 * Kartu manual tidak. Ini bukan soal tampilan: scheduler tidak boleh pernah
 * melihatnya, karena satu-satunya cara kartu manual mengirim adalah admin
 * menekan tombol dengan teks yang ia tulis saat itu.
 */
export function isSchedulable(
  message: Pick<WhatsAppMessageIdentity, "kind"> &
    Partial<Pick<WhatsAppMessageIdentity, "builtinType">>,
): boolean {
  if (message.kind === "MANUAL") return false
  // Kartu bawaan yang dipicu peristiwa (notifikasi kunjungan UKS) juga tidak
  // punya occurrence terjadwal. Jawabannya diambil dari definisi jenis, bukan
  // ditulis ulang sebagai daftar nama di sini.
  if (message.kind === "BUILTIN" && message.builtinType) {
    return scheduleFor(message.builtinType).schedulable
  }
  return true
}

/**
 * Nilai untuk kolom legacy `WhatsAppSendLog.type`.
 *
 * KOLOM INI BUKAN SEKADAR PENANDA JENIS.
 *
 * Ia masih ber-foreign-key ke `WhatsAppConfiguration.type` — tabel JADWAL,
 * yang hanya berisi jenis terjadwal. Karena itu satu-satunya nilai yang sah
 * di sini adalah jenis bawaan yang benar-benar punya baris jadwal; jenis
 * bawaan berbasis peristiwa (notifikasi kunjungan UKS) harus menulis NULL,
 * persis seperti kartu manual dan kartu buatan admin.
 *
 * Menuliskan enumnya karena "kartunya bawaan, jadi kolomnya diisi" membuat
 * database menolak setiap pengiriman dengan pelanggaran FK, dan kegagalan itu
 * sampai ke admin sebagai seolah-olah layanan WhatsApp sedang mati.
 */
export function legacyLogTypeFor(
  message: Pick<WhatsAppMessageIdentity, "kind" | "builtinType">,
): WhatsAppMessageType | null {
  if (message.kind !== "BUILTIN" || !message.builtinType) return null
  return scheduleFor(message.builtinType).schedulable ? message.builtinType : null
}

/** Apakah kartu ini boleh dihapus admin? Hanya kartu buatan admin. */
export function isDeletable(message: Pick<WhatsAppMessageIdentity, "kind">): boolean {
  return message.kind === "CUSTOM"
}

/**
 * Kunci idempotensi satu occurrence terjadwal milik sebuah kartu.
 *
 * KOMPATIBILITAS MUNDUR ADALAH INTI FUNGSI INI.
 *
 * Untuk kartu bawaan, kunci diturunkan dari `builtinType` sehingga bentuknya
 * tetap persis `attendance_missing:2026-09-15:08:00` seperti sebelum kartu
 * pesan ada. Jika kunci berubah bentuk — misalnya memakai `id` kartu — maka
 * pada hari migrasi seluruh occurrence yang SUDAH terkirim akan tampak belum
 * terkirim, dan grup sekolah menerima pesan kedua.
 *
 * Kartu buatan admin memakai `id`-nya, yang unik dan tidak pernah berubah.
 * Prefiks `custom:` menjaga agar kartu custom yang (entah bagaimana) memiliki
 * id serupa nama enum tidak dapat menyerempet kunci milik kartu bawaan.
 */
export function messageIdempotencyKey(
  message: Pick<WhatsAppMessageIdentity, "id" | "kind" | "builtinType">,
  schoolDate: string,
  slot: string,
): string {
  if (message.kind === "MANUAL") {
    // Bukan keadaan yang mungkin dicapai lewat UI, tetapi gagal keras di sini
    // lebih baik daripada memberi kartu manual kunci yang membuatnya terlihat
    // sebagai occurrence terjadwal di riwayat.
    throw new Error("Pesan manual tidak pernah terjadwal, jadi tidak punya kunci idempotensi")
  }
  if (message.kind === "BUILTIN") {
    if (!message.builtinType) {
      throw new Error(`Kartu bawaan ${message.id} tidak punya builtinType`)
    }
    return `${message.builtinType.toLowerCase()}:${schoolDate}:${slot}`
  }
  return `custom:${message.id}:${schoolDate}:${slot}`
}

/** Batas jumlah kartu, agar satu halaman tidak menjadi ratusan jadwal. */
export const MAX_CUSTOM_MESSAGES = 20

export const MESSAGE_TITLE_MAX_LENGTH = 60
export const MESSAGE_DESCRIPTION_MAX_LENGTH = 160

export type MessageTitleError =
  | { code: "EMPTY" }
  | { code: "TOO_LONG"; max: number }

/**
 * Validasi judul kartu buatan admin.
 *
 * Judul kosong membuat daftar kartu tidak dapat dibaca, dan judul yang hanya
 * spasi terlihat kosong tetapi lolos pemeriksaan panjang — karena itu yang
 * divalidasi adalah hasil `trim()`, dan hasil itulah yang disimpan.
 */
export function normalizeMessageTitle(
  value: string,
): { ok: true; title: string } | { ok: false; error: MessageTitleError } {
  const title = value.trim()
  if (title.length === 0) return { ok: false, error: { code: "EMPTY" } }
  if (title.length > MESSAGE_TITLE_MAX_LENGTH) {
    return { ok: false, error: { code: "TOO_LONG", max: MESSAGE_TITLE_MAX_LENGTH } }
  }
  return { ok: true, title }
}

export function messageTitleErrorMessage(error: MessageTitleError): string {
  if (error.code === "EMPTY") return "Nama pesan wajib diisi."
  return `Nama pesan maksimal ${error.max} karakter.`
}

export type ReorderDirection = "UP" | "DOWN"

/**
 * Urutan baru setelah satu kartu digeser satu posisi.
 *
 * MENGAPA MENGHITUNG SELURUH URUTAN, BUKAN MENUKAR DUA ANGKA
 *
 * `sortOrder` di database bisa saja tidak rapi: berjarak, kembar, atau
 * berlubang setelah kartu dihapus. Menukar dua nilai pada keadaan seperti itu
 * menghasilkan urutan yang tidak berubah (bila kembar) atau melompati kartu
 * lain (bila berlubang). Karena itu yang dikembalikan adalah penomoran ulang
 * 0..n-1 atas urutan hasil pergeseran — satu penulisan yang selalu membuat
 * urutan menjadi kanonik.
 *
 * Mengembalikan `null` bila pergeseran tidak mungkin (kartu teratas dinaikkan,
 * kartu terbawah diturunkan, atau kartu tidak ada di daftar): pemanggil harus
 * dapat membedakan "tidak ada yang perlu ditulis" dari "urutan baru".
 */
export function reorderMessages(
  orderedIds: readonly string[],
  messageId: string,
  direction: ReorderDirection,
): { id: string; sortOrder: number }[] | null {
  const index = orderedIds.indexOf(messageId)
  if (index === -1) return null
  const target = direction === "UP" ? index - 1 : index + 1
  if (target < 0 || target >= orderedIds.length) return null

  const next = [...orderedIds]
  next[index] = orderedIds[target]
  next[target] = orderedIds[index]
  return next.map((id, sortOrder) => ({ id, sortOrder }))
}

/**
 * Penomoran ulang kanonik tanpa pergeseran.
 *
 * Dipakai setelah kartu dibuat atau dihapus, supaya daftar tidak pernah
 * menyimpan lubang yang membuat pergeseran berikutnya berperilaku aneh.
 */
export function canonicalOrder(orderedIds: readonly string[]): { id: string; sortOrder: number }[] {
  return orderedIds.map((id, sortOrder) => ({ id, sortOrder }))
}
