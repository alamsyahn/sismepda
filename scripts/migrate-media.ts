/**
 * Migrasi media legacy (bytea) → penyimpanan media kanonik.
 *
 * SIFAT WAJIB SCRIPT INI:
 *
 *   - TIDAK PERNAH menghapus byte legacy. Kolom bytea adalah jalur rollback;
 *     ia baru boleh dihapus pada fase CONTRACT terpisah, setelah produksi
 *     terverifikasi.
 *   - Idempoten dan resumable: record yang sudah punya kunci dilewati, jadi
 *     script boleh dijalankan berkali-kali dan boleh dihentikan di tengah.
 *   - Urutan aman: tulis berkas → verifikasi ukuran → baru perbarui kunci.
 *     Kegagalan menulis TIDAK PERNAH mengubah database.
 *   - Satu record rusak tidak menghentikan sisanya; kegagalan dikumpulkan dan
 *     dilaporkan di akhir.
 *
 * Script ini TIDAK BOLEH dijalankan terhadap produksi dari mesin pengembangan.
 * Ia memakai DATABASE_URL apa adanya; pilih target lewat `scripts/with-db.ts`
 * seperti perintah database lain (lihat docs/operations/local-database-workflow.md).
 *
 *   npm run media:migrate:local -- --dry-run   inspeksi saja, tanpa menulis
 *   npm run media:migrate:local                migrasi sungguhan (database lokal)
 *
 * Produksi TIDAK memakai perintah ini secara langsung: jalurnya
 * `npm run media:migrate:production` (lihat scripts/migrate-media-production.ts).
 */

// Klien bersama, bukan `new PrismaClient()`: koneksi repo ini memakai adapter
// PrismaPg dengan schema yang ditentukan DATABASE_URL, dan klien telanjang
// tidak akan menemukan schema `sismepda_local`.
import { prisma } from "@/lib/prisma"
import { type MediaScope } from "@/lib/media-keys"
import { mediaStorageRoot, storeMedia } from "@/lib/server-media-storage"

const dryRun = process.argv.includes("--dry-run")

/**
 * Satu sumber media legacy. Ditulis sebagai data, bukan sebagai delapan fungsi
 * yang hampir sama, supaya menambah sumber baru berarti menambah satu baris.
 */
type MediaSource = {
  label: string
  scope: MediaScope
  /** Ambil kandidat: baris yang punya byte legacy tetapi belum punya kunci. */
  load: () => Promise<
    Array<{ id: string; bytes: Uint8Array | null; mimeType: string | null }>
  >
  /** Tulis kunci + ukuran. TIDAK menyentuh kolom bytes. */
  attach: (id: string, key: string, size: number) => Promise<void>
}

const sources: MediaSource[] = [
  {
    label: "User.photo",
    scope: "users/avatar",
    load: async () =>
      (
        await prisma.user.findMany({
          where: { photoKey: null, photoData: { not: null } },
          select: { id: true, photoData: true, photoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.photoData, mimeType: row.photoMimeType })),
    attach: async (id, key, size) => {
      await prisma.user.update({ where: { id }, data: { photoKey: key, photoSize: size } })
    },
  },
  {
    label: "EuksHeroImage.photo",
    scope: "euks/hero",
    load: async () =>
      (
        await prisma.euksHeroImage.findMany({
          where: { photoKey: null, photoData: { not: null } },
          select: { id: true, photoData: true, photoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.photoData, mimeType: row.photoMimeType })),
    attach: async (id, key, size) => {
      await prisma.euksHeroImage.update({ where: { id }, data: { photoKey: key, photoSize: size } })
    },
  },
  {
    label: "EuksHeroLogo.logo",
    scope: "euks/hero-logo",
    load: async () =>
      (
        await prisma.euksHeroLogo.findMany({
          where: { logoKey: null, logoData: { not: null } },
          select: { id: true, logoData: true, logoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.logoData, mimeType: row.logoMimeType })),
    attach: async (id, key, size) => {
      await prisma.euksHeroLogo.update({ where: { id }, data: { logoKey: key, logoSize: size } })
    },
  },
  {
    label: "EuksOfficer.photo",
    scope: "euks/officer",
    load: async () =>
      (
        await prisma.euksOfficer.findMany({
          where: { photoKey: null, photoData: { not: null } },
          select: { id: true, photoData: true, photoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.photoData, mimeType: row.photoMimeType })),
    attach: async (id, key, size) => {
      await prisma.euksOfficer.update({ where: { id }, data: { photoKey: key, photoSize: size } })
    },
  },
  {
    label: "EuksFacility.photo",
    scope: "euks/facility",
    load: async () =>
      (
        await prisma.euksFacility.findMany({
          where: { photoKey: null, photoData: { not: null } },
          select: { id: true, photoData: true, photoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.photoData, mimeType: row.photoMimeType })),
    attach: async (id, key, size) => {
      await prisma.euksFacility.update({ where: { id }, data: { photoKey: key, photoSize: size } })
    },
  },
  {
    label: "SchoolSetting.appLogo",
    scope: "branding/app-logo",
    load: async () =>
      (
        await prisma.schoolSetting.findMany({
          where: { appLogoKey: null, appLogoData: { not: null } },
          select: { id: true, appLogoData: true, appLogoMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.appLogoData, mimeType: row.appLogoMimeType })),
    attach: async (id, key, size) => {
      await prisma.schoolSetting.update({
        where: { id },
        data: { appLogoKey: key, appLogoSize: size },
      })
    },
  },
  {
    label: "SchoolSetting.favicon",
    scope: "branding/favicon",
    load: async () =>
      (
        await prisma.schoolSetting.findMany({
          where: { faviconKey: null, faviconData: { not: null } },
          select: { id: true, faviconData: true, faviconMimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.faviconData, mimeType: row.faviconMimeType })),
    attach: async (id, key, size) => {
      await prisma.schoolSetting.update({
        where: { id },
        data: { faviconKey: key, faviconSize: size },
      })
    },
  },
  {
    label: "SarprasPhoto.data",
    scope: "sarpras/item",
    load: async () =>
      (
        await prisma.sarprasPhoto.findMany({
          where: { mediaKey: null, data: { not: null } },
          select: { id: true, data: true, mimeType: true },
        })
      ).map((row) => ({ id: row.id, bytes: row.data, mimeType: row.mimeType })),
    attach: async (id, key, size) => {
      await prisma.sarprasPhoto.update({ where: { id }, data: { mediaKey: key, mediaSize: size } })
    },
  },
]

type SourceReport = {
  label: string
  candidates: number
  bytes: number
  migrated: number
  skipped: number
  failed: Array<{ id: string; reason: string }>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

async function migrateSource(source: MediaSource): Promise<SourceReport> {
  const report: SourceReport = {
    label: source.label,
    candidates: 0,
    bytes: 0,
    migrated: 0,
    skipped: 0,
    failed: [],
  }

  const rows = await source.load()
  for (const row of rows) {
    // Baris tanpa byte atau tanpa MIME tidak bisa dipindahkan dengan benar;
    // dilewati alih-alih ditebak, dan byte legacy-nya tetap utuh.
    if (!row.bytes || row.bytes.byteLength === 0 || !row.mimeType) {
      report.skipped += 1
      continue
    }

    report.candidates += 1
    report.bytes += row.bytes.byteLength

    if (dryRun) continue

    try {
      // storeMedia sudah memverifikasi ukuran hasil tulis dan membersihkan
      // berkasnya sendiri bila tidak utuh.
      const stored = await storeMedia(source.scope, new Uint8Array(row.bytes), row.mimeType)
      await source.attach(row.id, stored.key, stored.size)
      report.migrated += 1
    } catch (error) {
      // Satu record rusak tidak boleh menghentikan sisanya: sisa media justru
      // lebih aman bila ikut dipindahkan.
      report.failed.push({
        id: row.id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return report
}

async function main() {
  console.log(dryRun ? "== DRY RUN: tidak ada berkas/baris yang diubah ==" : "== Migrasi media ==")
  console.log(`Akar penyimpanan: ${mediaStorageRoot()}`)
  console.log("")

  const reports: SourceReport[] = []
  for (const source of sources) {
    const report = await migrateSource(source)
    reports.push(report)
    const detail = dryRun
      ? `${report.candidates} kandidat, ${formatBytes(report.bytes)}`
      : `${report.migrated}/${report.candidates} dipindahkan`
    console.log(
      `  ${report.label.padEnd(24)} ${detail}${report.skipped > 0 ? `, ${report.skipped} dilewati` : ""}${
        report.failed.length > 0 ? `, ${report.failed.length} GAGAL` : ""
      }`,
    )
  }

  const totals = reports.reduce(
    (accumulator, report) => ({
      candidates: accumulator.candidates + report.candidates,
      bytes: accumulator.bytes + report.bytes,
      migrated: accumulator.migrated + report.migrated,
      failed: accumulator.failed + report.failed.length,
    }),
    { candidates: 0, bytes: 0, migrated: 0, failed: 0 },
  )

  console.log("")
  console.log(`  Total kandidat : ${totals.candidates}`)
  console.log(`  Total byte     : ${formatBytes(totals.bytes)}`)
  if (!dryRun) {
    console.log(`  Dipindahkan    : ${totals.migrated}`)
    console.log(`  Gagal          : ${totals.failed}`)
  }

  const failures = reports.flatMap((report) =>
    report.failed.map((failure) => `${report.label} ${failure.id}: ${failure.reason}`),
  )
  if (failures.length > 0) {
    console.log("")
    console.log("Ringkasan kegagalan:")
    for (const failure of failures) console.log(`  - ${failure}`)
  }

  console.log("")
  console.log("Byte legacy TIDAK dihapus; kolom bytea tetap utuh sebagai fallback.")
  if (dryRun) console.log("Jalankan tanpa --dry-run untuk memindahkan media.")

  // Menahan kode keluar non-nol saat ada kegagalan: pemanggil otomatis harus
  // tahu bahwa migrasi belum tuntas.
  if (totals.failed > 0) process.exitCode = 1
}

// Dipakai test untuk memastikan pemetaan sumber tetap lengkap.
export const MEDIA_MIGRATION_SOURCES = sources.map((source) => ({
  label: source.label,
  scope: source.scope,
}))

main()
  .catch((error) => {
    console.error("Migrasi media gagal:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
