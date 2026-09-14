/**
 * Kontrak sinkronisasi media prodclone — bagian MURNI.
 *
 * Berkas ini tidak menjalankan apa pun. Ia hanya memutuskan perintah apa yang
 * boleh dikirim, dan menolak yang tidak boleh. Pola ini mengikuti
 * `lib/deployment.ts`: seluruh keputusan berbahaya dapat diuji tanpa SSH, tanpa
 * jaringan, dan tanpa menyentuh produksi.
 *
 * Arah transfer bersifat SATU ARAH dan tidak dapat dikonfigurasi:
 *
 *     produksi (read-only)  →  prodclone lokal
 *
 * Tidak ada parameter yang memungkinkan operator membalik sumber dan tujuan.
 * Sumber selalu dibangun dari topologi produksi di `lib/deployment.ts`, tujuan
 * selalu dibangun dari akar media peran prodclone. Keduanya tidak diterima dari
 * argumen baris perintah — itu keputusan desain, bukan kelalaian.
 */

import { production, shellQuote } from "@/lib/deployment"
import type { DatabaseRole } from "@/lib/database-target"
import { mediaRootForRole } from "@/lib/media-roots"

/**
 * Akar media produksi DI DALAM host, bukan di dalam container.
 *
 * Volume `media` milik compose produksi diekspos ke host melalui direktori ini.
 * Nilainya tunggal dan eksplisit supaya tidak ada jalur di mana operator dapat
 * mengetikkan path produksi sendiri.
 */
export const productionMediaDir = `${production.appDir}/media`

export class MediaSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaSyncError"
  }
}

export type MediaSyncPlan = {
  remoteAlias: string
  remotePath: string
  localPath: string
  dryRun: boolean
  /** Selalu false. Dipertahankan sebagai nilai eksplisit agar terlihat di log. */
  deleteEnabled: false
}

/**
 * Jalur lokal yang menolak ditulisi.
 *
 * Sinkronisasi menulis ke direktori tujuan, jadi tujuan yang ambigu adalah
 * risiko nyata: akar filesystem, direktori home, atau akar project akan
 * menerima ratusan berkas di tempat yang salah. Gagal-tertutup lebih baik
 * daripada menebak.
 */
function assertSafeLocalDestination(absolute: string, cwd: string): void {
  const normalized = absolute.replace(/\\/g, "/").replace(/\/+$/, "")
  const projectRoot = cwd.replace(/\\/g, "/").replace(/\/+$/, "")

  if (normalized.length === 0 || normalized === "/") {
    throw new MediaSyncError("Tujuan sinkronisasi tidak boleh akar filesystem")
  }
  if (/^[A-Za-z]:$/.test(normalized)) {
    throw new MediaSyncError("Tujuan sinkronisasi tidak boleh akar drive")
  }
  if (normalized === projectRoot) {
    throw new MediaSyncError("Tujuan sinkronisasi tidak boleh akar project")
  }
  if (!normalized.startsWith(`${projectRoot}/`)) {
    // Membatasi tujuan ke dalam project membuat kesalahan konfigurasi tidak
    // dapat menyentuh berkas pribadi operator di luar repositori.
    throw new MediaSyncError("Tujuan sinkronisasi harus berada di dalam project")
  }
  if (!/\/\.media\//.test(`${normalized}/`)) {
    throw new MediaSyncError("Tujuan sinkronisasi harus berada di bawah .media/")
  }
}

/**
 * Susun rencana sinkronisasi.
 *
 * Peran dikunci ke `prodclone`: menyinkronkan media produksi ke atas media
 * pengembangan lokal akan menimpa data uji dengan data nyata, dan tidak ada
 * alasan sah untuk melakukannya.
 */
export function planMediaSync(options: {
  role: DatabaseRole
  dryRun: boolean
  cwd: string
  resolve: (relative: string) => string
}): MediaSyncPlan {
  if (options.role !== "prodclone") {
    throw new MediaSyncError(
      `Sinkronisasi media hanya untuk peran "prodclone", bukan "${options.role}"`,
    )
  }

  const localPath = options.resolve(mediaRootForRole("prodclone"))
  assertSafeLocalDestination(localPath, options.cwd)

  return {
    remoteAlias: production.sshAlias,
    remotePath: productionMediaDir,
    localPath,
    dryRun: options.dryRun,
    deleteEnabled: false,
  }
}

/**
 * Ubah jalur Windows menjadi bentuk yang tidak dibaca rsync sebagai host remote.
 *
 * rsync mengurai `D:/sismepda/...` sebagai "host D, path /sismepda/...", lalu
 * mencoba koneksi jaringan. Bentuk MSYS `/d/sismepda/...` tidak ambigu.
 * Pada Linux jalur tidak memuat huruf drive, sehingga fungsi ini tidak aktif.
 */
export function toRsyncPath(absolute: string): string {
  const normalized = absolute.replace(/\\/g, "/")
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized)
  return drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : normalized
}

/**
 * Argumen rsync untuk rencana tertentu.
 *
 * Yang TIDAK ada di sini sama pentingnya dengan yang ada:
 * - tanpa `--delete` (dan variannya): media lokal yang basi dibiarkan, karena
 *   menghapus berkas lokal secara otomatis jauh lebih berbahaya daripada
 *   menyimpan berkas yang tidak terpakai;
 * - tanpa `--remove-source-files`: produksi tidak pernah kehilangan apa pun;
 * - tanpa `--rsync-path`/`sudo`: tidak ada eskalasi hak di sisi remote;
 * - tanpa `--chmod`/`--chown` remote: produksi tidak dimutasi sama sekali.
 *
 * `--ignore-existing` sengaja TIDAK dipakai: berkas yang berubah di produksi
 * harus tetap tersalin. Perbandingan default rsync (ukuran + mtime) sudah
 * membuat pengulangan bersifat incremental.
 */
export function rsyncArgsFor(plan: MediaSyncPlan): string[] {
  const args = [
    "-az",
    "--partial",
    // Trailing slash pada sumber = "isi direktori", bukan "direktorinya".
    // Tanpa itu media produksi akan mendarat di `.media/prodclone/media/`.
    `${plan.remoteAlias}:${plan.remotePath}/`,
    `${toRsyncPath(plan.localPath)}/`,
  ]
  if (plan.dryRun) args.unshift("--dry-run", "--stats")
  return args
}

/**
 * Perintah inspeksi remote untuk lingkungan tanpa rsync.
 *
 * Murni baca: `find` + `wc`. Tidak ada penulisan, tidak ada mkdir, tidak ada
 * perubahan hak akses.
 */
export function remoteMediaInventoryCommand(): string {
  const dir = shellQuote(productionMediaDir)
  return [
    `test -d ${dir} || { echo "ABORT: direktori media produksi tidak ada"; exit 3; }`,
    `echo "FILES=$(find ${dir} -type f | wc -l)"`,
    `echo "BYTES=$(find ${dir} -type f -printf '%s\\n' | awk '{s+=$1} END {print s+0}')"`,
  ].join("\n")
}

/** Ringkasan yang dicetak sebelum operasi, agar target tidak pernah tersirat. */
export function describeMediaSync(plan: MediaSyncPlan): string {
  return [
    "SISMEPDA Media Prodclone Sync",
    "",
    `  Remote : ${plan.remoteAlias}`,
    `  Source : ${plan.remotePath} (read-only)`,
    `  Local  : ${plan.localPath}`,
    `  Mode   : ${plan.dryRun ? "dry-run (tanpa penulisan)" : "incremental / non-destruktif"}`,
    "  Delete : disabled",
    "  Arah   : produksi → lokal (tidak dapat dibalik)",
    "",
  ].join("\n")
}
