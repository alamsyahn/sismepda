/**
 * Data contoh untuk pratinjau template.
 *
 * MENGAPA DATA CONTOH, BUKAN DATA HARI INI
 *
 * Pratinjau harus memperlihatkan BENTUK pesan, terutama bagaimana daftar
 * tersusun. Data hari ini sering tidak cocok untuk itu: pada jam admin menyunting
 * template, daftar kelas belum rekap bisa saja kosong, sehingga admin menyangka
 * formatnya salah padahal datanya memang belum ada. Data contoh selalu memuat
 * beberapa baris, sehingga pemisah antar-item dan penomoran benar-benar terlihat.
 *
 * Layar WAJIB menandai hasilnya sebagai data contoh; lihat komponen editor.
 *
 * MURNI dan CLIENT-SAFE: pratinjau dirender di layar tanpa memanggil server,
 * sehingga tidak ada jalur apa pun dari pratinjau menuju pengiriman WhatsApp.
 */
import type { TemplateContext } from "@/lib/whatsapp-template"

/**
 * Baris contoh sengaja dipilih agar setiap perilaku terlihat sekaligus:
 * beberapa siswa Sakit dari kelas berbeda, satu Izin, satu Dispensasi,
 * ALFA KOSONG supaya `*ALFA — 0*` benar-benar terlihat, dan kelas yang belum
 * merekap supaya baris catatan ikut muncul.
 *
 * Urutan baris sudah seperti hasil pengurutan sesungguhnya (kelas menaik),
 * sehingga pratinjau tidak menjanjikan urutan yang berbeda dari kiriman nyata.
 */
const SAKIT = [
  { nama_siswa: "Ahmad Fauzi", nama_kelas: "7A", status: "SAKIT", keterangan: "Demam" },
  { nama_siswa: "Citra Lestari", nama_kelas: "7B", status: "SAKIT", keterangan: "-" },
  { nama_siswa: "Rafi Pratama", nama_kelas: "8C", status: "SAKIT", keterangan: "-" },
]

const IZIN = [
  {
    nama_siswa: "Budi Santoso",
    nama_kelas: "7A",
    status: "IZIN",
    keterangan: "Acara keluarga",
  },
]

const ALFA: Record<string, string>[] = []

const DISPENSASI = [
  {
    nama_siswa: "Dewi Anggraini",
    nama_kelas: "9A",
    status: "DISPENSASI",
    keterangan: "Lomba",
  },
]

/**
 * Nama sekolah yang dipakai HANYA bila setelan sekolah belum terisi.
 *
 * Bukan nilai yang ditampilkan dalam keadaan normal: `sampleContextFor()`
 * menggantinya dengan nama dari setelan sekolah. Ia ada sebagai jaring
 * pengaman untuk database yang baru dipasang, di mana kolom namanya masih
 * kosong dan pratinjau tanpa nama apa pun justru lebih membingungkan.
 */
export const SAMPLE_SCHOOL_NAME = "SMP Negeri 1 Contoh"

export const SAMPLE_CONTEXT: TemplateContext = {
  scalars: {
    tanggal: "Senin, 16 September 2026",
    waktu: "08.00",
    nama_sekolah: SAMPLE_SCHOOL_NAME,
    // Placeholder milik notifikasi kunjungan UKS.
    //
    // WAJIB ADA DI SINI, bukan hanya di registry placeholder: pratinjau
    // merender dengan konteks ini, dan nama yang tidak punya nilai dibiarkan
    // tampil apa adanya sebagai `{{nama_siswa}}`. Admin yang melihat token
    // mentah di pratinjau wajar menyimpulkan templatenya rusak, lalu
    // memperbaiki sesuatu yang sebenarnya benar.
    //
    // Nilai siswa sengaja fiktif; hanya identitas sekolah yang memakai data
    // sungguhan, karena itulah satu-satunya bagian yang tidak boleh berbeda
    // antara pratinjau dan pesan yang benar-benar terkirim.
    nama_siswa: "Ahmad Fauzi",
    nama_kelas: "7A",
    wali_kelas: "Bu Ani",
    keluhan: "Pusing dan demam",
    tindakan: "Istirahat di UKS, diberi minum hangat",
    tindak_lanjut: "Dirujuk ke Puskesmas",
    petugas: "Bu Sari",
    jumlah_kelas: "27",
    jumlah_kelas_sudah_rekap: "24",
    jumlah_kelas_belum_rekap: "3",
    jumlah_siswa: "840",
    jumlah_tidak_hadir: String(SAKIT.length + IZIN.length + ALFA.length + DISPENSASI.length),
    jumlah_sakit: String(SAKIT.length),
    jumlah_izin: String(IZIN.length),
    jumlah_dispensasi: String(DISPENSASI.length),
    jumlah_alfa: String(ALFA.length),
    catatan_kelas_belum_rekap:
      "Catatan: 3 kelas belum mengisi absensi sehingga data belum lengkap.",
  },
  collections: {
    daftar_kelas_belum_rekap: [
      { nama_kelas: "7A", wali_kelas: "Bu Ani", jumlah_siswa_belum_diisi: "28" },
      { nama_kelas: "7B", wali_kelas: "Pak Budi", jumlah_siswa_belum_diisi: "5" },
      { nama_kelas: "8A", wali_kelas: "Bu Sari", jumlah_siswa_belum_diisi: "30" },
    ],
    daftar_sakit: SAKIT,
    daftar_izin: IZIN,
    daftar_alfa: ALFA,
    daftar_dispensasi: DISPENSASI,
    // Daftar gabungan mengikuti urutan status yang sama dengan pesan nyata.
    daftar_siswa_tidak_hadir: [...SAKIT, ...IZIN, ...ALFA, ...DISPENSASI],
  },
}

/**
 * Data contoh dengan identitas sekolah yang SUNGGUHAN.
 *
 * Pratinjau memang harus memakai data contoh untuk siswa dan daftar — itulah
 * yang membuat bentuk pesan terlihat. Tetapi nama sekolah bukan bagian dari
 * "bentuk": ia identitas organisasi yang sudah tersimpan di setelan sekolah,
 * dan menampilkannya berbeda dari pesan yang benar-benar terkirim membuat
 * pratinjau berbohong tentang satu-satunya baris yang paling mudah diperiksa
 * admin.
 *
 * Nama kosong (database baru) jatuh kembali ke nama contoh, bukan ke string
 * kosong yang membuat baris judul pesan tampak rusak.
 */
export function sampleContextFor(schoolName: string | null | undefined): TemplateContext {
  const resolved = schoolName?.trim()
  if (!resolved) return SAMPLE_CONTEXT
  return {
    ...SAMPLE_CONTEXT,
    scalars: { ...SAMPLE_CONTEXT.scalars, nama_sekolah: resolved },
  }
}
