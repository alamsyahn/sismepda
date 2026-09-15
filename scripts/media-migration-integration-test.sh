#!/usr/bin/env bash
# Integration test jalur eksekusi migrator — container NYATA, database sekali
# pakai, volume media sementara.
#
# MENGAPA SKRIP, BUKAN UNIT TEST
#
# Yang diuji di sini justru hal-hal yang tidak bisa dibuktikan unit test:
# apakah `scripts/` benar-benar ada DI DALAM image, apakah `tsx` benar-benar
# dapat menjalankannya, apakah volume media benar-benar ter-mount, dan apakah
# `--dry-run` benar-benar tidak menulis apa pun. Unit test hanya memeriksa
# string Dockerfile; ini memeriksa artefak yang akan dijalankan produksi.
#
# TIDAK PERNAH MENYENTUH PRODUKSI. Semua sumber daya diberi awalan
# `sismepda-mediaitest-` dan dibuang di akhir.
#
#   bash scripts/media-migration-integration-test.sh
set -euo pipefail

IMAGE="sismepda-migrator:itest"
PREFIX="sismepda-mediaitest"
NET="${PREFIX}-net"
DB="${PREFIX}-db"
VOL="${PREFIX}-media"
DB_PASSWORD="itest-only-not-a-production-secret"
DB_URL="postgresql://postgres:${DB_PASSWORD}@${DB}:5432/postgres"
MEDIA_ROOT="/app/media"

cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

fail() { echo "GAGAL: $*" >&2; exit 1; }
ok() { echo "  ok — $*"; }

echo "== Menyiapkan lingkungan sekali pakai =="
docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" postgres:17-bookworm >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$DB" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$DB" pg_isready -U postgres >/dev/null 2>&1 || fail "database sekali pakai tidak siap"

# Helper: jalankan perintah di container migrator dengan mount dan jaringan
# yang sama bentuknya dengan produksi.
migrator() {
  docker run --rm --network "$NET" -v "$VOL:$MEDIA_ROOT" \
    -e DATABASE_URL="$DB_URL" -e MEDIA_STORAGE_ROOT="$MEDIA_ROOT" \
    --entrypoint sh "$IMAGE" -c "$1"
}

echo ""
echo "== 1. Kelengkapan image migrator =="
migrator "test -f scripts/migrate-media.ts" || fail "scripts/migrate-media.ts tidak ada di image"
ok "scripts/migrate-media.ts ada"
migrator "test -f scripts/verify-media-migration.ts" || fail "skrip verifikasi tidak ada"
ok "scripts/verify-media-migration.ts ada"
migrator "test -f lib/prisma.ts && test -f lib/server-media-storage.ts && test -f lib/media-keys.ts" \
  || fail "lib yang dibutuhkan tidak lengkap"
ok "lib/prisma.ts, lib/server-media-storage.ts, lib/media-keys.ts ada"
migrator "test -d app/generated/prisma" || fail "Prisma client hasil generate tidak ada"
ok "Prisma client hasil generate ada"
migrator "command -v npx >/dev/null && npx tsx --version >/dev/null" || fail "tsx tidak dapat dijalankan"
ok "tsx dapat dijalankan: $(migrator 'npx tsx --version' 2>/dev/null | tail -1)"

echo ""
echo "== 2. Mount media kanonik =="
migrator "test -d $MEDIA_ROOT" || fail "$MEDIA_ROOT tidak ada"
migrator "A=\$(stat -c %d $MEDIA_ROOT); B=\$(stat -c %d $MEDIA_ROOT/..); test \"\$A\" != \"\$B\"" \
  || fail "$MEDIA_ROOT bukan mount"
ok "$MEDIA_ROOT adalah mount, bukan writable layer"

echo ""
echo "== 3. Skema + fixture legacy =="
migrator "npx prisma migrate deploy" >/dev/null 2>&1 || fail "migrate deploy gagal"
ok "skema diterapkan"

# Satu baris legacy: bytea terisi, kunci masih NULL → tepat satu kandidat.
#
# `updatedAt` diisi eksplisit karena Prisma mengelolanya di lapisan aplikasi,
# jadi kolomnya tidak punya default di database. `photoUpdatedAt` juga wajib:
# `User_photo_consistency_check` menuntut metadata lengkap setiap kali ada byte
# foto — persis bentuk baris legacy produksi.
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "
  INSERT INTO \"User\" (id, email, name, role, \"passwordHash\", \"photoData\", \"photoMimeType\", \"photoUpdatedAt\", \"updatedAt\")
  VALUES ('itest-legacy-1', 'itest@example.invalid', 'ITest Legacy', 'GURU', 'x',
          decode('89504e470d0a1a0a', 'hex'), 'image/png', now(), now());
" || fail "fixture legacy gagal dibuat"
ok "fixture legacy dibuat (1 baris bytea tanpa kunci)"

echo ""
echo "== 4. Baseline =="
count_keys() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB" psql -U postgres -d postgres -tAc \
    'SELECT count(*) FROM "User" WHERE "photoKey" IS NOT NULL'
}
count_files() { migrator "find $MEDIA_ROOT -type f | wc -l" | tr -d '[:space:]'; }
count_bytes() { migrator "find $MEDIA_ROOT -type f -printf '%s\n' | awk '{s+=\$1} END {print s+0}'" | tr -d '[:space:]'; }

KEYS_BEFORE=$(count_keys | tr -d '[:space:]')
FILES_BEFORE=$(count_files)
BYTES_BEFORE=$(count_bytes)
echo "  media-key rows ... $KEYS_BEFORE"
echo "  media files ...... $FILES_BEFORE"
echo "  media bytes ...... $BYTES_BEFORE"

echo ""
echo "== 5. DRY RUN nyata lewat jalur migrator =="
DRY_OUTPUT=$(migrator "npx tsx scripts/migrate-media.ts --dry-run")
echo "$DRY_OUTPUT" | sed 's/^/  | /'
echo "$DRY_OUTPUT" | grep -q "DRY RUN" || fail "keluaran tidak menandai dry-run"
echo "$DRY_OUTPUT" | grep -q "Total kandidat : 1" || fail "kandidat tidak terdeteksi (harus 1)"
ok "kandidat terdeteksi"

echo ""
echo "== 6. Bukti zero-write =="
KEYS_AFTER=$(count_keys | tr -d '[:space:]')
FILES_AFTER=$(count_files)
BYTES_AFTER=$(count_bytes)
[ "$KEYS_BEFORE" = "$KEYS_AFTER" ] || fail "media-key rows berubah: $KEYS_BEFORE → $KEYS_AFTER"
ok "media-key rows tidak berubah ($KEYS_AFTER)"
[ "$FILES_BEFORE" = "$FILES_AFTER" ] || fail "jumlah berkas berubah: $FILES_BEFORE → $FILES_AFTER"
ok "jumlah berkas tidak berubah ($FILES_AFTER)"
[ "$BYTES_BEFORE" = "$BYTES_AFTER" ] || fail "byte berubah: $BYTES_BEFORE → $BYTES_AFTER"
ok "byte media tidak berubah ($BYTES_AFTER)"

echo ""
echo "== 7. Jalur tulis berfungsi (fixture sekali pakai saja) =="
# Membuktikan jalur eksekusinya memang MAMPU memigrasikan — kalau tidak,
# dry-run yang bersih tidak membuktikan apa-apa tentang kesiapan produksi.
migrator "npx tsx scripts/migrate-media.ts" | sed 's/^/  | /'
KEYS_APPLIED=$(count_keys | tr -d '[:space:]')
FILES_APPLIED=$(count_files)
[ "$KEYS_APPLIED" = "1" ] || fail "migrasi tidak menulis kunci (dapat $KEYS_APPLIED)"
[ "$FILES_APPLIED" = "1" ] || fail "migrasi tidak menulis berkas (dapat $FILES_APPLIED)"
ok "migrasi menulis 1 kunci + 1 berkas ke volume kanonik"

LEGACY_KEPT=$(docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB" psql -U postgres -d postgres -tAc \
  'SELECT count(*) FROM "User" WHERE "photoData" IS NOT NULL' | tr -d '[:space:]')
[ "$LEGACY_KEPT" = "1" ] || fail "byte legacy tidak dipertahankan"
ok "byte legacy tetap utuh setelah migrasi"

echo ""
echo "== 8. Idempotensi =="
RERUN=$(migrator "npx tsx scripts/migrate-media.ts --dry-run")
echo "$RERUN" | grep -q "Total kandidat : 0" || fail "baris yang sudah berkunci tidak dilewati"
ok "baris berkunci dilewati pada eksekusi berikutnya"

echo ""
echo "SEMUA PEMERIKSAAN LULUS"
