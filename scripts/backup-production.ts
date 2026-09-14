/**
 * Backup produksi lengkap: database + media sebagai SATU set pemulihan.
 *
 *   npm run backup:production -- --dry-run     cetak rencana, tidak mengeksekusi
 *   npm run backup:production                  jalankan terhadap produksi
 *   npm run backup:production -- --verify <dir>   verifikasi set yang sudah ada
 *
 * MENGAPA PERINTAH INI ADA
 *
 * Setelah media dipisahkan dari database, `pg_dump` saja BUKAN lagi backup
 * lengkap SISMEPDA. Dump yang lolos sendirian justru berbahaya: ia terlihat
 * seperti backup utuh padahal seluruh foto tidak ada di dalamnya. Perintah ini
 * mengikat keduanya dengan satu set id dan satu manifest, dan menolak menyebut
 * hasilnya "lengkap" bila salah satunya gagal.
 *
 * URUTAN DAN BATASNYA — dinyatakan terbuka, bukan disembunyikan:
 *
 *   1. dump database   → 2. verifikasi dump
 *   3. arsip media     → 4. verifikasi arsip
 *   5. tulis manifest
 *
 * Database dibackup LEBIH DULU. Alasannya mengikuti urutan tulis media
 * kanonik: berkas ditulis dulu, baru referensi database diperbarui. Dengan
 * urutan backup ini, media yang diunggah di antara kedua langkah akan muncul
 * sebagai BERKAS TANPA REFERENSI di set backup — tidak terpakai, tetapi tidak
 * merusak apa pun. Urutan sebaliknya menghasilkan REFERENSI TANPA BERKAS, yaitu
 * gambar rusak setelah restore. Ini bukan snapshot atomik dan tidak diklaim
 * demikian; celahnya hanya sebesar jarak antara dua langkah tersebut.
 *
 * Perintah ini TIDAK menghapus backup lama. Retensi (`lib/backup-set.ts`)
 * baru memilih kandidat; eksekusi penghapusannya adalah fase terpisah.
 */

import { spawnSync } from "node:child_process"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  BackupSetError,
  authorizeLegacyMediaMigration,
  DATABASE_ARCHIVE,
  MEDIA_ARCHIVE,
  BACKUP_SET_MANIFEST,
  backupSetId,
  buildManifest,
  parseBackupSetManifest,
  verifyBackupSet,
} from "@/lib/backup-set"
import { formatBytes } from "@/lib/rollout-preflight"
import { production, redactSecrets, shellQuote } from "@/lib/deployment"
import { BACKUP_SET_ROOT, backupSetScript } from "@/lib/backup-production-script"
import { decideBackupMode, readActivationFacts } from "@/lib/media-activation"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const verifyIndex = args.indexOf("--verify")

function fail(message: string): never {
  console.error(`ABORT: ${message}`)
  process.exit(1)
}

function ssh(script: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", production.sshAlias, "bash -s"],
    { input: script, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message }
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function parse(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match) result[match[1]] = match[2]
  }
  return result
}

/** Verifikasi manifest set backup lokal — dipakai untuk uji dan restore drill. */
async function verifyLocalSet(dir: string): Promise<number> {
  const manifestPath = path.join(dir, BACKUP_SET_MANIFEST)
  let manifest
  try {
    manifest = parseBackupSetManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  } catch (error) {
    if (error instanceof BackupSetError) fail(error.message)
    fail(`Manifest tidak dapat dibaca: ${String(error)}`)
  }

  const problems = verifyBackupSet(manifest)
  console.log(`Backup set ${manifest.setId}`)
  console.log(`  dibuat     ${manifest.createdAt}`)
  console.log(`  commit     ${manifest.commit ?? "(tidak dicatat)"}`)
  console.log(`  mode       ${manifest.backupMode}`)
  console.log(`  database   ${manifest.database.file} ${formatBytes(manifest.database.bytes)}`)
  if (manifest.media === null) {
    console.log(
      `  media      TIDAK BERLAKU — ${manifest.mediaNotApplicableReason ?? "alasan tidak dicatat"}`,
    )
  } else {
    console.log(
      `  media      ${manifest.media.file} ${formatBytes(manifest.media.bytes)} (${manifest.media.fileCount} berkas)`,
    )
  }

  const components = manifest.media === null ? [manifest.database] : [manifest.database, manifest.media]
  for (const component of components) {
    const filePath = path.join(dir, component.file)
    try {
      const info = await stat(filePath)
      if (info.size !== component.bytes) {
        problems.push({
          code: "size-mismatch",
          message: `${component.file}: ukuran di disk ${info.size} ≠ manifest ${component.bytes}.`,
        })
      }
    } catch {
      problems.push({ code: "missing", message: `${component.file} tidak ada di ${dir}.` })
    }
  }

  if (problems.length > 0) {
    console.log("\nSet BERMASALAH:")
    for (const problem of problems) console.log(`  - ${problem.message}`)
    return 1
  }

  // Verifikasi set sekaligus menjawab pertanyaan operasional berikutnya:
  // bolehkah migrasi media legacy dijalankan dengan bekal set ini? Jawabannya
  // diberikan di sini karena hanya di sinilah manifest benar-benar dibaca.
  const migrationBlockers = authorizeLegacyMediaMigration(manifest)
  if (manifest.backupMode === "pre-media-bootstrap") {
    console.log("\nSet bootstrap terverifikasi (database saja; media belum berlaku).")
  } else {
    console.log("\nSet lengkap dan terverifikasi.")
  }

  if (migrationBlockers.length > 0) {
    console.log("\nMigrasi media legacy BELUM boleh dijalankan dengan set ini:")
    for (const blocker of migrationBlockers) console.log(`  - ${blocker.message}`)
  } else {
    console.log("\nSet ini memenuhi syarat sebagai backup sebelum migrasi media legacy.")
  }
  return 0
}

async function main(): Promise<number> {
  if (verifyIndex >= 0) {
    const dir = args[verifyIndex + 1]
    if (!dir) fail("Pemakaian: --verify <direktori set>")
    return await verifyLocalSet(dir)
  }

  const now = new Date()
  const setId = backupSetId(now)

  if (dryRun) {
    console.log("== DRY RUN: tidak ada perintah yang dikirim ke produksi ==\n")
    console.log(`Set id      ${setId}`)
    console.log(`Tujuan      ${production.sshAlias}:${BACKUP_SET_ROOT}/${setId}`)
    console.log(`Komponen    ${DATABASE_ARCHIVE}, ${MEDIA_ARCHIVE}, ${BACKUP_SET_MANIFEST}`)
    console.log("\nUrutan:")
    console.log("  1. pg_dump                → database.dump")
    console.log("  2. pg_restore --list      → verifikasi database")
    console.log("  3. tar dari MEDIA_STORAGE_ROOT → media.tar.gz")
    console.log("  4. hitung ulang isi arsip → verifikasi media")
    console.log("  5. tulis manifest.json")
    console.log("\nTidak ada backup lama yang dihapus.")
    return 0
  }

  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? ""

  console.log(`Backup set ${setId} → ${production.sshAlias}:${BACKUP_SET_ROOT}/${setId}`)
  const result = ssh(backupSetScript(setId))
  if (!result.ok) {
    fail(`Backup produksi gagal:\n${redactSecrets(result.stderr || result.stdout).trim()}`)
  }

  const info = parse(result.stdout)

  // Keadaan produksi ditentukan dari fakta yang baru saja dilaporkan skrip
  // remote, bukan dari asumsi. Aturannya sendiri ada di `lib/media-activation`
  // supaya dapat diuji tanpa produksi.
  const decision = decideBackupMode(readActivationFacts(info), info.MEDIA_ARCHIVE_SKIPPED !== "yes")

  console.log("\nKeadaan media produksi:")
  for (const reason of decision.reasons) console.log(`  ${reason}`)

  if (!decision.ok) {
    fail(`BACKUP DIBATALKAN\n${decision.error}\nPerbaiki konfigurasi lebih dulu; jangan lanjutkan deploy.`)
  }
  const bootstrap = decision.bootstrap

  const manifest = buildManifest({
    setId,
    createdAt: now,
    commit: commit || null,
    backupMode: bootstrap ? "pre-media-bootstrap" : "complete",
    database: {
      file: DATABASE_ARCHIVE,
      bytes: Number.parseInt(info.DATABASE_BYTES ?? "0", 10),
      verified: info.DATABASE_VERIFIED === "yes",
    },
    media: bootstrap
      ? null
      : {
          file: MEDIA_ARCHIVE,
          bytes: Number.parseInt(info.MEDIA_BYTES ?? "0", 10),
          fileCount: Number.parseInt(info.MEDIA_COUNT ?? "0", 10),
          verified: info.MEDIA_VERIFIED === "yes",
        },
  })

  // Manifest ditulis dari mesin operator, lalu dikirim — bukan dirakit di shell
  // remote, supaya validasi "tidak ada rahasia" berjalan sebelum menyentuh disk.
  const localDir = path.join(".backup-sets", setId)
  await mkdir(localDir, { recursive: true })
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(path.join(localDir, BACKUP_SET_MANIFEST), serialized, "utf8")

  const upload = ssh(
    [
      "set -euo pipefail",
      `cat > ${shellQuote(`${BACKUP_SET_ROOT}/${setId}/${BACKUP_SET_MANIFEST}`)} <<'SISMEPDA_MANIFEST_EOF'`,
      serialized.trimEnd(),
      "SISMEPDA_MANIFEST_EOF",
      "echo MANIFEST_WRITTEN",
    ].join("\n"),
  )
  if (!upload.ok) fail(`Manifest gagal ditulis:\n${redactSecrets(upload.stderr).trim()}`)

  const problems = verifyBackupSet(manifest)
  console.log(`\n  mode       ${manifest.backupMode}`)
  console.log(`  database   ${formatBytes(manifest.database.bytes)} terverifikasi`)
  if (manifest.media === null) {
    console.log("  media      TIDAK BERLAKU — belum ada media di luar database")
  } else {
    console.log(
      `  media      ${formatBytes(manifest.media.bytes)} (${manifest.media.fileCount} berkas) terverifikasi`,
    )
  }
  console.log(`  manifest   ${path.join(localDir, BACKUP_SET_MANIFEST)} (salinan lokal)`)

  if (problems.length > 0) {
    console.log("\nSet BERMASALAH:")
    for (const problem of problems) console.log(`  - ${problem.message}`)
    return 1
  }

  if (manifest.backupMode === "pre-media-bootstrap") {
    console.log(
      "\nBackup bootstrap selesai dan terverifikasi.\n" +
        "Set ini memuat SELURUH media yang ada, karena semuanya masih berada di dalam database.\n" +
        "Set ini BUKAN backup lengkap: begitu media storage aktif, buat set lengkap baru\n" +
        "sebelum mempertimbangkan migrasi media legacy.",
    )
    return 0
  }

  console.log("\nBackup set lengkap.")
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => fail(redactSecrets(String(error))))
