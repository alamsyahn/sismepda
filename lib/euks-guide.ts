/**
 * Isi Panduan & Referensi E-UKS.
 *
 * Konten statis dan version-controlled — tidak ada CMS, tabel database, atau
 * pengambilan dari internet saat runtime. Berkas ini sengaja bebas Prisma dan
 * bebas React supaya dapat diuji sebagai data biasa.
 *
 * Angka contoh dan kategori status gizi TIDAK ditulis ulang di sini: keduanya
 * diturunkan dari fungsi yang benar-benar dipakai aplikasi (`calculateBmi`,
 * `categorizeZScore`, `nutritionCategoryLabels`), sehingga panduan tidak bisa
 * menjelaskan rumus atau ambang yang berbeda dari perhitungan sebenarnya.
 */

import {
  categorizeZScore,
  nutritionCategoryLabels,
  type NutritionCategory,
} from "@/lib/bmi-for-age"
import { calculateBmi } from "@/lib/euks"
import { KMS_FALLBACK_GENDER } from "@/lib/kms"

/**
 * Tanggal pembaruan panduan — konstanta yang diganti manual ketika isinya
 * berubah. Sengaja tidak dihitung dari waktu server: "terakhir diperbarui"
 * harus berarti isinya diperiksa, bukan halamannya dibuka.
 */
export const EUKS_GUIDE_LAST_UPDATED = "September 2026"

export const EUKS_GUIDE_CALCULATION_SOURCE =
  "WHO Growth Reference 5-19 tahun dan Permenkes RI Nomor 2 Tahun 2020"

export const EUKS_GUIDE_OPERATIONAL_NOTE =
  "Tindak lanjut operasional perlu disesuaikan dengan SOP sekolah dan arahan Puskesmas."

/** Satu kategori navigasi cepat; `id` sekaligus anchor section di halaman. */
export type EuksGuideNavEntry = {
  id: string
  emoji: string
  title: string
  description: string
}

export const EUKS_GUIDE_SECTIONS: readonly EuksGuideNavEntry[] = [
  {
    id: "pengukuran",
    emoji: "⚖️",
    title: "Pengukuran Kesehatan",
    description: "Cara mengukur tinggi dan berat badan agar hasilnya dapat dipercaya",
  },
  {
    id: "imt",
    emoji: "🧮",
    title: "IMT & Status Gizi",
    description: "Rumus IMT, IMT menurut umur, z-score, dan kategori status gizi",
  },
  {
    id: "pertumbuhan",
    emoji: "📈",
    title: "Pertumbuhan & KMS",
    description: "Membaca grafik tinggi badan menurut umur dan pita rujukan WHO",
  },
  {
    id: "tindak-lanjut",
    emoji: "🩺",
    title: "Tindak Lanjut",
    description: "Alur dari pengukuran sampai koordinasi, beserta matriks tindakan",
  },
  {
    id: "kunjungan",
    emoji: "📝",
    title: "Kunjungan UKS",
    description: "Membedakan keluhan, tindakan, dan tindak lanjut saat mencatat",
  },
  {
    id: "dashboard",
    emoji: "📊",
    title: "Memahami Dashboard",
    description: "Dasar penghitungan ringkasan, persentase, dan heatmap kelas",
  },
  {
    id: "privasi",
    emoji: "🔒",
    title: "Privasi Data",
    description: "Etika menyampaikan dan menyimpan data kesehatan siswa",
  },
  {
    id: "referensi",
    emoji: "📚",
    title: "Referensi Resmi",
    description: "Permenkes, WHO, dan SATUSEHAT yang menjadi dasar E-UKS",
  },
]

// --- A. Pengukuran ---------------------------------------------------------

export const EUKS_GUIDE_MEASUREMENT_STEPS: readonly string[] = [
  "Letakkan timbangan dan alat ukur tinggi pada lantai yang datar dan keras, bukan di atas karpet.",
  "Minta siswa melepas alas kaki, jaket tebal, tas, dan benda berat di saku sebelum diukur.",
  "Saat mengukur tinggi, siswa berdiri tegak, tumit rapat menempel dinding, pandangan lurus ke depan.",
  "Catat tinggi badan dalam sentimeter (cm) dan berat badan dalam kilogram (kg), satu angka di belakang koma.",
  "Ulangi pengukuran bila hasilnya jauh berbeda dari pengukuran sebelumnya atau posisi siswa tidak sempurna.",
  "Pastikan tanggal lahir dan jenis kelamin siswa benar — keduanya menentukan kurva rujukan yang dipakai.",
]

export const EUKS_GUIDE_MEASUREMENT_MISTAKES: readonly string[] = [
  "Tinggi badan diisi dalam meter (1,55) padahal satuannya sentimeter (155).",
  "Berat badan dibulatkan ke angka bulat terdekat sehingga tren kecil hilang.",
  "Siswa masih memakai sepatu atau jaket tebal ketika ditimbang.",
  "Tanggal pengukuran diisi tanggal input, bukan tanggal siswa benar-benar diukur.",
  "Tanggal lahir atau jenis kelamin kosong sehingga status gizi tidak dapat dinilai.",
]

export const EUKS_GUIDE_MEASUREMENT_WARNING =
  "Perhitungan yang benar tetap dapat menghasilkan kesimpulan yang salah apabila data pengukurannya tidak akurat."

// --- B. Rumus IMT ----------------------------------------------------------

export const EUKS_GUIDE_BMI_FORMULA = "IMT = berat badan (kg) ÷ tinggi badan² (m)"

export const EUKS_GUIDE_BMI_EXAMPLE_WEIGHT_KG = 45
export const EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM = 155

/** Angka Indonesia dengan koma desimal. */
export function formatGuideNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",")
}

/**
 * Hasil contoh dihitung dengan `calculateBmi()` yang sama dipakai aplikasi,
 * bukan angka yang diketik tangan, supaya contoh di panduan tidak bisa
 * berbeda dari hasil di layar pengukuran.
 */
export function guideBmiExample(): {
  weightKg: number
  heightCm: number
  heightM: string
  bmi: string
} {
  const bmi = calculateBmi(EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM, EUKS_GUIDE_BMI_EXAMPLE_WEIGHT_KG)
  return {
    weightKg: EUKS_GUIDE_BMI_EXAMPLE_WEIGHT_KG,
    heightCm: EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM,
    heightM: formatGuideNumber(EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM / 100, 2),
    bmi: bmi === null ? "-" : formatGuideNumber(bmi),
  }
}

export const EUKS_GUIDE_BMI_WARNING =
  "Untuk siswa, angka IMT tidak langsung dibandingkan dengan batas IMT orang dewasa. E-UKS menggunakan IMT menurut Umur (IMT/U), umur dalam bulan, jenis kelamin, dan kurva rujukan WHO."

// --- C. Z-score ------------------------------------------------------------

export const EUKS_GUIDE_ZSCORE_DEFINITION =
  "Z-score menunjukkan posisi hasil pengukuran siswa dibandingkan dengan rujukan anak yang memiliki umur dan jenis kelamin yang sama."

export const EUKS_GUIDE_ZSCORE_EXAMPLES: readonly { value: string; meaning: string }[] = [
  { value: "0 SD", meaning: "Berada di sekitar nilai tengah rujukan." },
  { value: "−2 SD", meaning: "Berada dua tingkat penyimpangan di bawah rujukan." },
  { value: "+1 SD", meaning: "Berada satu tingkat penyimpangan di atas rujukan." },
]

export const EUKS_GUIDE_ZSCORE_WARNING =
  "SD pada hasil IMT/U bukan standar deviasi yang dihitung dari siswa SMPN 2 Blitar. Nilainya berasal dari kurva rujukan WHO berdasarkan umur dan jenis kelamin."

/** Rumus LMS yang benar-benar dijalankan `lib/lms.ts`. */
export const EUKS_GUIDE_LMS_FORMULA = "z = ((IMT/M)^L − 1) ÷ (L × S)"
export const EUKS_GUIDE_LMS_FORMULA_ZERO_L = "z = ln(IMT/M) ÷ S"

export const EUKS_GUIDE_LMS_TERMS: readonly { symbol: string; meaning: string }[] = [
  { symbol: "L", meaning: "Parameter transformasi distribusi." },
  { symbol: "M", meaning: "Median pada umur dan jenis kelamin tersebut." },
  { symbol: "S", meaning: "Koefisien variasi." },
]

// --- D. Kategori status gizi ----------------------------------------------

/**
 * Baris tabel kategori. `category` TIDAK ditulis manual: tiap baris menyimpan
 * satu z-score contoh yang mewakili rentangnya, lalu kategorinya diambil dari
 * `categorizeZScore()` — fungsi yang sama dipakai menilai siswa. Jika ambang
 * aplikasi berubah, tabel panduan ikut berubah, tidak bisa tertinggal.
 */
export type NutritionGuideRow = {
  range: string
  sampleZ: number
  category: NutritionCategory
  label: string
}

const NUTRITION_GUIDE_RANGES: readonly { range: string; sampleZ: number }[] = [
  { range: "< −3 SD", sampleZ: -3.5 },
  { range: "−3 SD sampai < −2 SD", sampleZ: -2.5 },
  { range: "−2 SD sampai +1 SD", sampleZ: 0 },
  { range: "> +1 SD sampai +2 SD", sampleZ: 1.5 },
  { range: "> +2 SD", sampleZ: 2.5 },
]

export const NUTRITION_GUIDE_ROWS: readonly NutritionGuideRow[] = NUTRITION_GUIDE_RANGES.map(
  ({ range, sampleZ }) => {
    const category = categorizeZScore(sampleZ)
    return { range, sampleZ, category, label: nutritionCategoryLabels[category] }
  },
)

export const EUKS_GUIDE_SCREENING_WARNING =
  "Hasil E-UKS merupakan penapisan berdasarkan antropometri, bukan diagnosis penyakit. Hasil perlu dibaca bersama ketepatan pengukuran, tren pertumbuhan, kondisi siswa, dan bila diperlukan pemeriksaan tenaga kesehatan."

// --- E. Alur proses --------------------------------------------------------

export type EuksGuideFlowStep = {
  step: number
  title: string
  description: string
  /** Nama ikon Lucide yang dipakai komponen diagram. */
  icon:
    | "ruler"
    | "shield-check"
    | "calculator"
    | "line-chart"
    | "tags"
    | "trending-up"
    | "clipboard-pen"
    | "users-round"
}

export const EUKS_GUIDE_FLOW: readonly EuksGuideFlowStep[] = [
  {
    step: 1,
    title: "Input pengukuran",
    description: "Tinggi badan, berat badan, dan tanggal pengukuran dicatat pada data siswa.",
    icon: "ruler",
  },
  {
    step: 2,
    title: "Validasi data",
    description: "Sistem menolak nilai tidak masuk akal dan menandai tanggal lahir atau jenis kelamin yang kosong.",
    icon: "shield-check",
  },
  {
    step: 3,
    title: "Hitung IMT",
    description: "IMT diturunkan dari berat dan tinggi setiap kali dibaca, tidak pernah disimpan.",
    icon: "calculator",
  },
  {
    step: 4,
    title: "Hitung IMT/U dan z-score",
    description: "Umur dalam bulan dan jenis kelamin menentukan baris rujukan WHO yang dipakai.",
    icon: "line-chart",
  },
  {
    step: 5,
    title: "Tentukan kategori",
    description: "Z-score dipetakan ke kategori Permenkes 2/2020, atau ditandai belum dapat dinilai.",
    icon: "tags",
  },
  {
    step: 6,
    title: "Lihat tren pengukuran",
    description: "Riwayat pengukuran dan grafik pertumbuhan dibaca bersama, bukan satu titik saja.",
    icon: "trending-up",
  },
  {
    step: 7,
    title: "Catat tindak lanjut",
    description: "Apa yang dilakukan sekolah dicatat pada kunjungan UKS atau catatan absensi sakit.",
    icon: "clipboard-pen",
  },
  {
    step: 8,
    title: "Koordinasi bila diperlukan",
    description: "Orang tua dan Puskesmas dilibatkan sesuai SOP sekolah untuk hasil yang perlu perhatian.",
    icon: "users-round",
  },
]

// --- F. Matriks tindak lanjut ---------------------------------------------

export type EuksGuideFollowUpRow = {
  result: string
  action: string
  tone: "ok" | "warning" | "danger" | "info"
}

export const EUKS_GUIDE_FOLLOW_UP: readonly EuksGuideFollowUpRow[] = [
  {
    result: "Gizi baik",
    action:
      "Sampaikan hasil secara positif, lanjutkan perilaku hidup sehat dan pemantauan berkala.",
    tone: "ok",
  },
  {
    result: "Gizi kurang atau gizi lebih",
    action:
      "Verifikasi pengukuran dan data identitas, lihat tren, catat tindak lanjut, serta koordinasikan edukasi dan pemantauan.",
    tone: "warning",
  },
  {
    result: "Gizi buruk atau obesitas",
    action:
      "Verifikasi pengukuran, informasikan secara privat kepada pihak berwenang, lalu koordinasikan dengan orang tua dan Puskesmas.",
    tone: "danger",
  },
  {
    result: "Perubahan tajam dari riwayat sebelumnya",
    action:
      "Jangan hanya melihat kategori terakhir; lakukan pemeriksaan ulang dan konsultasikan.",
    tone: "warning",
  },
  {
    result: "Belum dapat dinilai",
    action:
      "Lengkapi pengukuran, tanggal lahir, atau jenis kelamin yang belum tersedia.",
    tone: "info",
  },
]

export const EUKS_GUIDE_SCOPE_STATEMENT =
  "E-UKS membantu penapisan, pemantauan, dan dokumentasi. E-UKS tidak menggantikan diagnosis maupun penanganan oleh tenaga kesehatan."

// --- G. Grafik pertumbuhan / KMS ------------------------------------------

export const EUKS_GUIDE_KMS_POINTS: readonly string[] = [
  "Sumbu horizontal menunjukkan umur siswa, dihitung dalam bulan penuh pada tanggal pengukuran.",
  "Sumbu vertikal menunjukkan tinggi badan dalam sentimeter.",
  "Garis −3, −2, −1, 0, +1, +2, dan +3 SD adalah pita rujukan WHO, bukan target yang harus dikejar.",
  "Kurva laki-laki dan perempuan berbeda; badge pada kartu menyebutkan kurva mana yang sedang digambar.",
  "Satu titik tidak cukup untuk menilai pola pertumbuhan — yang dibaca adalah arah antar-pengukuran.",
  "Perubahan tajam antar-pengukuran perlu diperiksa ulang sebelum disimpulkan.",
  "Posisi di luar pita rujukan bukan diagnosis otomatis.",
  "Grafik menampilkan posisi terhadap rujukan WHO, bukan diagnosis stunting.",
  "Pengukuran tanpa tanggal lahir, atau yang umurnya di luar 5-19 tahun, tidak digambar sama sekali daripada digeser ke tepi tabel.",
]

/**
 * Kalimat fallback jenis kelamin disusun dari konstanta yang benar-benar
 * dipakai `resolveKmsReference()`, supaya panduan tidak menyebut kurva yang
 * berbeda dari yang digambar.
 */
export const EUKS_GUIDE_KMS_FALLBACK_NOTE =
  KMS_FALLBACK_GENDER === "LAKI_LAKI"
    ? "Bila jenis kelamin siswa belum diisi, kartu menyatakannya dalam kalimat dan menggambar kurva laki-laki sebagai sementara, ditandai “(sementara)” pada badge. Pemilih kurva di kartu hanya untuk tampilan — tidak pernah menulis ke data siswa, dan jenis kelamin yang tersimpan selalu menang. Keterbatasan ini tidak disembunyikan: lengkapi jenis kelamin agar kurvanya benar."
    : "Bila jenis kelamin siswa belum diisi, kartu menyatakannya dalam kalimat dan menggambar kurva perempuan sebagai sementara, ditandai “(sementara)” pada badge. Pemilih kurva di kartu hanya untuk tampilan — tidak pernah menulis ke data siswa, dan jenis kelamin yang tersimpan selalu menang. Keterbatasan ini tidak disembunyikan: lengkapi jenis kelamin agar kurvanya benar."

export const EUKS_GUIDE_KMS_NO_STATUS_NOTE =
  "Grafik tinggi badan sengaja tidak memberi label status. Permenkes 2/2020 hanya memuat tabel tinggi menurut umur sampai 60 bulan sehingga tidak mencakup siswa SMP; kartu menggambar pita rujukan dan titik siswa, lalu penilaiannya diserahkan kepada tenaga kesehatan."

// --- H. Pencatatan kunjungan ----------------------------------------------

export const EUKS_GUIDE_VISIT_FIELDS: readonly { field: string; meaning: string }[] = [
  {
    field: "Keluhan",
    meaning: "Apa yang dirasakan atau dilaporkan siswa, ditulis apa adanya — bukan nama penyakit.",
  },
  {
    field: "Tindakan",
    meaning: "Apa yang benar-benar dilakukan petugas UKS saat itu.",
  },
  {
    field: "Tindak lanjut",
    meaning: "Apa yang terjadi setelahnya: pemberitahuan wali kelas, penjemputan, atau rujukan.",
  },
]

export const EUKS_GUIDE_VISIT_BAD_EXAMPLE = "Siswa sakit parah."

export const EUKS_GUIDE_VISIT_GOOD_EXAMPLE =
  "Keluhan pusing sejak pukul 09.30. Siswa diistirahatkan di UKS dan wali kelas diberi tahu. Orang tua diminta menjemput."

export const EUKS_GUIDE_VISIT_RULES: readonly string[] = [
  "Gunakan istilah keluhan yang konsisten — statistik mengelompokkan teks, bukan diagnosis.",
  "Catat fakta, bukan asumsi diagnosis.",
  "Catat tindakan yang benar-benar dilakukan.",
  "Tuliskan rujukan atau komunikasi sebagai tindak lanjut.",
  "Hindari informasi sensitif yang tidak diperlukan untuk penanganan.",
]

// --- I. Dashboard ----------------------------------------------------------

export const EUKS_GUIDE_DASHBOARD_POINTS: readonly string[] = [
  "Ringkasan status gizi memakai pengukuran terbaru setiap siswa, bukan seluruh riwayat.",
  "Satu siswa dihitung satu kali, sehingga siswa yang sering diukur tidak membebani angka.",
  "Persentase tiap kategori memakai siswa yang berhasil diklasifikasikan sebagai pembagi.",
  "Cakupan pengukuran memakai seluruh siswa aktif sebagai pembagi.",
  "“Belum terukur” dapat terjadi karena belum ada pengukuran, atau karena tanggal lahir/jenis kelamin belum lengkap.",
  "Heatmap dipakai untuk mencari kelas yang perlu diperhatikan, bukan untuk melabeli kelas “tidak sehat”.",
  "Statistik keluhan berasal dari teks pencatatan petugas, bukan diagnosis medis; ejaan yang berbeda dikelompokkan, istilah yang berbeda tidak disamakan.",
  "Riwayat sakit dari absensi berbeda dengan kunjungan UKS: yang satu ketidakhadiran, yang lain kunjungan ke ruang UKS.",
]

// --- J. Privasi ------------------------------------------------------------

export const EUKS_GUIDE_PRIVACY_POINTS: readonly string[] = [
  "Data kesehatan siswa bersifat sensitif dan diperlakukan sebagai data pribadi.",
  "Hasil individu tidak diumumkan di grup umum atau di depan kelas.",
  "Jangan mempermalukan atau memberi stigma kepada siswa berdasarkan berat badan atau status gizi.",
  "Akses hanya diberikan kepada pihak yang benar-benar membutuhkan untuk menjalankan tugasnya.",
  "Kesalahan pengukuran harus diperbaiki, bukan dibiarkan karena sudah tersimpan.",
  "Gunakan komunikasi netral seperti “perlu perhatian” atau “perlu pemeriksaan lanjutan”.",
  "Hindari istilah mengejek seperti “terlalu gemuk” atau “terlalu kurus”.",
]

// --- K. Referensi ----------------------------------------------------------

export type EuksGuideReference = {
  title: string
  publisher: string
  description: string
  url: string
}

export const EUKS_GUIDE_REFERENCES: readonly EuksGuideReference[] = [
  {
    title: "Permenkes RI Nomor 2 Tahun 2020 tentang Standar Antropometri Anak",
    publisher: "Kementerian Kesehatan RI",
    description: "Dasar hukum ambang kategori status gizi IMT menurut umur yang dipakai E-UKS.",
    url: "https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-2-tahun-2020",
  },
  {
    title: "WHO Growth Reference – BMI-for-age 5–19 years",
    publisher: "World Health Organization",
    description: "Sumber nilai L/M/S untuk menghitung z-score IMT menurut umur.",
    url: "https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/bmi-for-age",
  },
  {
    title: "SATUSEHAT – Pelayanan Kesehatan Peduli Remaja di Luar Gedung/UKS",
    publisher: "Kementerian Kesehatan RI",
    description: "Acuan layanan kesehatan remaja di sekolah beserta pencatatannya.",
    url: "https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/",
  },
]
