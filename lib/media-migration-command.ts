/**
 * Perintah migrasi media legacy PRODUKSI — keputusan murni.
 *
 * Modul ini tidak menyentuh jaringan, filesystem, maupun `process.env`; ia
 * hanya memutuskan APA yang boleh dijalankan dan MENYUSUN skrip remote-nya.
 * Eksekusinya ada di `scripts/migrate-media-production.ts`.
 *
 * MENGAPA ADA
 *
 * `scripts/migrate-media.ts` memakai `DATABASE_URL` apa adanya, dan database
 * produksi berada di jaringan Docker `internal=true` tanpa port yang terbuka —
 * jadi ia tidak bisa, dan tidak boleh, dijalankan dari mesin pengembangan.
 * Satu-satunya tempat yang sah adalah container `migrate` di host produksi,
 * yang sudah memiliki `DATABASE_URL`, `tsx`, dan (sejak perubahan ini) mount
 * volume media kanonik.
 *
 * Alih-alih meminta operator mengetik rangkaian `docker compose run --rm
 * --entrypoint sh migrate -c 'npx tsx ...'` dari ingatan — sekali salah ketik
 * `--dry-run` berarti migrasi produksi sungguhan — jalurnya dibekukan di sini
 * dan diuji.
 */

/** Mode eksekusi. Tidak ada default: operator harus menyebutkannya. */
export type MediaMigrationMode = "dry-run" | "apply" | "verify"

export type ModeDecision =
  | { ok: true; mode: MediaMigrationMode }
  | { ok: false; reason: string }

/**
 * Terjemahkan argumen CLI menjadi mode.
 *
 * FAIL CLOSED: tanpa flag sama sekali hasilnya penolakan, bukan `apply`.
 * Perintah yang default-nya menulis akan memigrasikan produksi pada percobaan
 * pertama operator yang hanya ingin melihat pemakaiannya.
 */
export function decideMode(args: readonly string[]): ModeDecision {
  const dryRun = args.includes("--dry-run")
  const apply = args.includes("--apply")
  const verify = args.includes("--verify")

  const selected = [dryRun && "dry-run", apply && "apply", verify && "verify"].filter(
    (value): value is MediaMigrationMode => typeof value === "string",
  )

  if (selected.length === 0) {
    return {
      ok: false,
      reason:
        "Mode wajib disebutkan: --dry-run (inspeksi), --verify (periksa hasil), atau --apply (migrasi sungguhan).",
    }
  }
  if (selected.length > 1) {
    // Menebak yang paling aman tetap berarti menjalankan sesuatu yang tidak
    // diminta; operator harus menyatakan maksudnya satu kali dengan jelas.
    return { ok: false, reason: `Mode saling bertentangan: ${selected.join(", ")}.` }
  }
  return { ok: true, mode: selected[0] }
}

/** True bila mode boleh menulis berkas/baris. */
export function writesData(mode: MediaMigrationMode): boolean {
  return mode === "apply"
}

/** Skrip mana yang dijalankan di dalam container migrator. */
export function scriptFor(mode: MediaMigrationMode): string {
  return mode === "verify" ? "scripts/verify-media-migration.ts" : "scripts/migrate-media.ts"
}

/** Argumen tambahan untuk skrip itu. */
export function scriptArgsFor(mode: MediaMigrationMode): readonly string[] {
  return mode === "dry-run" ? ["--dry-run"] : []
}

export type BannerFacts = {
  mode: MediaMigrationMode
  database: string
  mediaRoot: string
  service: string
}

/**
 * Spanduk yang dicetak SEBELUM eksekusi.
 *
 * Tidak memuat rahasia: hanya label database, bukan `DATABASE_URL`.
 */
export function banner(facts: BannerFacts): string {
  const writes = writesData(facts.mode)
  const modeLabel =
    facts.mode === "dry-run" ? "DRY RUN" : facts.mode === "verify" ? "VERIFY" : "APPLY"
  return [
    "SISMEPDA Legacy Media Migration",
    "",
    `  Environment .... PRODUCTION`,
    `  Mode ........... ${modeLabel}`,
    `  Database ....... ${facts.database}`,
    `  Media root ..... ${facts.mediaRoot}`,
    `  Container ...... ${facts.service}`,
    `  Write .......... ${writes ? "ENABLED" : "DISABLED"}`,
    `  Delete ......... DISABLED`,
  ].join("\n")
}

export type RemoteScriptOptions = {
  appDir: string
  composeFile: string
  mediaComposeFile: string
  envFile: string
  service: string
  profile: string
  mediaRoot: string
  mode: MediaMigrationMode
}

/**
 * Skrip yang dijalankan di host produksi lewat ssh.
 *
 * Guard-nya fail-closed dan berurutan dari yang paling murah: overlay media
 * harus ada (tanpanya migrator berjalan tanpa volume dan menulis ke writable
 * layer), lalu skrip harus benar-benar ada di dalam image, lalu akar media
 * harus merupakan mount — bukan direktori biasa milik image.
 */
export function remoteMediaMigrationScript(options: RemoteScriptOptions): string {
  const compose = `docker compose -f ${options.composeFile} -f ${options.mediaComposeFile} --env-file ${options.envFile}`
  const script = scriptFor(options.mode)
  const scriptArgs = scriptArgsFor(options.mode).join(" ")
  // Profil `migration` wajib: tanpa itu compose menolak menjalankan service
  // yang tidak aktif secara default.
  const run = `${compose} --profile ${options.profile} run --rm -T --entrypoint sh ${options.service}`

  return [
    "set -euo pipefail",
    `cd ${options.appDir}`,
    `test -f ${options.mediaComposeFile} || { echo "ABORT: ${options.mediaComposeFile} tidak ada; migrator akan berjalan tanpa volume media" >&2; exit 2; }`,
    // Guard dijalankan di dalam container sekali-jalan yang sama persis dengan
    // yang akan mengeksekusi migrasi. Memeriksanya dari host tidak membuktikan
    // apa pun tentang isi container.
    `${run} -c 'test -f ${script} || { echo "ABORT: ${script} tidak ada di image migrator" >&2; exit 3; }' </dev/null`,
    `${run} -c 'command -v npx >/dev/null || { echo "ABORT: npx tidak tersedia di image migrator" >&2; exit 3; }' </dev/null`,
    // `mountpoint`-style check tanpa util tambahan: bandingkan device akar
    // media dengan device direktori induknya. Berbeda berarti benar-benar mount.
    `${run} -c 'test -d ${options.mediaRoot} || { echo "ABORT: ${options.mediaRoot} tidak ada di migrator" >&2; exit 4; }; A=$(stat -c %d ${options.mediaRoot}); B=$(stat -c %d ${options.mediaRoot}/..); test "$A" != "$B" || { echo "ABORT: ${options.mediaRoot} bukan mount; menulis ke writable layer container" >&2; exit 4; }' </dev/null`,
    `${run} -c 'npx tsx ${script} ${scriptArgs}' </dev/null`,
  ].join("\n")
}
