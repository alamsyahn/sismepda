/**
 * Definisi jadwal pesan WhatsApp otomatis — SATU-SATUNYA tempat jam hidup.
 *
 * Jam sengaja tidak disebar ke scheduler, UI, dan dokumentasi sebagai angka
 * lepas: begitu tersebar, mengubah jadwal berarti memburu magic number, dan
 * satu yang terlewat membuat UI berbohong tentang apa yang benar-benar
 * dikirim. Modul ini client-safe (tanpa Prisma, tanpa Node API), sehingga
 * halaman admin menampilkan jadwal yang sama persis dengan yang dijalankan
 * worker.
 */

/** Sinkron dengan enum Prisma `WhatsAppMessageType`, tanpa mengimpor klien. */
export type WhatsAppMessageType =
  | "ATTENDANCE_MISSING"
  | "ATTENDANCE_ABSENT"
  /**
   * Notifikasi kunjungan UKS ke wali kelas.
   *
   * BAWAAN TAPI TIDAK TERJADWAL. Ia dipicu peristiwa (petugas UKS menyimpan
   * kunjungan), bukan jam, sehingga `defaultSlots` kosong dan
   * `schedulable: false` — scheduler tidak boleh pernah melihatnya. Ia tetap
   * menjadi kartu agar templatenya disunting di layar yang sama dengan pesan
   * otomatis lain, bukan lewat mekanisme kedua yang harus dipelajari terpisah.
   */
  | "EUKS_VISIT_NOTIFICATION"

export type WhatsAppScheduleDefinition = {
  type: WhatsAppMessageType
  /** Label bahasa Indonesia untuk UI. */
  label: string
  description: string
  /**
   * Apakah jenis ini dijalankan oleh jadwal.
   *
   * Jenis yang dipicu peristiwa bernilai `false`; kartu miliknya tidak pernah
   * masuk daftar slot jatuh tempo maupun kartu jadwal di layar.
   */
  schedulable: boolean
  /**
   * Jam bawaan saat jenis ini pertama kali dibuat.
   *
   * BUKAN jadwal yang berlaku. Jadwal sesungguhnya tersimpan di
   * `WhatsAppConfiguration.slots` dan dapat disunting admin; nilai di sini
   * hanya dipakai sebagai benih baris baru dan oleh migrasi. Membacanya saat
   * runtime akan mengembalikan bug yang justru dihapus: UI dan scheduler
   * mengikuti angka di kode, bukan pengaturan yang dilihat admin.
   */
  defaultSlots: readonly string[]
}

export const WHATSAPP_SCHEDULE: readonly WhatsAppScheduleDefinition[] = [
  {
    type: "ATTENDANCE_MISSING",
    label: "Kelas belum mengisi absensi",
    schedulable: true,
    description:
      "Daftar kelas yang sampai jam tersebut belum mengisi atau belum melengkapi absensi hari itu.",
    defaultSlots: ["08:00", "10:00"],
  },
  {
    type: "ATTENDANCE_ABSENT",
    label: "Rekap siswa tidak hadir",
    schedulable: true,
    description:
      "Rekap siswa berstatus Sakit, Izin, Alfa, atau Dispensasi pada hari itu.",
    defaultSlots: ["12:00"],
  },
  {
    type: "EUKS_VISIT_NOTIFICATION",
    label: "Notifikasi kunjungan UKS ke wali kelas",
    description:
      "Pesan pribadi ke wali kelas saat petugas UKS mencatat kunjungan siswanya. Dikirim atas permintaan petugas, bukan menurut jadwal.",
    schedulable: false,
    defaultSlots: [],
  },
] as const

export const WHATSAPP_MESSAGE_TYPES: readonly WhatsAppMessageType[] =
  WHATSAPP_SCHEDULE.map((definition) => definition.type)

export function scheduleFor(type: WhatsAppMessageType): WhatsAppScheduleDefinition {
  const definition = WHATSAPP_SCHEDULE.find((candidate) => candidate.type === type)
  // Tidak mungkin terjadi selama tipe dipakai, tetapi gagal keras lebih baik
  // daripada mengirim pesan tanpa jadwal yang dikenal.
  if (!definition) throw new Error(`Jenis pesan WhatsApp tidak dikenal: ${type}`)
  return definition
}

/** "08.00 & 10.00 WIB" — untuk ditampilkan, bukan untuk diurai kembali. */
export function formatSlots(slots: readonly string[]): string {
  return `${slots.map((slot) => slot.replace(":", ".")).join(" & ")} WIB`
}

/**
 * Kunci idempotensi satu eksekusi terjadwal.
 *
 * Bentuknya `jenis:tanggal:slot` dan menjadi UNIQUE di database. Tanggal
 * memakai tanggal sekolah (`YYYY-MM-DD`, bebas timezone), sehingga worker yang
 * restart, scheduler yang retry, atau dua worker yang tidak sengaja hidup
 * bersamaan tetap menghasilkan kunci yang sama — dan yang kedua ditolak
 * constraint, bukan oleh variabel di memori proses.
 */
export function idempotencyKeyFor(
  type: WhatsAppMessageType,
  schoolDate: string,
  slot: string,
): string {
  return `${type.toLowerCase()}:${schoolDate}:${slot}`
}
