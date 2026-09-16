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

export const SAMPLE_CONTEXT: TemplateContext = {
  scalars: {
    tanggal: "Senin, 16 September 2026",
    waktu: "08.00",
    nama_sekolah: "SMP Negeri 1 Contoh",
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
