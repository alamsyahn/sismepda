/**
 * Skrip remote pembuat set backup produksi — bagian MURNI.
 *
 * Berkas ini hanya MENYUSUN perintah; ia tidak menjalankan apa pun dan tidak
 * membuka SSH. Karena itu kontraknya — urutan database-sebelum-media,
 * keberadaan kedua verifikasi, dan ketiadaan perintah destruktif — dapat diuji
 * tanpa menyentuh produksi. Eksekusinya ada di `scripts/backup-production.ts`.
 */

import { production, shellQuote } from "@/lib/deployment"
import { DATABASE_ARCHIVE, MEDIA_ARCHIVE } from "@/lib/backup-set"

/**
 * Jumlah baris yang sudah memiliki kunci media kanonik.
 *
 * Setiap tabel diperiksa lewat `information_schema` karena query ini juga
 * dijalankan terhadap produksi yang BELUM menerima migrasi kunci media; di sana
 * kolomnya memang belum ada. Kolom yang belum ada menghasilkan 0, bukan error —
 * dan itu benar: tanpa kolom, mustahil ada kunci.
 *
 * Query ini murni `SELECT`. Ia tidak pernah menulis apa pun.
 */
export const MEDIA_KEY_COUNT_QUERY = [
  `SELECT coalesce(sum(n), 0)::bigint FROM (`,
  [
    [`User`, `photoKey`],
    [`SchoolSetting`, `faviconKey`],
    [`SchoolSetting`, `appLogoKey`],
    [`SarprasPhoto`, `mediaKey`],
    [`EuksHeroImage`, `photoKey`],
    [`EuksHeroLogo`, `logoKey`],
    [`EuksOfficer`, `photoKey`],
    [`EuksFacility`, `photoKey`],
  ]
    .map(
      ([table, column]) =>
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ` +
        `WHERE table_name = '${table}' AND column_name = '${column}') ` +
        `THEN (SELECT count(*) FROM "${table}" WHERE "${column}" IS NOT NULL) ELSE 0 END AS n`,
    )
    .join(" UNION ALL "),
  `) AS keys`,
].join(" ")

/** Direktori induk set backup di produksi. */
export const BACKUP_SET_ROOT = "/srv/backups/sismepda/sets"

/**
 * Skrip remote pembuat set backup.
 *
 * Dipisahkan sebagai fungsi murni supaya isinya dapat diperiksa test tanpa SSH:
 * urutan langkah dan keberadaan verifikasi adalah bagian dari kontrak, bukan
 * detail implementasi.
 */
export function backupSetScript(setId: string): string {
  const dir = `${BACKUP_SET_ROOT}/${setId}`
  // Overlay media ikut disertakan bila ada, supaya identitas service/volume
  // yang dilihat backup sama persis dengan yang dipakai deploy. Bila belum
  // di-merge, backup tetap berjalan dengan deploy.yaml saja.
  const compose = `docker compose $COMPOSE_FILES --env-file ${production.envFile}`

  return [
    "set -euo pipefail",
    `cd ${production.appDir}`,
    `COMPOSE_FILES="-f ${production.composeFile}"`,
    `if test -f ${production.mediaComposeFile}; then COMPOSE_FILES="$COMPOSE_FILES -f ${production.mediaComposeFile}"; fi`,
    `DB_ID=$(${compose} ps -q ${production.databaseService} </dev/null)`,
    `test -n "$DB_ID" || { echo "ABORT: container database tidak berjalan" >&2; exit 2; }`,
    `APP_ID=$(${compose} ps -q ${production.appService} </dev/null)`,
    `test -n "$APP_ID" || { echo "ABORT: container app tidak berjalan" >&2; exit 2; }`,
    `mkdir -p ${shellQuote(dir)}`,
    // 1. Database
    `PGDB=$(docker exec "$DB_ID" printenv POSTGRES_DB)`,
    `PGU=$(docker exec "$DB_ID" printenv POSTGRES_USER)`,
    `docker exec "$DB_ID" pg_dump -U "$PGU" -d "$PGDB" --format=custom --no-owner --no-privileges > ${shellQuote(
      `${dir}/${DATABASE_ARCHIVE}`,
    )} </dev/null`,
    // 2. Verifikasi dump: isi arsip dibaca, bukan sekadar ukurannya diperiksa.
    //    Nama arsip sengaja tidak diberikan sebagai argumen; pg_restore membaca
    //    stdin hanya ketika argumen itu tidak ada, sedangkan `-` diperlakukan
    //    sebagai nama berkas literal.
    `docker exec -i "$DB_ID" pg_restore --list < ${shellQuote(
      `${dir}/${DATABASE_ARCHIVE}`,
    )} > /dev/null || { echo "ABORT: arsip database tidak dapat dibaca pg_restore" >&2; exit 4; }`,
    `DB_BYTES=$(stat -c %s ${shellQuote(`${dir}/${DATABASE_ARCHIVE}`)})`,
    `echo "DATABASE_BYTES=$DB_BYTES"`,
    `echo "DATABASE_VERIFIED=yes"`,
    // 3. Keadaan media: fakta mentah dikumpulkan lebih dulu, keputusan diambil
    //    di TypeScript (`classifyMediaActivation`), bukan di shell. Shell hanya
    //    melaporkan apa adanya; menaruh aturan bootstrap di sini akan membuatnya
    //    mustahil diuji tanpa produksi.
    `ROOT=$(docker exec "$APP_ID" printenv MEDIA_STORAGE_ROOT || true)`,
    `echo "RUNTIME_MEDIA_ROOT=${"$"}{ROOT:-}"`,
    `if [ -n "$ROOT" ] && docker inspect --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}' "$APP_ID" | grep -qx "$ROOT"; then echo "RUNTIME_MEDIA_MOUNT=yes"; else echo "RUNTIME_MEDIA_MOUNT=no"; fi`,
    // Jumlah baris yang sudah punya kunci media kanonik. Nol berarti media
    // storage belum pernah dipakai; gagal query berarti TIDAK TERJAWAB, dan
    // itu ditangani sebagai keadaan ambigu, bukan sebagai nol.
    `if MEDIA_KEYS=$(docker exec -i "$DB_ID" psql -U "$PGU" -d "$PGDB" -At -c ${shellQuote(
      MEDIA_KEY_COUNT_QUERY,
    )} </dev/null 2>/dev/null); then echo "MEDIA_KEY_ROWS=$MEDIA_KEYS"; else echo "MEDIA_KEY_ROWS=unknown"; fi`,
    `if [ -z "$ROOT" ]; then echo "MEDIA_ARCHIVE_SKIPPED=yes"; echo "SET_DIR=${dir}"; exit 0; fi`,
    // 3b. Arsip media, dibaca dari dalam container app supaya akar media persis
    //     sama dengan yang dipakai aplikasi.
    `MEDIA_COUNT=$(docker exec "$APP_ID" sh -c "find \\"$ROOT\\" -type f | wc -l" </dev/null)`,
    `docker exec "$APP_ID" tar -czf - -C "$ROOT" . > ${shellQuote(
      `${dir}/${MEDIA_ARCHIVE}`,
    )} </dev/null`,
    // 4. Verifikasi arsip media dengan membacanya kembali seluruhnya.
    `ARCHIVE_COUNT=$(tar -tzf ${shellQuote(
      `${dir}/${MEDIA_ARCHIVE}`,
    )} | grep -c -v '/$' || true)`,
    `test "$ARCHIVE_COUNT" = "$MEDIA_COUNT" || { echo "ABORT: arsip media memuat $ARCHIVE_COUNT berkas, sumber $MEDIA_COUNT" >&2; exit 6; }`,
    `MEDIA_BYTES=$(stat -c %s ${shellQuote(`${dir}/${MEDIA_ARCHIVE}`)})`,
    `echo "MEDIA_BYTES=$MEDIA_BYTES"`,
    `echo "MEDIA_COUNT=$MEDIA_COUNT"`,
    `echo "MEDIA_VERIFIED=yes"`,
    `echo "SET_DIR=${dir}"`,
  ].join("\n")
}
