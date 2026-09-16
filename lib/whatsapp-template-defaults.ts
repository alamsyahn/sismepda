/**
 * Template bawaan — bentuk pesan yang dipakai SISMEPDA sebelum template dapat
 * disunting admin.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Kompatibilitas mundur. Instalasi yang belum pernah menyimpan template harus
 * tetap mengirim pesan yang PERSIS sama seperti sebelumnya, jadi teks di bawah
 * sengaja menyalin keluaran `whatsapp-messages.ts` apa adanya — termasuk letak
 * baris kosong dan tanda bacanya. Berkas ini juga menjadi isi tombol
 * "Kembalikan ke template bawaan".
 *
 * DUA PERBEDAAN YANG DISENGAJA terhadap teks lama, keduanya karena template
 * sengaja TIDAK mengenal kondisi:
 *
 * 1. Kalimat "Catatan: N kelas belum mengisi absensi" dahulu hanya muncul bila
 *    memang ada kelas tertinggal. Kini kalimat itu tidak lagi menjadi bagian
 *    default; angkanya tetap tersedia sebagai `{{jumlah_kelas_belum_rekap}}`
 *    sehingga admin dapat memasangnya sendiri bila diinginkan.
 *
 * 2. Rekap siswa tidak hadir dahulu dikelompokkan menjadi bagian per status
 *    dengan judul `*SAKIT — 3*`. Judul bagian semacam itu hanya bisa muncul
 *    bila template mengenal percabangan. Pengelompokan TETAP dipertahankan
 *    dengan cara lain: barisnya diurutkan SAKIT → IZIN → ALFA → DISPENSASI
 *    (lihat `absentStudentRows`), dan status ikut tercetak di setiap baris.
 *    Jumlah per status tetap tersedia sebagai `{{jumlah_sakit}}`,
 *    `{{jumlah_izin}}`, `{{jumlah_alfa}}`, dan `{{jumlah_dispensasi}}`.
 *
 * Menyediakan conditional untuk dua hal ini akan memaksa seluruh sistem
 * template menjadi bahasa pemrograman kecil, yang justru ingin dihindari.
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
      "{{daftar_siswa_tidak_hadir}}",
      "",
      "Total siswa tidak hadir: {{jumlah_tidak_hadir}}",
    ].join("\n"),
    items: {
      daftar_siswa_tidak_hadir: {
        format: "{{no}}. {{nama_siswa}} — {{nama_kelas}} ({{status}})",
        separator: NEWLINE,
      },
    },
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
  }
}
