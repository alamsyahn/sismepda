/** Master data Buku Kerja Guru — sumber tunggal untuk seed database. */
export type WorkbookSeed = {
  number: number
  name: string
  weight: number
  items: string[]
}

export const workbookMasterData: WorkbookSeed[] = [
  {
    number: 1,
    name: "Buku Kerja 1",
    weight: 25,
    items: [
      "Capaian Pembelajaran (CP)",
      "Alur Tujuan Pembelajaran (ATP)",
      "Tujuan Pembelajaran (TP)",
      "Modul Ajar",
      "Asesmen Diagnostik dan Analisis Hasilnya",
      "Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)",
    ],
  },
  {
    number: 2,
    name: "Buku Kerja 2",
    weight: 25,
    items: [
      "SK Pembagian Tugas Mengajar dan Tugas Tambahan",
      "Jadwal Pelajaran Tetap",
      "Jurnal Agenda Guru",
      "Program Semester, Program Tahunan",
      "Kode Etik Guru, Ikrar Guru, Tata Tertib Guru",
    ],
  },
  {
    number: 3,
    name: "Buku Kerja 3",
    weight: 25,
    items: [
      "Daftar Nilai/Pengolahan Hasil Asesmen",
      "Analisis Hasil Penilaian dan Daya Serap Siswa",
      "Program Remedial dan Pengayaan",
      "Jurnal Bimbingan & Catatan Guru Wali",
    ],
  },
  {
    number: 4,
    name: "Buku Kerja 4",
    weight: 25,
    items: [
      "Bukti Perencanaan Kinerja (SKP) di PMM",
      "Bukti/Sertifikat PKB (Diklat, Webinar, MGMP)",
      "Laporan Pelaksanaan Penelitian (PTK/Best Practice)",
      "Catatan Refleksi Diri dan Rencana Tindak Lanjut",
    ],
  },
]

export const totalWorkbookItemCount = workbookMasterData.reduce(
  (sum, workbook) => sum + workbook.items.length,
  0,
)
