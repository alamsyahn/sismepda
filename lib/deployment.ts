/**
 * Kontrak deployment produksi SISMEPDA — bagian murni.
 *
 * Berkas ini tidak menjalankan apa pun. Isinya konstanta topologi produksi,
 * pembangun perintah remote, parser keluaran, penyaring rahasia, dan guard
 * perintah terlarang. Orkestrasinya ada di `lib/deployment-flow.ts`, eksekusi
 * prosesnya di `scripts/deploy.ts`.
 *
 * Pemisahan ini disengaja: seluruh keputusan berbahaya (perintah apa yang
 * dikirim ke VPS) dapat diuji tanpa SSH, tanpa Docker, dan tanpa menyentuh
 * produksi sama sekali.
 *
 * Nilai topologi berasal dari `docs/operations/deployment.md` — deployment
 * nyata memakai `deploy.yaml` yang TIDAK ada di Git, bukan `compose.yaml`.
 */

// ---------------------------------------------------------------------------
// Topologi produksi
// ---------------------------------------------------------------------------

export const production = {
  sshAlias: "smpn2",
  appDir: "/srv/apps/sismepda",
  /** Compose file milik host, di luar Git. Jangan diganti compose.yaml repo. */
  composeFile: "deploy.yaml",
  /**
   * Overlay media, ADA di Git dan sampai ke produksi lewat `git merge --ff-only`.
   * Menyediakan MEDIA_STORAGE_ROOT dan volume media bernama tetap tanpa perlu
   * menyunting `deploy.yaml` milik host dengan tangan.
   */
  mediaComposeFile: "compose.media.yaml",
  /** Nama volume media yang eksplisit; harus sama dengan compose.media.yaml. */
  mediaVolume: "sismepda_media_data",
  /** Titik mount media di dalam container; harus sama dengan MEDIA_STORAGE_ROOT. */
  mediaRoot: "/app/media",
  envFile: "/etc/sismepda/sismepda.env",
  appService: "app",
  databaseService: "db",
  branch: "main",
  /** Dipakai hanya untuk memastikan origin memang repositori yang benar. */
  repositorySlug: "alamsyahn/sismepda",
  backupDir: "/srv/backups/sismepda/predeploy",
  backupRetention: 20,
  lockDir: "/srv/apps/sismepda/.deploy.lock",
  /** Lock yang lebih tua dari ini dilaporkan sebagai stale — tidak dihapus otomatis. */
  staleLockMinutes: 90,
  /** Port internal container app; healthcheck canonical memakai /login. */
  healthPath: "/login",
  healthAttempts: 24,
  healthIntervalSeconds: 5,
} as const

/**
 * Seluruh file compose produksi, berurutan. `deploy.yaml` milik host lebih dulu,
 * overlay media menimpanya.
 *
 * Diekspor agar test dapat menegaskan bahwa tidak ada jalur deploy yang
 * menjalankan compose tanpa overlay — jalur seperti itu akan membuat ulang
 * container app tanpa volume media.
 */
export const productionComposeFiles: readonly string[] = [
  production.composeFile,
  production.mediaComposeFile,
]

// ---------------------------------------------------------------------------
// Validasi masukan
// ---------------------------------------------------------------------------

/** Commit SHA penuh. Hanya bentuk ini yang boleh masuk perintah remote. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value)
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * Quoting POSIX. Dipakai untuk setiap nilai dinamis yang masuk skrip remote,
 * meskipun nilainya sudah divalidasi — dua lapis, bukan satu.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// ---------------------------------------------------------------------------
// Guard perintah terlarang
// ---------------------------------------------------------------------------

/**
 * Pola yang tidak boleh pernah dikirim ke produksi oleh tooling ini.
 *
 * Ini bukan sekadar dokumentasi: `assertRemoteCommandSafe` dipanggil untuk
 * SETIAP skrip remote sebelum dieksekusi, jadi sebuah regresi pada pembangun
 * perintah gagal di guard, bukan di database produksi.
 */
export const forbiddenRemotePatterns: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /prisma\s+migrate\s+reset/, reason: "migrate reset menghapus seluruh database" },
  { pattern: /prisma\s+migrate\s+dev/, reason: "migrate dev membuat migrasi baru di produksi" },
  { pattern: /prisma\s+db\s+push/, reason: "db push mengubah skema tanpa migrasi tercatat" },
  { pattern: /prisma\s+db\s+seed/, reason: "seed bukan bagian deployment normal" },
  { pattern: /docker\s+compose[^\n]*\bdown\b/, reason: "down mematikan database, bukan hanya app" },
  { pattern: /docker\s+volume\s+rm/, reason: "penghapusan volume menghancurkan data" },
  { pattern: /docker\s+system\s+prune/, reason: "prune dapat menghapus volume/image yang dipakai" },
  { pattern: /git\s+reset\s+--hard/, reason: "reset --hard membuang perubahan produksi" },
  { pattern: /git\s+clean\s+-[a-z]*f/, reason: "clean -f membuang berkas host-specific" },
  { pattern: /git\s+push\s+[^\n]*--force/, reason: "force push dilarang" },
  { pattern: /DROP\s+DATABASE/i, reason: "drop database dilarang" },
  { pattern: /TRUNCATE/i, reason: "truncate dilarang pada jalur deployment" },
  { pattern: /rbac-backfill-legacy/, reason: "backfill legacy adalah langkah operator terpisah" },
]

export class ForbiddenRemoteCommandError extends Error {}

export function assertRemoteCommandSafe(script: string): void {
  for (const { pattern, reason } of forbiddenRemotePatterns) {
    if (pattern.test(script)) {
      throw new ForbiddenRemoteCommandError(
        `Perintah remote ditolak guard keamanan (${reason}): ${pattern}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Penyaring rahasia
// ---------------------------------------------------------------------------

/**
 * Keluaran remote (log container, `compose config`, pesan error Prisma) bisa
 * memuat DATABASE_URL atau AUTH_SECRET. Semua yang dicetak tooling ini melewati
 * fungsi ini lebih dulu.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']*/gi, "$1***REDACTED***")
    .replace(
      /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|DATABASE_URL)[A-Z0-9_]*)\s*=\s*\S+/gi,
      "$1=***REDACTED***",
    )
}

// ---------------------------------------------------------------------------
// Nama berkas backup
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DD_HH-mm-ss_<short-sha>.dump` dalam UTC.
 *
 * UTC dipilih supaya urutan leksikografis berkas sama dengan urutan waktu
 * sebenarnya, termasuk saat zona waktu host berubah. Ini metadata operasional,
 * bukan tanggal bisnis, jadi tidak memakai zona sekolah.
 */
export function backupFileName(now: Date, sha: string): string {
  if (!isCommitSha(sha)) throw new Error(`SHA tidak sah untuk nama backup: ${sha}`)
  const iso = now.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 19).replaceAll(":", "-")
  return `${date}_${time}_${shortSha(sha)}.dump`
}

/** Pola nama berkas predeploy; retention hanya boleh menyentuh yang cocok ini. */
export const backupGlob = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_*_*.dump"

// ---------------------------------------------------------------------------
// Pembangun skrip remote
// ---------------------------------------------------------------------------

/**
 * Perintah compose produksi.
 *
 * Daftar file dihitung di shell, bukan ditanam sebagai literal, karena overlay
 * media baru tiba di produksi lewat `git merge --ff-only` DI TENGAH alur deploy.
 * Tahap sebelum merge (preflight, backup) masih berjalan di pohon kerja lama
 * yang belum memuat overlay; memaksakan `-f compose.media.yaml` di sana membuat
 * deploy pertama yang membawa overlay mustahil dijalankan.
 *
 * Kelonggaran ini TIDAK berlaku untuk tahap yang membuat ulang container:
 * `requireMediaOverlay` di bawah menuntut overlay ada sebelum build/migrate/
 * activate, sehingga container app tidak pernah dibuat ulang tanpa volume media.
 */
const compose = `docker compose $COMPOSE_FILES --env-file ${production.envFile}`

/**
 * Menolak melanjutkan bila overlay media tidak ada.
 *
 * Dipasang pada setiap tahap yang membuat atau membuat ulang container app.
 */
const requireMediaOverlay = `test -f ${production.mediaComposeFile} || { echo "ABORT: ${production.mediaComposeFile} tidak ada; container app tidak boleh dibuat ulang tanpa volume media" >&2; exit 2; }`

/** Prolog setiap skrip: gagal cepat, tidak menelan error pipa. */
function script(...lines: string[]): string {
  return [
    "set -euo pipefail",
    `cd ${production.appDir}`,
    `COMPOSE_FILES="-f ${production.composeFile}"`,
    // `|| true`: di bawah `set -e`, test yang gagal akan menghentikan skrip.
    // Ketiadaan overlay di sini bukan kesalahan — hanya berarti belum di-merge.
    `if test -f ${production.mediaComposeFile}; then COMPOSE_FILES="$COMPOSE_FILES -f ${production.mediaComposeFile}"; fi`,
    ...lines,
  ].join("\n")
}

export function remotePreflightScript(): string {
  return script(
    `test -d .git || { echo "ABORT: ${production.appDir} bukan repositori Git" >&2; exit 2; }`,
    `test -f ${production.composeFile} || { echo "ABORT: ${production.composeFile} tidak ada" >&2; exit 2; }`,
    // Overlay media TIDAK diwajibkan di sini: preflight berjalan sebelum
    // `git merge --ff-only`, jadi pada deploy yang justru membawa overlay, file
    // ini memang belum ada. Kewajibannya ditegakkan setelah merge, pada tahap
    // yang membuat ulang container. Statusnya tetap dilaporkan.
    `echo "MEDIA_OVERLAY=$(test -f ${production.mediaComposeFile} && echo present || echo absent)"`,
    `test -f ${production.envFile} || { echo "ABORT: env file tidak ada" >&2; exit 2; }`,
    `command -v docker >/dev/null || { echo "ABORT: docker tidak tersedia" >&2; exit 2; }`,
    // `compose config` divalidasi tanpa mencetak isinya: keluarannya memuat env.
    `${compose} config >/dev/null || { echo "ABORT: konfigurasi compose tidak valid" >&2; exit 2; }`,
    `DB_ID=$(${compose} ps -q ${production.databaseService} </dev/null)`,
    `test -n "$DB_ID" || { echo "ABORT: container database tidak berjalan" >&2; exit 2; }`,
    `echo "HEAD=$(git rev-parse HEAD)"`,
    `echo "BRANCH=$(git rev-parse --abbrev-ref HEAD)"`,
    `echo "DIRTY=$(git status --porcelain | wc -l)"`,
    `echo "DB_CONTAINER=$(docker inspect --format '{{.Name}}' "$DB_ID" | sed 's|^/||')"`,
    `echo "APP_STATE=$(${compose} ps --format '{{.Service}} {{.State}}' </dev/null | tr '\\n' ',')"`,
  )
}

/**
 * Lock atomik: `mkdir` gagal bila direktori sudah ada, tanpa race.
 * Lock basi TIDAK dihapus otomatis — hanya dilaporkan, karena menghapusnya
 * secara sepihak berarti dua deployment bisa berjalan bersamaan.
 */
export function remoteAcquireLockScript(sha: string): string {
  assertSha(sha)
  return script(
    `if ! mkdir ${production.lockDir} 2>/dev/null; then`,
    `  AGE=$(( ( $(date +%s) - $(stat -c %Y ${production.lockDir}) ) / 60 ))`,
    `  echo "ABORT: deployment lain sedang berjalan (lock berumur ${"$"}{AGE} menit)." >&2`,
    `  if [ "$AGE" -gt ${production.staleLockMinutes} ]; then`,
    `    echo "Lock tampak basi. Periksa lalu hapus manual: rmdir ${production.lockDir}" >&2`,
    `  fi`,
    `  exit 3`,
    `fi`,
    `printf '%s\\n' ${shellQuote(sha)} > ${production.lockDir}/commit`,
    `echo LOCK_ACQUIRED`,
  )
}

export function remoteReleaseLockScript(): string {
  return script(`rm -f ${production.lockDir}/commit`, `rmdir ${production.lockDir} 2>/dev/null || true`)
}

/**
 * Backup predeploy.
 *
 * `pg_dump` dijalankan DI DALAM container database lewat autentikasi lokal
 * container, jadi tidak ada password di argumen, di environment ssh, atau di
 * log. Nama database/user dibaca dari environment container itu sendiri.
 */
export function remoteBackupScript(fileName: string): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9a-f]{7}\.dump$/.test(fileName)) {
    throw new Error(`Nama berkas backup tidak sah: ${fileName}`)
  }
  const target = `${production.backupDir}/${fileName}`
  return script(
    `DB_ID=$(${compose} ps -q ${production.databaseService} </dev/null)`,
    `test -n "$DB_ID" || { echo "ABORT: container database tidak berjalan" >&2; exit 2; }`,
    `PGDB=$(docker exec "$DB_ID" printenv POSTGRES_DB)`,
    `PGUSER_NAME=$(docker exec "$DB_ID" printenv POSTGRES_USER)`,
    `mkdir -p ${production.backupDir}`,
    `docker exec "$DB_ID" pg_dump -U "$PGUSER_NAME" -d "$PGDB" --format=custom --no-owner --no-privileges > ${shellQuote(target)} </dev/null`,
    `test -s ${shellQuote(target)} || { echo "ABORT: berkas backup kosong" >&2; exit 4; }`,
    `SIZE=$(stat -c %s ${shellQuote(target)})`,
    `test "$SIZE" -gt 1024 || { echo "ABORT: backup hanya $SIZE byte" >&2; exit 4; }`,
    // Verifikasi isi arsip, bukan sekadar keberadaan berkas. Nama arsip
    // sengaja dihilangkan: pg_restore membaca stdin hanya ketika argumen itu
    // tidak ada, sedangkan `-` diperlakukan sebagai nama berkas literal.
    `docker exec -i "$DB_ID" pg_restore --list < ${shellQuote(target)} > /dev/null || { echo "ABORT: arsip backup tidak dapat dibaca pg_restore" >&2; exit 4; }`,
    `echo "BACKUP=${target}"`,
    `echo "SIZE=$SIZE"`,
    // Retention: hanya direktori predeploy, hanya berkas berpola predeploy.
    `ls -1t ${production.backupDir}/${backupGlob} 2>/dev/null | tail -n +$(( ${production.backupRetention} + 1 )) | while IFS= read -r old; do rm -f "$old"; echo "PRUNED=$old"; done`,
  )
}

/** Fast-forward ke commit yang persis sama dengan lokal; tidak ada reset. */
export function remoteUpdateSourceScript(sha: string): string {
  assertSha(sha)
  const quoted = shellQuote(sha)
  return script(
    `git fetch --quiet origin ${production.branch}`,
    `git merge --ff-only ${quoted}`,
    `NEW=$(git rev-parse HEAD)`,
    `test "$NEW" = ${quoted} || { echo "ABORT: HEAD produksi $NEW bukan commit yang diharapkan" >&2; exit 5; }`,
    `echo "HEAD=$NEW"`,
  )
}

export function remoteBuildScript(): string {
  return script(
    requireMediaOverlay,
    `${compose} --profile migration build migrate ${production.appService} </dev/null`,
  )
}

export function remoteMigrateStatusScript(): string {
  return script(
    `${compose} --profile migration run --rm -T --entrypoint sh migrate -c 'npx prisma migrate status' </dev/null`,
  )
}

/**
 * Hanya `migrate deploy`. Entrypoint di-override supaya CMD image (apa pun
 * isinya di host) tidak ikut berjalan.
 */
export function remoteMigrateDeployScript(): string {
  return script(
    requireMediaOverlay,
    `${compose} --profile migration run --rm -T --entrypoint sh migrate -c 'npx prisma migrate deploy' </dev/null`,
  )
}

/**
 * Aktivasi image baru tanpa menyentuh container database.
 *
 * `up -d` MEMBUAT ULANG container app. Tanpa overlay media, container pengganti
 * berjalan tanpa volume dan setiap unggahan sejak deploy terakhir hilang — maka
 * tahap ini menolak berjalan bila overlay tidak ada.
 */
export function remoteActivateScript(): string {
  return script(requireMediaOverlay, `${compose} up -d ${production.appService} </dev/null`)
}

export function remoteHealthScript(): string {
  const { healthAttempts, healthIntervalSeconds, healthPath, appService } = production
  return script(
    `APP_ID=$(${compose} ps -q ${appService} </dev/null)`,
    `test -n "$APP_ID" || { echo "ABORT: container app tidak ada" >&2; exit 6; }`,
    `for i in $(seq 1 ${healthAttempts}); do`,
    `  STATE=$(docker inspect --format '{{.State.Status}}' "$APP_ID")`,
    `  HEALTH=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_ID")`,
    `  if [ "$STATE" = "running" ] && { [ "$HEALTH" = "healthy" ] || [ "$HEALTH" = "none" ]; }; then`,
    `    if docker exec "$APP_ID" node -e "fetch('http://127.0.0.1:3000${healthPath}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null; then`,
    `      echo "STATE=$STATE"; echo "HEALTH=$HEALTH"; echo "HTTP=ok"; exit 0`,
    `    fi`,
    `  fi`,
    `  sleep ${healthIntervalSeconds}`,
    `done`,
    `echo "STATE=${"$"}{STATE:-unknown}" >&2`,
    `echo "HEALTH=${"$"}{HEALTH:-unknown}" >&2`,
    `echo "ABORT: aplikasi tidak sehat dalam ${healthAttempts * healthIntervalSeconds} detik" >&2`,
    `exit 6`,
  )
}

export function remoteAppLogsScript(lines = 60): string {
  const safe = Number.isInteger(lines) && lines > 0 && lines <= 500 ? lines : 60
  return script(`${compose} logs --tail=${safe} ${production.appService} </dev/null 2>&1 || true`)
}

/** Ringkasan read-only untuk `deploy:status` dan bagian remote `deploy:check`. */
export function remoteStatusScript(): string {
  return script(
    `echo "HEAD=$(git rev-parse HEAD)"`,
    `echo "BRANCH=$(git rev-parse --abbrev-ref HEAD)"`,
    `echo "DIRTY=$(git status --porcelain | wc -l)"`,
    `echo "COMPOSE_FILE=$(test -f ${production.composeFile} && echo yes || echo no)"`,
    `echo "ENV_FILE=$(test -f ${production.envFile} && echo yes || echo no)"`,
    `echo "DOCKER=$(command -v docker >/dev/null && echo yes || echo no)"`,
    `${compose} ps --format '{{.Service}} {{.State}} {{.Status}}' </dev/null | sed 's/^/PS=/' || true`,
    `LAST=$(ls -1t ${production.backupDir}/${backupGlob} 2>/dev/null | head -1 || true)`,
    `if [ -n "$LAST" ]; then echo "BACKUP=$LAST"; echo "BACKUP_SIZE=$(stat -c %s "$LAST")"; else echo "BACKUP=none"; fi`,
    `echo "LOCK=$(test -d ${production.lockDir} && echo held || echo free)"`,
  )
}

/**
 * Pengumpulan fakta rollout media — READ-ONLY sepenuhnya.
 *
 * Tidak ada `mkdir`, `touch`, `cp`, atau `docker exec` yang menulis. Kemampuan
 * tulis direktori backup diperiksa dengan `test -w`, bukan dengan membuat
 * berkas uji, karena preflight tidak boleh meninggalkan jejak di produksi.
 *
 * `compose config` dipipa ke grep sehingga hanya satu baris MEDIA_STORAGE_ROOT
 * yang keluar; sisa konfigurasi (yang memuat env) tidak pernah dicetak.
 */
export function remoteRolloutFactsScript(): string {
  return script(
    `APP_ID=$(${compose} ps -q ${production.appService} </dev/null)`,
    `test -n "$APP_ID" || { echo "ABORT: container app tidak berjalan" >&2; exit 2; }`,
    `DB_ID=$(${compose} ps -q ${production.databaseService} </dev/null)`,
    `test -n "$DB_ID" || { echo "ABORT: container database tidak berjalan" >&2; exit 2; }`,
    // Akar media menurut konfigurasi compose yang sedang berlaku.
    `ROOT=$(${compose} config </dev/null | grep -E '^[[:space:]]*MEDIA_STORAGE_ROOT:' | head -1 | sed 's/.*MEDIA_STORAGE_ROOT:[[:space:]]*//' | tr -d '"' || true)`,
    `echo "MEDIA_ROOT=${"$"}{ROOT:-}"`,
    // Mount container app: tipe|nama|tujuan|sumber|rw, satu baris per mount.
    `docker inspect --format '{{range .Mounts}}MOUNT={{.Type}}|{{.Name}}|{{.Destination}}|{{.Source}}|{{.RW}}{{println}}{{end}}' "$APP_ID"`,
    // Mount menurut KONFIGURASI, bukan menurut container yang sedang hidup.
    // Ini yang menentukan keadaan setelah deploy berikutnya: container lama
    // boleh saja belum punya volume media, yang penting compose sudah memilikinya.
    //
    // `compose config` menormalkan mount ke bentuk panjang (source/target
    // terpisah), sehingga pola pendek "nama:/jalur" tidak pernah cocok di sini.
    // awk memasangkan kembali source dengan target, dan hanya target akar media
    // yang dilaporkan.
    `${compose} config </dev/null | awk -v root="$ROOT" '/source:/{s=$2} /target:/{if ($2 == root) print "CONFIG_MEDIA_MOUNT=" s ":" $2}' || true`,
    // Nama logis volume yang dideklarasikan konfigurasi.
    `${compose} config --volumes </dev/null | sed 's/^/CONFIG_VOLUME=/' || true`,
    // Nama volume Docker yang SEBENARNYA dipakai. Bila `name:` tidak ditulis
    // eksplisit, Docker menurunkannya dari nama project, dan identitas volume
    // ikut berubah saat nama project/direktori berubah.
    `${compose} config </dev/null | awk '/^volumes:/{v=1;next} v&&/^[[:space:]]+name:/{print "CONFIG_VOLUME_NAME=" $2}' || true`,
    `echo "FREE_BYTES=$(df -P -B1 ${production.appDir} | awk 'NR==2 {print $4}')"`,
    `echo "DB_BYTES=$(docker exec "$DB_ID" du -sb /var/lib/postgresql/data 2>/dev/null | awk '{print $1}')"`,
    // `test -w` menilai izin tanpa menulis apa pun.
    `if [ -d ${production.backupDir} ]; then test -w ${production.backupDir} && echo "BACKUP_WRITABLE=yes" || echo "BACKUP_WRITABLE=no"; else test -w "$(dirname ${production.backupDir})" && echo "BACKUP_WRITABLE=yes" || echo "BACKUP_WRITABLE=no"; fi`,
    `echo "APPLIED_MIGRATIONS_BEGIN"`,
    `PGDB=$(docker exec "$DB_ID" printenv POSTGRES_DB)`,
    `PGU=$(docker exec "$DB_ID" printenv POSTGRES_USER)`,
    `docker exec -i "$DB_ID" psql -U "$PGU" -d "$PGDB" -At -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL' </dev/null`,
    `echo "APPLIED_MIGRATIONS_END"`,
  )
}

/**
 * Total byte kolom bytea legacy di produksi — READ-ONLY (`SELECT` saja).
 *
 * Dipakai preflight untuk mengestimasi duplikasi disk sementara selama masa
 * transisi, ketika media ada di database DAN di filesystem.
 */
export function remoteLegacyMediaBytesScript(): string {
  const query = [
    `SELECT coalesce(sum(octet_length("photoData")),0) FROM "User"`,
    `UNION ALL SELECT coalesce(sum(octet_length("appLogoData")),0) FROM "SchoolSetting"`,
    `UNION ALL SELECT coalesce(sum(octet_length("faviconData")),0) FROM "SchoolSetting"`,
    `UNION ALL SELECT coalesce(sum(octet_length(data)),0) FROM "SarprasPhoto"`,
    `UNION ALL SELECT coalesce(sum(octet_length("photoData")),0) FROM "EuksHeroImage"`,
    `UNION ALL SELECT coalesce(sum(octet_length("logoData")),0) FROM "EuksHeroLogo"`,
    `UNION ALL SELECT coalesce(sum(octet_length("photoData")),0) FROM "EuksOfficer"`,
    `UNION ALL SELECT coalesce(sum(octet_length("photoData")),0) FROM "EuksFacility"`,
  ].join(" ")

  return script(
    `DB_ID=$(${compose} ps -q ${production.databaseService} </dev/null)`,
    `test -n "$DB_ID" || { echo "ABORT: container database tidak berjalan" >&2; exit 2; }`,
    `PGDB=$(docker exec "$DB_ID" printenv POSTGRES_DB)`,
    `PGU=$(docker exec "$DB_ID" printenv POSTGRES_USER)`,
    `TOTAL=$(docker exec -i "$DB_ID" psql -U "$PGU" -d "$PGDB" -At -c ${shellQuote(
      `SELECT sum(t) FROM (${query}) AS s(t)`,
    )} </dev/null)`,
    `echo "LEGACY_MEDIA_BYTES=${"$"}{TOTAL:-0}"`,
  )
}

function assertSha(sha: string): void {
  if (!isCommitSha(sha)) {
    throw new Error(`Commit SHA tidak sah; perintah remote dibatalkan: ${sha}`)
  }
}

// ---------------------------------------------------------------------------
// Parser keluaran
// ---------------------------------------------------------------------------

/** Ambil `KEY=value` dari keluaran skrip remote. */
export function parseKeyValues(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match) result[match[1]] = match[2]
  }
  return result
}

export type MigrationOutcome = "up-to-date" | "applied" | "unknown"

/**
 * `prisma migrate deploy` menyatakan "No pending migrations" ketika tidak ada
 * yang perlu dijalankan — itu keadaan normal untuk rilis UI/backend saja.
 */
export function parseMigrateDeploy(output: string): MigrationOutcome {
  if (/no pending migrations?/i.test(output)) return "up-to-date"
  if (/applied \d+ migration|following migration(s)? (have|has) been applied/i.test(output)) {
    return "applied"
  }
  return "unknown"
}

export function parseMigrateStatus(output: string): MigrationOutcome {
  if (/database schema is up to date/i.test(output)) return "up-to-date"
  if (/following migrations? have not yet been applied|migrations? pending/i.test(output)) {
    return "applied"
  }
  return "unknown"
}

// ---------------------------------------------------------------------------
// Format keluaran
// ---------------------------------------------------------------------------

export function stepLine(index: number, total: number, label: string, status: string): string {
  const prefix = `[${index}/${total}] ${label} `
  return `${prefix.padEnd(38, ".")} ${status}`
}

export function banner(title: string): string {
  const rule = "=".repeat(56)
  return `${rule}\n${title}\n${rule}`
}

export function formatSummary(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join("\n")
}
