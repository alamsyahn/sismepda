/**
 * Verifikasi migrasi media — READ-ONLY.
 *
 *   npm run media:migrate:verify
 *
 * Script ini tidak menulis berkas, tidak mengubah baris, dan tidak menghapus
 * apa pun. Ia menjawab satu pertanyaan: untuk setiap record yang mengklaim
 * punya media di penyimpanan kanonik, apakah berkasnya benar-benar ada dan
 * berukuran sesuai?
 *
 * Kolom bytea legacy ikut dihitung, tetapi hanya untuk MEMBUKTIKAN bahwa ia
 * masih ada. Selama rollback masih mungkin, hilangnya byte legacy adalah
 * temuan serius, bukan keberhasilan.
 *
 * Sama seperti `media:migrate`, target ditentukan lewat `scripts/with-db.ts`,
 * bukan dengan mengedit DATABASE_URL.
 */

import { stat } from "node:fs/promises"
import path from "node:path"

import { prisma } from "@/lib/prisma"
import { mediaStorageRoot } from "@/lib/server-media-storage"
import { tally, type VerificationTally } from "@/lib/media-verification"

type Row = { id: string; key: string | null; size: number | null; hasLegacy: boolean }

type Source = {
  label: string
  load: () => Promise<Row[]>
}

const sources: Source[] = [
  {
    label: "User.photo",
    load: async () =>
      (
        await prisma.user.findMany({
          where: { OR: [{ photoKey: { not: null } }, { photoData: { not: null } }] },
          select: { id: true, photoKey: true, photoSize: true, photoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.photoKey,
        size: row.photoSize,
        hasLegacy: row.photoData !== null,
      })),
  },
  {
    label: "EuksHeroImage.photo",
    load: async () =>
      (
        await prisma.euksHeroImage.findMany({
          where: { OR: [{ photoKey: { not: null } }, { photoData: { not: null } }] },
          select: { id: true, photoKey: true, photoSize: true, photoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.photoKey,
        size: row.photoSize,
        hasLegacy: row.photoData !== null,
      })),
  },
  {
    label: "EuksHeroLogo.logo",
    load: async () =>
      (
        await prisma.euksHeroLogo.findMany({
          where: { OR: [{ logoKey: { not: null } }, { logoData: { not: null } }] },
          select: { id: true, logoKey: true, logoSize: true, logoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.logoKey,
        size: row.logoSize,
        hasLegacy: row.logoData !== null,
      })),
  },
  {
    label: "EuksOfficer.photo",
    load: async () =>
      (
        await prisma.euksOfficer.findMany({
          where: { OR: [{ photoKey: { not: null } }, { photoData: { not: null } }] },
          select: { id: true, photoKey: true, photoSize: true, photoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.photoKey,
        size: row.photoSize,
        hasLegacy: row.photoData !== null,
      })),
  },
  {
    label: "EuksFacility.photo",
    load: async () =>
      (
        await prisma.euksFacility.findMany({
          where: { OR: [{ photoKey: { not: null } }, { photoData: { not: null } }] },
          select: { id: true, photoKey: true, photoSize: true, photoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.photoKey,
        size: row.photoSize,
        hasLegacy: row.photoData !== null,
      })),
  },
  {
    label: "SchoolSetting.appLogo",
    load: async () =>
      (
        await prisma.schoolSetting.findMany({
          where: { OR: [{ appLogoKey: { not: null } }, { appLogoData: { not: null } }] },
          select: { id: true, appLogoKey: true, appLogoSize: true, appLogoData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.appLogoKey,
        size: row.appLogoSize,
        hasLegacy: row.appLogoData !== null,
      })),
  },
  {
    label: "SchoolSetting.favicon",
    load: async () =>
      (
        await prisma.schoolSetting.findMany({
          where: { OR: [{ faviconKey: { not: null } }, { faviconData: { not: null } }] },
          select: { id: true, faviconKey: true, faviconSize: true, faviconData: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.faviconKey,
        size: row.faviconSize,
        hasLegacy: row.faviconData !== null,
      })),
  },
  {
    label: "SarprasPhoto.data",
    load: async () =>
      (
        await prisma.sarprasPhoto.findMany({
          where: { OR: [{ mediaKey: { not: null } }, { data: { not: null } }] },
          select: { id: true, mediaKey: true, mediaSize: true, data: true },
        })
      ).map((row) => ({
        id: row.id,
        key: row.mediaKey,
        size: row.mediaSize,
        hasLegacy: row.data !== null,
      })),
  },
]

async function main(): Promise<number> {
  const root = mediaStorageRoot()
  console.log("== Verifikasi media (read-only) ==")
  console.log(`Akar penyimpanan: ${root}\n`)

  const totals: VerificationTally = {
    total: 0,
    migrated: 0,
    valid: 0,
    missing: 0,
    mismatch: 0,
    legacyRetained: 0,
    orphaned: 0,
  }
  const anomalies: string[] = []

  for (const source of sources) {
    const rows = await source.load()
    const checked = []

    for (const row of rows) {
      let fileExists = false
      let sizeMatches = false
      if (row.key) {
        try {
          const info = await stat(path.join(root, row.key))
          fileExists = true
          // Ukuran null di database bukan kecocokan; itu metadata yang hilang.
          sizeMatches = row.size !== null && info.size === row.size
          if (!sizeMatches) {
            anomalies.push(
              `${source.label} ${row.id}: berkas ${info.size} B, database ${row.size ?? "null"} B`,
            )
          }
        } catch {
          anomalies.push(`${source.label} ${row.id}: berkas hilang (${row.key})`)
        }
      } else if (!row.hasLegacy) {
        anomalies.push(`${source.label} ${row.id}: tanpa kunci dan tanpa byte legacy`)
      }
      checked.push({ key: row.key, hasLegacy: row.hasLegacy, fileExists, sizeMatches })
    }

    const sub = tally(checked)
    totals.total += sub.total
    totals.migrated += sub.migrated
    totals.valid += sub.valid
    totals.missing += sub.missing
    totals.mismatch += sub.mismatch
    totals.legacyRetained += sub.legacyRetained
    totals.orphaned += sub.orphaned

    console.log(
      `${source.label.padEnd(24)} total ${String(sub.total).padStart(4)}  ` +
        `migrated ${String(sub.migrated).padStart(4)}  valid ${String(sub.valid).padStart(4)}  ` +
        `missing ${String(sub.missing).padStart(3)}  mismatch ${String(sub.mismatch).padStart(3)}  ` +
        `legacy ${String(sub.legacyRetained).padStart(4)}`,
    )
  }

  console.log("\n" + "-".repeat(72))
  console.log(`total           ${totals.total}`)
  console.log(`migrated        ${totals.migrated}`)
  console.log(`valid           ${totals.valid}`)
  console.log(`missing         ${totals.missing}`)
  console.log(`mismatch        ${totals.mismatch}`)
  console.log(`legacy retained ${totals.legacyRetained}`)
  console.log(`orphaned        ${totals.orphaned}`)

  if (anomalies.length > 0) {
    console.log("\nAnomali:")
    for (const line of anomalies.slice(0, 50)) console.log(`  - ${line}`)
    if (anomalies.length > 50) console.log(`  ... dan ${anomalies.length - 50} lagi`)
  }

  const failed = totals.missing > 0 || totals.mismatch > 0 || totals.orphaned > 0
  console.log(`\nHasil: ${failed ? "BERMASALAH" : "OK"}`)
  return failed ? 1 : 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (error) => {
    console.error(`ABORT: ${String(error)}`)
    await prisma.$disconnect()
    process.exit(1)
  })
