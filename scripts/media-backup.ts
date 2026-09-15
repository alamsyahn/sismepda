/**
 * Backup media: buat, verifikasi, dan restore uji.
 *
 *   npm run media:backup:create
 *   npm run media:backup:verify -- <arsip>
 *   npm run media:backup:restore-test -- <arsip>
 *
 * Backup TIDAK PERNAH mengubah media sumber: seluruh operasi pada pohon sumber
 * bersifat baca. Arsip ditulis ke direktori di luar pohon media, dan retensi
 * otomatis sengaja tidak ada — menghapus backup lama memerlukan desain retensi
 * eksplisit, bukan efek samping.
 */

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, copyFile, link, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  archiveNameFor,
  assertArchiveOutsideSource,
  assertSafeArchiveEntry,
  backupRunId,
  formatBytes,
  MEDIA_ARCHIVE_PREFIX,
  MEDIA_MANIFEST_ENTRY,
  MEDIA_MANIFEST_VERSION,
  MediaBackupError,
  parseManifest,
  type MediaManifest,
  type MediaManifestFile,
} from "@/lib/media-backup"
import { mediaStorageRoot } from "@/lib/server-media-storage"

/** Direktori arsip default; di luar pohon media, dan ter-gitignore. */
const DEFAULT_BACKUP_DIR = ".media-backups"

function fail(message: string): never {
  console.error(`ABORT: ${message}`)
  process.exit(1)
}

/**
 * Jalankan `tar` secara portable.
 *
 * Dua implementasi tar harus dilayani: GNU tar di Ubuntu produksi, dan bsdtar
 * bawaan Windows 11 (`C:\Windows\System32\tar.exe`) di mesin pengembangan.
 * Keduanya hanya sepakat pada irisan kecil: `-c`/`-t`/`-x`, `-z`, `-f`, dan
 * `-C`. Opsi GNU seperti `--force-local`, `--transform`, dan `--files-from`
 * ditolak bsdtar, jadi tidak satu pun dipakai di sini.
 *
 * Nama arsip SELALU diberikan sebagai basename dengan `cwd` di direktori arsip,
 * tidak pernah sebagai jalur absolut. Sebabnya: tar menafsirkan `D:\...` sebagai
 * "host D, path ..." (sintaks arsip remote), dan itulah yang dulu memaksa
 * pemakaian `--force-local`. Dengan basename, `D:` tidak pernah sampai ke tar,
 * sehingga tidak ada yang perlu dipaksa menjadi lokal — masalahnya hilang, bukan
 * ditambal.
 *
 * `spawnSync` dipanggil dengan array argumen dan tanpa shell, sehingga nama
 * berkas tidak pernah melewati parser shell.
 */
function runTar(args: string[], cwd: string): string {
  const result = spawnSync("tar", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  if (result.error) throw new MediaBackupError(`tar gagal dijalankan: ${result.error.message}`)
  if (result.status !== 0) {
    throw new MediaBackupError(`tar keluar dengan kode ${result.status}: ${result.stderr?.trim()}`)
  }
  return result.stdout ?? ""
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
  })
}

/**
 * Kumpulkan seluruh berkas di bawah akar media.
 *
 * `withFileTypes` dipakai supaya symlink dikenali dan DILEWATI: mengikuti
 * symlink berarti arsip dapat menyedot berkas arbitrer dari luar pohon media.
 */
async function collectFiles(root: string, relative = ""): Promise<string[]> {
  const absolute = path.join(root, relative)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      console.warn(`  Dilewati (symlink): ${childRelative}`)
      continue
    }
    if (entry.isDirectory()) {
      found.push(...(await collectFiles(root, childRelative)))
    } else if (entry.isFile()) {
      found.push(childRelative)
    }
  }
  return found
}

async function createBackup(): Promise<void> {
  const source = mediaStorageRoot()
  const backupDir = path.resolve(process.cwd(), process.env.MEDIA_BACKUP_DIR ?? DEFAULT_BACKUP_DIR)

  const sourceExists = await stat(source).catch(() => null)
  if (!sourceExists?.isDirectory()) {
    fail(`akar media tidak ditemukan atau bukan direktori: ${source}`)
  }

  const runId = backupRunId(new Date())
  const archivePath = path.join(backupDir, archiveNameFor(runId))
  assertArchiveOutsideSource(archivePath, source)

  console.log("SISMEPDA Media Backup")
  console.log("")
  console.log(`  Sumber : ${source}`)
  console.log(`  Arsip  : ${archivePath}`)
  console.log("")

  const relativeFiles = await collectFiles(source)
  if (relativeFiles.length === 0) {
    // Bukan kegagalan: instalasi baru memang belum punya media. Tetap dibuat
    // arsipnya supaya rantai backup tidak berlubang.
    console.log("  Peringatan: tidak ada berkas media untuk dibackup.")
  }

  const files: MediaManifestFile[] = []
  for (const relative of relativeFiles) {
    assertSafeArchiveEntry(`${MEDIA_ARCHIVE_PREFIX}/${relative}`)
    const absolute = path.join(source, relative)
    const info = await stat(absolute)
    files.push({ key: relative, size: info.size, sha256: await sha256File(absolute) })
  }

  const manifest: MediaManifest = {
    version: MEDIA_MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    runId,
    // Identitas sumber tanpa membocorkan jalur absolut server.
    sourceId: `${path.basename(source)}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    files,
  }

  await mkdir(backupDir, { recursive: true })

  // Manifest dan pohon media dirakit lebih dulu menjadi SATU direktori staging
  // yang sudah berbentuk persis seperti isi arsip, lalu tar dipanggil sekali
  // dengan `-C staging .`. Sebelumnya bentuk arsip dirakit oleh tar sendiri
  // lewat `--transform` + `--files-from`; keduanya opsi GNU yang ditolak bsdtar
  // Windows. Merakit di filesystem memakai API Node membuat bentuk arsip
  // identik di kedua platform tanpa bergantung pada dialek tar mana pun.
  //
  // Isi media dimasukkan sebagai HARD LINK, bukan salinan: tidak ada byte yang
  // digandakan, dan pohon media sumber tetap hanya dibaca. Bila hard link tidak
  // mungkin (mis. staging berada di volume lain), disalin sebagai cadangan.
  //
  // Symlink sudah disaring saat pengumpulan berkas, sehingga staging hanya
  // pernah berisi berkas biasa dan arsip tidak dapat menyedot berkas dari luar
  // pohon media.
  const staging = await mkdtemp(path.join(tmpdir(), "sismepda-backup-"))
  try {
    await writeFile(path.join(staging, MEDIA_MANIFEST_ENTRY), JSON.stringify(manifest, null, 2))

    const payloadRoot = path.join(staging, MEDIA_ARCHIVE_PREFIX)
    // Dibuat walau tidak ada berkas media, supaya nama anggota arsip tetap ada
    // dan bentuk arsip sama untuk instalasi baru maupun yang sudah terisi.
    await mkdir(payloadRoot, { recursive: true })
    for (const relative of relativeFiles) {
      const destination = path.join(payloadRoot, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      const origin = path.join(source, relative)
      try {
        await link(origin, destination)
      } catch {
        await copyFile(origin, destination)
      }
    }

    // Anggota arsip disebut namanya (`manifest.json`, `media`), bukan `.`:
    // dengan `.` setiap entri menjadi `./media/...` dan bentuk arsip berubah.
    // Arsip ditulis sebagai basename dengan cwd di direktori arsip — lihat
    // runTar() untuk alasan drive letter.
    runTar(
      ["-czf", path.basename(archivePath), "-C", staging, MEDIA_MANIFEST_ENTRY, MEDIA_ARCHIVE_PREFIX],
      backupDir,
    )
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  const archiveInfo = await stat(archivePath)
  console.log(`  Berkas : ${manifest.fileCount}`)
  console.log(`  Ukuran : ${formatBytes(manifest.totalBytes)} (arsip ${formatBytes(archiveInfo.size)})`)
  console.log(`  Run ID : ${manifest.runId}`)
  console.log("")
  console.log("Media sumber tidak diubah. Verifikasi arsip dengan:")
  console.log(`  npm run media:backup:verify -- ${archivePath}`)
}

type VerifyResult = { manifest: MediaManifest; entries: string[] }

async function verifyBackup(archivePath: string, extractTo?: string): Promise<VerifyResult> {
  const absolute = path.resolve(process.cwd(), archivePath)
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) fail(`arsip tidak ditemukan: ${absolute}`)

  console.log("SISMEPDA Media Backup Verify")
  console.log("")
  console.log(`  Arsip  : ${absolute}`)

  // Arsip dirujuk sebagai basename dengan cwd di direktorinya, sehingga drive
  // letter Windows tidak pernah terlihat oleh tar. Lihat runTar().
  const archiveDir = path.dirname(absolute)
  const archiveName = path.basename(absolute)

  // 1. Arsip harus benar-benar dapat dibaca, bukan sekadar ada.
  //
  // Entri direktori dibuang di sini. Kedua implementasi tar menandainya dengan
  // garis miring di akhir, tetapi jumlah entri direktori yang ditulis berbeda
  // antar implementasi — membandingkannya dengan `fileCount` pada manifest akan
  // membuat verifikasi gagal hanya karena dialek tar, bukan karena arsip rusak.
  // Yang dihitung adalah berkasnya.
  const listing = runTar(["-tzf", archiveName], archiveDir)
  const rawEntries = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const entries = rawEntries
    .filter((line) => !line.endsWith("/"))
    .map((line) => line.replace(/^\.\//, ""))
    .filter((line) => line !== "." && line !== MEDIA_ARCHIVE_PREFIX)

  // 2. Tidak ada entri yang dapat lolos dari direktori ekstraksi. Nama
  // direktori ikut diperiksa: entri direktori pun tidak boleh menunjuk keluar.
  for (const entry of rawEntries) {
    const normalized = entry.replace(/\/$/, "").replace(/^\.\//, "")
    if (normalized === "." || normalized === "" || normalized === MEDIA_ARCHIVE_PREFIX) continue
    assertSafeArchiveEntry(normalized)
  }

  // 3. Manifest harus ada, terbaca, dan konsisten dengan dirinya sendiri.
  const target = extractTo ?? (await mkdtemp(path.join(tmpdir(), "sismepda-verify-")))
  const ephemeral = extractTo === undefined
  try {
    await mkdir(target, { recursive: true })
    runTar(["-xzf", archiveName, "-C", target], archiveDir)

    const manifestRaw = await readFile(path.join(target, MEDIA_MANIFEST_ENTRY), "utf8")
    const manifest = parseManifest(JSON.parse(manifestRaw))

    // 4. Isi arsip harus cocok dengan manifest — jumlah DAN checksum.
    const archived = entries.filter((entry) => entry.startsWith(`${MEDIA_ARCHIVE_PREFIX}/`))
    if (archived.length !== manifest.fileCount) {
      throw new MediaBackupError(
        `Jumlah berkas dalam arsip (${archived.length}) tidak cocok dengan manifest (${manifest.fileCount})`,
      )
    }

    let verified = 0
    for (const file of manifest.files) {
      const restored = path.join(target, MEDIA_ARCHIVE_PREFIX, ...file.key.split("/"))
      const restoredInfo = await stat(restored).catch(() => null)
      if (!restoredInfo?.isFile()) {
        throw new MediaBackupError(`Berkas manifest tidak ada dalam arsip: ${file.key}`)
      }
      if (restoredInfo.size !== file.size) {
        throw new MediaBackupError(`Ukuran berbeda setelah ekstraksi: ${file.key}`)
      }
      if ((await sha256File(restored)) !== file.sha256) {
        throw new MediaBackupError(`Checksum tidak cocok setelah ekstraksi: ${file.key}`)
      }
      verified += 1
    }

    console.log(`  Berkas : ${manifest.fileCount}`)
    console.log(`  Ukuran : ${formatBytes(manifest.totalBytes)}`)
    console.log(`  Dibuat : ${manifest.createdAt}`)
    console.log(`  Run ID : ${manifest.runId}`)
    console.log(`  Sumber : ${manifest.sourceId}`)
    console.log("")
    console.log(`  OK: ${verified}/${manifest.fileCount} berkas terekstrak dan checksum cocok.`)
    if (!ephemeral) console.log(`  Hasil restore uji: ${target}`)

    return { manifest, entries }
  } finally {
    if (ephemeral) await rm(target, { recursive: true, force: true })
  }
}

async function restoreTest(archivePath: string): Promise<void> {
  // Restore uji SELALU ke direktori sementara. Tidak ada argumen yang dapat
  // mengarahkannya ke akar media aktif — restore ke atas media hidup adalah
  // operasi pemulihan bencana, bukan bagian dari pengujian.
  const target = await mkdtemp(path.join(tmpdir(), "sismepda-restore-"))
  try {
    const { manifest } = await verifyBackup(archivePath, target)
    console.log("")
    console.log(`Restore uji selesai: ${manifest.fileCount} berkas, ${formatBytes(manifest.totalBytes)}.`)
    console.log("Akar media aktif tidak disentuh.")
  } finally {
    await rm(target, { recursive: true, force: true })
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  try {
    if (command === "create") {
      await createBackup()
    } else if (command === "verify") {
      const archive = rest.find((argument) => !argument.startsWith("--"))
      if (!archive) fail("pemakaian: media:backup:verify -- <arsip>")
      await verifyBackup(archive)
    } else if (command === "restore-test") {
      const archive = rest.find((argument) => !argument.startsWith("--"))
      if (!archive) fail("pemakaian: media:backup:restore-test -- <arsip>")
      await restoreTest(archive)
    } else {
      fail(`perintah tidak dikenal: ${command ?? "(kosong)"}`)
    }
  } catch (error) {
    if (error instanceof MediaBackupError) fail(error.message)
    throw error
  }
}

main()
