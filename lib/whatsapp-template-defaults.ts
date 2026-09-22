/**
 * Template bawaan — bentuk pesan yang dipakai SISMEPDA sebelum template dapat
 * disunting admin.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Kompatibilitas mundur. Instalasi yang belum pernah menyimpan template harus
 * tetap mengirim pesan yang wajar tanpa konfigurasi apa pun. Berkas ini juga
 * menjadi isi tombol "Kembalikan ke template bawaan".
 *
 * BENTUK BAWAAN REKAP SISWA TIDAK HADIR
 *
 * Rekap siswa tidak hadir kembali memakai bentuk BERKELOMPOK PER STATUS —
 * `*SAKIT — 27*` diikuti daftarnya — karena bentuk itu jauh lebih mudah
 * dipindai daripada satu daftar panjang bercampur status. Yang membuatnya
 * mungkin tanpa memberi template kemampuan bercabang adalah placeholder
 * `{{bagian_*}}`: judul, jumlah, dan daftarnya disusun mesin, dan admin cukup
 * menempatkannya.
 *
 * Judul bagian tetap tercetak walaupun jumlahnya nol, sehingga pembaca tahu
 * hari itu memang tidak ada Alfa — bukan datanya yang hilang.
 *
 * SATU PERBEDAAN YANG DISENGAJA terhadap teks lama: kalimat "Catatan: N kelas
 * belum mengisi absensi" kini menjadi placeholder `{{catatan_kelas_belum_rekap}}`
 * yang diisi SISTEM dan menjadi kosong bila seluruh kelas sudah merekap. Admin
 * tidak perlu menulis conditional apa pun untuk itu.
 *
 * MURNI dan CLIENT-SAFE: hanya data.
 */
import type {
  ItemSeparator,
  WhatsAppTemplate,
  WhatsAppTemplateKey,
  WhatsAppTemplateSet,
} from "@/lib/whatsapp-template"

const NEWLINE: ItemSeparator = "NEWLINE"

/**
 * Header lama berbunyi `*REKAP ABSENSI*` lalu `tanggal • 08.00 WIB`.
 * Bentuk itu dipertahankan sebagai default.
 */
export const DEFAULT_TEMPLATES: WhatsAppTemplateSet = {
  MISSING_PENDING: {
    body: [
      "*REKAP ABSENSI*",
      "{{tanggal}} • {{waktu}} WIB",
      "",
      "Kelas yang belum mengisi absensi:",
      "",
      "{{daftar_kelas_belum_rekap}}",
      "",
      "Total: {{jumlah_kelas_belum_rekap}} kelas.",
    ].join("\n"),
    items: {
      daftar_kelas_belum_rekap: { format: "{{no}}. {{nama_kelas}}", separator: NEWLINE },
    },
  },
  MISSING_COMPLETE: {
    body: [
      "*REKAP ABSENSI*",
      "{{tanggal}} • {{waktu}} WIB",
      "",
      "Seluruh kelas telah mengisi absensi.",
      "",
      "NIHIL kelas yang belum melakukan rekap.",
    ].join("\n"),
    items: {},
  },
  ABSENT_PRESENT: {
    body: [
      "*REKAP SISWA TIDAK HADIR*",
      "{{tanggal}} • {{waktu}} WIB",
      "",
      "{{bagian_sakit}}",
      "",
      "{{bagian_izin}}",
      "",
      "{{bagian_alfa}}",
      "",
      "{{bagian_dispensasi}}",
      "",
      "Total siswa tidak hadir: {{jumlah_tidak_hadir}}",
      "",
      "{{catatan_kelas_belum_rekap}}",
    ].join("\n"),
    items: {
      // Format item yang sama dipakai seluruh daftar siswa, termasuk
      // `daftar_siswa_tidak_hadir`, supaya baris terlihat seragam. Status tidak
      // ikut dicetak pada daftar per status karena sudah menjadi judul bagian.
      daftar_sakit: { format: "• {{nama_kelas}} — {{nama_siswa}}", separator: NEWLINE },
      daftar_izin: { format: "• {{nama_kelas}} — {{nama_siswa}}", separator: NEWLINE },
      daftar_alfa: { format: "• {{nama_kelas}} — {{nama_siswa}}", separator: NEWLINE },
      daftar_dispensasi: {
        format: "• {{nama_kelas}} — {{nama_siswa}}",
        separator: NEWLINE,
      },
      daftar_siswa_tidak_hadir: {
        format: "• {{nama_kelas}} — {{nama_siswa}} ({{status}})",
        separator: NEWLINE,
      },
    },
  },
  /**
   * Kondisi E — rekap masih SEMENTARA.
   *
   * Bentuknya sengaja berbeda dari kondisi C: yang paling penting dibaca saat
   * itu bukan daftar siswa, melainkan kelas mana yang masih ditunggu, dan
   * peringatan bahwa angkanya belum final.
   */
  ABSENT_INCOMPLETE: {
    body: [
      "⏳ *REKAP KEHADIRAN SEMENTARA*",
      "📅 {{tanggal}} • {{waktu}} WIB",
      "",
      "⚠️ Rekap belum final karena masih ada kelas yang belum melengkapi absensi.",
      "",
      "🏫 *KELAS BELUM LENGKAP — {{jumlah_kelas_belum_rekap}}*",
      "{{daftar_kelas_belum_rekap}}",
      "",
      "👥 *DATA SEMENTARA SISWA TIDAK HADIR*",
      "🤒 Sakit: {{jumlah_sakit}}",
      "📝 Izin: {{jumlah_izin}}",
      "❌ Alfa: {{jumlah_alfa}}",
      "🏅 Dispensasi: {{jumlah_dispensasi}}",
      "",
      "──────────",
      "Data ketidakhadiran di atas masih dapat berubah setelah seluruh kelas mengisi absensi.",
      "",
      "🔗 app.smpn2blitar.sch.id",
    ].join("\n"),
    items: {
      daftar_kelas_belum_rekap: { format: "• {{nama_kelas}}", separator: NEWLINE },
    },
  },
  /**
   * Kondisi F — notifikasi kunjungan UKS ke wali kelas.
   *
   * Nadanya sengaja INFORMATIF, bukan instruksi: UKS memberi tahu wali kelas
   * apa yang terjadi pada siswanya, dan wali kelas yang menentukan tindak
   * lanjutnya. `{{tindak_lanjut}}` sudah berisi tanda hubung bila kosong,
   * sehingga barisnya tidak pernah menggantung tanpa isi.
   */
  EUKS_VISIT: {
    body: [
      "*NOTIFIKASI KUNJUNGAN UKS*",
      "{{tanggal}}",
      "",
      "Yth. Bapak/Ibu {{wali_kelas}},",
      "",
      "Siswa berikut memeriksakan diri ke UKS hari ini:",
      "",
      "Nama: {{nama_siswa}}",
      "Kelas: {{nama_kelas}}",
      "Keluhan: {{keluhan}}",
      "Tindakan: {{tindakan}}",
      "Tindak lanjut: {{tindak_lanjut}}",
      "",
      "Dicatat oleh: {{petugas}}",
      "",
      "{{nama_sekolah}}",
    ].join("\n"),
    items: {},
  },
  ABSENT_NONE: {
    body: [
      "*REKAP SISWA TIDAK HADIR*",
      "{{tanggal}} • {{waktu}} WIB",
      "",
      "NIHIL",
      "",
      "Seluruh siswa yang telah direkap tercatat hadir.",
    ].join("\n"),
    items: {},
  },
}

export function defaultTemplate(key: WhatsAppTemplateKey): WhatsAppTemplate {
  const template = DEFAULT_TEMPLATES[key]
  // Disalin agar pemanggil yang menyunting hasilnya tidak mengubah konstanta
  // ini untuk seluruh proses.
  return { body: template.body, items: { ...template.items } }
}

export function defaultTemplateSet(): WhatsAppTemplateSet {
  return {
    MISSING_PENDING: defaultTemplate("MISSING_PENDING"),
    MISSING_COMPLETE: defaultTemplate("MISSING_COMPLETE"),
    ABSENT_PRESENT: defaultTemplate("ABSENT_PRESENT"),
    ABSENT_NONE: defaultTemplate("ABSENT_NONE"),
    ABSENT_INCOMPLETE: defaultTemplate("ABSENT_INCOMPLETE"),
    EUKS_VISIT: defaultTemplate("EUKS_VISIT"),
  }
}
