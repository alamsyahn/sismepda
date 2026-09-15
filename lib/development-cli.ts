/**
 * Dokumentasi perintah CLI proyek untuk halaman Development.
 *
 * CLIENT-SAFE dan READ-ONLY. Berkas ini tidak pernah mengeksekusi apa pun:
 * tidak ada `child_process`, tidak ada `exec`/`spawn`, tidak ada pembacaan
 * shell. Satu-satunya hal yang dilakukannya adalah membaca daftar script dari
 * `package.json` lalu memperkayanya dengan kategori dan keterangan.
 *
 * Pembagian tanggung jawab yang disengaja:
 *
 * - `package.json` adalah SUMBER KEBENARAN atas *perintah mana yang ada*.
 *   Daftar di halaman tidak pernah ditulis ulang di sini.
 * - `CLI_METADATA` di bawah hanya menyimpan hal yang memang tidak ada di
 *   `package.json`: kategori tampilan dan penjelasan kegunaannya.
 *
 * Akibatnya dokumentasi tidak bisa diam-diam basi: menambah, menghapus, atau
 * mengganti nama npm script akan membuat `tests/development-cli.test.ts` gagal
 * sampai metadatanya ikut diperbarui.
 */
import packageJson from "../package.json"

/** Kategori tampilan. Label UI berbahasa Indonesia; nama perintah tidak diterjemahkan. */
export const CLI_CATEGORIES = [
  "Development",
  "Database Lokal",
  "Database Prodclone",
  "Prodclone",
  "Data Uji E-UKS",
  "Migrasi Media",
  "Backup Media",
  "Backup Production",
  "Maintenance",
  "Deployment",
  "Aplikasi & Quality",
] as const

export type CliCategory = (typeof CLI_CATEGORIES)[number]

export type CliMetadata = {
  readonly category: CliCategory
  readonly description: string
}

/** Perintah yang ditampilkan di layar. `command` sudah berbentuk siap salin. */
export type CliCommand = {
  readonly no: number
  readonly name: string
  readonly command: string
  readonly category: CliCategory
  readonly description: string
}

/**
 * Keterangan tambahan per npm script, dikunci oleh nama script.
 *
 * Deskripsi harus mencerminkan implementasi sebenarnya — termasuk guard yang
 * ada. Jangan menulis kalimat yang membuat perintah berbahaya terkesan otomatis
 * atau tanpa syarat.
 */
export const CLI_METADATA: Readonly<Record<string, CliMetadata>> = {
  "dev:local": {
    category: "Development",
    description:
      "Menjalankan SISMEPDA dalam mode development di atas database lokal sismepda_dev. Target dipilih scripts/with-db.ts, bukan oleh .env yang kebetulan aktif.",
  },
  "dev:prodclone": {
    category: "Development",
    description:
      "Menjalankan SISMEPDA dalam mode development di atas sismepda_prodclone, clone lokal data produksi. Tidak pernah menyentuh database produksi.",
  },

  "db:migrate:local": {
    category: "Database Lokal",
    description: "Menjalankan prisma migrate dev terhadap database development lokal saja.",
  },
  "db:seed:local": {
    category: "Database Lokal",
    description: "Menjalankan prisma db seed (seed idempoten) pada database development lokal.",
  },
  "db:setup:local": {
    category: "Database Lokal",
    description: "Menjalankan db:migrate:local lalu db:seed:local secara berurutan.",
  },
  "db:studio:local": {
    category: "Database Lokal",
    description: "Membuka Prisma Studio yang terhubung ke database development lokal.",
  },
  "db:ensure-test-user:local": {
    category: "Database Lokal",
    description:
      "Memastikan satu akun uji development tersedia beserta keanggotaan role system_admin. Menolak berjalan tanpa ALLOW_LOCAL_TEST_USER dan di luar database lokal.",
  },
  "db:bootstrap:local": {
    category: "Database Lokal",
    description:
      "Menyiapkan state development lokal: memastikan akun uji lalu membangkitkan data uji E-UKS, keduanya terhadap database lokal.",
  },

  "db:studio:prodclone": {
    category: "Database Prodclone",
    description: "Membuka Prisma Studio yang terhubung ke clone lokal sismepda_prodclone.",
  },
  "db:prodclone:refresh": {
    category: "Database Prodclone",
    description:
      "Membuat ulang database clone lokal dari produksi. Produksi hanya DIBACA (pg_dump); yang dihapus dan dibuat ulang adalah clone lokal, dan guard menolak bila target bukan clone yang boleh dimusnahkan.",
  },
  "db:analyze-legacy-dates:prodclone": {
    category: "Database Prodclone",
    description:
      "Menganalisis tanggal bisnis legacy pada prodclone: baris yang akan bergeser, pasangan yang bertabrakan, dan duplikat persis. Sepenuhnya read-only; tidak menulis apa pun.",
  },

  "media:prodclone:sync": {
    category: "Prodclone",
    description:
      "Menyalin berkas media produksi ke penyimpanan media prodclone lokal secara inkremental. Arah salin satu arah, dari produksi ke lokal.",
  },
  "prodclone:refresh": {
    category: "Prodclone",
    description:
      "Orkestrator refresh prodclone lengkap: menjalankan refresh database lalu sinkronisasi media. Tidak menduplikasi logikanya, hanya memanggil keduanya berurutan.",
  },

  "euks:seed:local": {
    category: "Data Uji E-UKS",
    description:
      "Membangkitkan data uji E-UKS sintetis pada database lokal. Bukan untuk produksi: guard menolak setiap database di luar daftar database lokal yang diizinkan.",
  },
  "euks:clear:local": {
    category: "Data Uji E-UKS",
    description:
      "Menghapus data uji E-UKS dari database lokal. Hanya baris bertanda sintetis yang dihapus; data E-UKS asli tidak disentuh.",
  },
  "euks:seed:prodclone": {
    category: "Data Uji E-UKS",
    description:
      "Membangkitkan data uji E-UKS sintetis pada clone lokal prodclone. Bukan untuk produksi; guard yang sama berlaku.",
  },
  "euks:clear:prodclone": {
    category: "Data Uji E-UKS",
    description:
      "Menghapus data uji E-UKS dari clone lokal prodclone, terbatas pada baris bertanda sintetis.",
  },

  "media:migrate:local": {
    category: "Migrasi Media",
    description:
      "Memindahkan media legacy bytea menjadi berkas media kanonik pada database lokal. Idempoten, dan bytea legacy tetap dipertahankan sebagai cadangan.",
  },
  "media:migrate:verify:local": {
    category: "Migrasi Media",
    description:
      "Memverifikasi referensi media pada database lokal: setiap kunci punya berkas, dan bytea legacy masih utuh. Read-only.",
  },
  "media:migrate:production": {
    category: "Migrasi Media",
    description:
      "Entrypoint migrasi media produksi lewat container migrator. Bermode dan fail-closed: --dry-run tanpa tulisan, --verify read-only, dan --apply menolak berjalan tanpa backup set yang lolos verifikasi.",
  },

  "media:backup:create": {
    category: "Backup Media",
    description: "Membuat arsip backup berkas media beserta manifesnya.",
  },
  "media:backup:verify": {
    category: "Backup Media",
    description: "Memverifikasi arsip backup media terhadap manifes dan checksum-nya.",
  },
  "media:backup:restore-test": {
    category: "Backup Media",
    description:
      "Menguji pemulihan backup media ke direktori sementara untuk membuktikan arsip benar-benar dapat dipulihkan.",
  },

  "backup:production": {
    category: "Backup Production",
    description:
      "Membuat backup produksi lengkap: dump PostgreSQL beserta arsip volume media, dikumpulkan sebagai satu backup set.",
  },
  "backup:production:verify": {
    category: "Backup Production",
    description:
      "Memverifikasi satu backup set secara lokal: arsip terbaca, manifes dan checksum cocok, dan tidak memuat rahasia. Inilah gerbang yang harus lolos sebelum migrasi media produksi diizinkan.",
  },

  "db:rbac-backfill": {
    category: "Maintenance",
    description:
      "Utilitas backfill RBAC dari kolom role legacy. Target database tidak dipilih otomatis: operator wajib menyebut --database=<nama> dan skrip menolak bila database yang tersambung tidak sama persis. Tanpa --apply, jalannya hanya simulasi.",
  },

  "deploy:check": {
    category: "Deployment",
    description:
      "Pemeriksaan sisi lokal sebelum deployment: kondisi working tree, commit, dan kesiapan artefak.",
  },
  "deploy:preflight": {
    category: "Deployment",
    description:
      "Pemeriksaan kesiapan terhadap host produksi sebelum deployment dijalankan, tanpa mengubah apa pun.",
  },
  "deploy:prod": {
    category: "Deployment",
    description:
      "Menjalankan alur deployment produksi bertahap, termasuk backup pra-deploy dan migrasi schema. Ini satu-satunya jalur normal perubahan schema produksi.",
  },
  "deploy:status": {
    category: "Deployment",
    description:
      "Menampilkan status produksi saat ini: commit yang berjalan, kesehatan service, dan migrasi yang tertunda. Read-only.",
  },

  "build": {
    category: "Aplikasi & Quality",
    description: "Membangun aplikasi Next.js untuk produksi.",
  },
  "start": {
    category: "Aplikasi & Quality",
    description: "Menjalankan hasil build produksi Next.js.",
  },
  "lint": {
    category: "Aplikasi & Quality",
    description: "Menjalankan ESLint pada seluruh proyek.",
  },
  "test": {
    category: "Aplikasi & Quality",
    description: "Menjalankan seluruh suite test otomatis.",
  },
  "postinstall": {
    category: "Aplikasi & Quality",
    description:
      "Menjalankan prisma generate. Normalnya dipanggil otomatis oleh siklus hidup npm setelah instalasi dependency, bukan diketik manual.",
  },
}

/** Nama script apa adanya dari package.json, urutannya dipertahankan. */
export function npmScriptNames(): string[] {
  return Object.keys(packageJson.scripts ?? {})
}

/**
 * Daftar perintah untuk ditampilkan.
 *
 * Urutan mengikuti `package.json` supaya tampilannya dekat dengan hasil
 * `npm run`. Script tanpa metadata sengaja TIDAK dilewati diam-diam: ia tetap
 * muncul dengan keterangan kosong sehingga contract test menangkapnya, alih-alih
 * menghilang tanpa jejak dari dokumentasi.
 */
export function developmentCliCommands(): CliCommand[] {
  return npmScriptNames().map((name, index) => {
    const meta = CLI_METADATA[name]
    return {
      no: index + 1,
      name,
      command: `npm run ${name}`,
      category: meta?.category ?? ("Maintenance" as CliCategory),
      description: meta?.description ?? "",
    }
  })
}
