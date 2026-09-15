/**
 * Kontrak permukaan CLI developer.
 *
 * `package.json` adalah antarmuka publik proyek ini: nama perintahnyalah yang
 * dibaca operator saat memilih database mana yang akan ditulis. Karena itu
 * aturan penamaannya dikunci di sini, bukan sekadar didokumentasikan.
 *
 * Dua invarian yang dijaga:
 * 1. setiap perintah yang dapat MEMBACA atau MENULIS database tertentu harus
 *    menyebut targetnya pada namanya, dan target itu dipilih lewat
 *    `scripts/with-db.ts`, bukan lewat `.env` yang kebetulan aktif;
 * 2. tidak ada jalur pintas npm menuju produksi.
 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

const PROJECT = path.resolve(import.meta.dirname, "..")

async function scripts(): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(path.join(PROJECT, "package.json"), "utf8"))
  return pkg.scripts as Record<string, string>
}

/** Perintah kanonik yang harus ada. Daftar ini adalah spesifikasinya. */
const canonicalCommands = [
  "dev:local",
  "dev:prodclone",
  "db:prodclone:refresh",
  "media:prodclone:sync",
  "prodclone:refresh",
  "db:migrate:local",
  "db:seed:local",
  "db:setup:local",
  "db:studio:local",
  "db:studio:prodclone",
  "db:ensure-test-user:local",
  "db:bootstrap:local",
  "euks:seed:local",
  "euks:clear:local",
  "euks:seed:prodclone",
  "euks:clear:prodclone",
  "media:migrate:local",
  "media:migrate:verify:local",
  "media:migrate:production",
  "media:backup:create",
  "media:backup:verify",
  "media:backup:restore-test",
  "backup:production",
  "backup:production:verify",
  "db:rbac-backfill",
  "db:analyze-legacy-dates:prodclone",
  "deploy:check",
  "deploy:preflight",
  "deploy:prod",
  "deploy:status",
  "build",
  "start",
  "lint",
  "test",
  "postinstall",
] as const

/**
 * Perintah yang sengaja DIHAPUS. Semuanya punya cacat yang sama: perilakunya
 * ditentukan `DATABASE_URL` ambient, sehingga perintah yang sama bisa menulis
 * ke database berbeda tergantung isi `.env` saat itu. Dites sebagai larangan
 * supaya tidak ada yang menghidupkannya kembali sebagai "alias praktis".
 */
const forbiddenCommands = [
  "dev",
  "db:refresh-prodclone",
  "db:studio",
  "db:migrate",
  "db:seed",
  "db:setup",
  "db:ensure-test-user",
  "dev:euks-seed",
  "dev:euks-clear",
  "dev:bootstrap",
  "media:migrate",
  "media:migrate:verify",
  "db:analyze-legacy-dates",
] as const

test("package.json: seluruh perintah kanonik tersedia", async () => {
  const s = await scripts()
  for (const name of canonicalCommands) {
    assert.ok(s[name], `perintah kanonik hilang: ${name}`)
  }
})

test("package.json: perintah lama bertarget ambient sudah tidak ada", async () => {
  const s = await scripts()
  for (const name of forbiddenCommands) {
    assert.equal(s[name], undefined, `perintah ambigu masih ada: ${name}`)
  }
})

test("package.json: tidak ada alias yang hanya meneruskan ke perintah lain", async () => {
  const s = await scripts()
  for (const [name, body] of Object.entries(s)) {
    // `db:setup:local` sengaja dikecualikan: ia MENGGABUNGKAN dua perintah
    // (migrate lalu seed), bukan alias satu-ke-satu.
    if (name === "db:setup:local") continue
    assert.ok(
      !/^npm run [\w:-]+$/.test(body.trim()),
      `"${name}" hanyalah alias untuk "${body}"; pakai perintah kanoniknya langsung`,
    )
  }
})

test("package.json: perintah bertarget database memilih peran lewat with-db", async () => {
  const s = await scripts()
  const roleScoped = Object.entries(s).filter(
    ([name]) => name.endsWith(":local") || name.endsWith(":prodclone"),
  )
  assert.ok(roleScoped.length >= 10, "ekspektasi: mayoritas perintah DB bertarget eksplisit")

  for (const [name, body] of roleScoped) {
    // Dua pengecualian yang disengaja, keduanya bukan pemakai with-db:
    // - `db:setup:local` merangkai dua perintah npm yang masing-masing sudah
    //   lewat with-db;
    // - `db:analyze-legacy-dates:prodclone` membaca `.env.prodclone` sendiri
    //   dan menjalankan guard `assertDestroyableClone` pada jalurnya sendiri.
    if (name === "db:setup:local") {
      assert.ok(body.includes("db:migrate:local") && body.includes("db:seed:local"))
      continue
    }
    if (name === "db:analyze-legacy-dates:prodclone") continue

    const role = name.endsWith(":prodclone") ? "prodclone" : "local"
    assert.ok(
      body.includes(`scripts/with-db.ts ${role}`),
      `"${name}" harus memilih database lewat \`with-db.ts ${role}\`, bukan .env ambient`,
    )
  }
})

test("package.json: tidak ada jalur npm menuju schema change produksi", async () => {
  const s = await scripts()
  for (const name of ["db:migrate:production", "db:seed:production", "db:setup:production", "db:studio:production"]) {
    assert.equal(s[name], undefined, `${name} membuka bypass terhadap workflow deployment`)
  }

  // `prisma migrate dev` / `db seed` / `studio` hanya boleh muncul pada
  // perintah yang sudah terkunci ke peran lokal.
  for (const [name, body] of Object.entries(s)) {
    if (/prisma (migrate dev|db seed|studio)/.test(body)) {
      assert.ok(
        body.includes("scripts/with-db.ts local") || body.includes("scripts/with-db.ts prodclone"),
        `"${name}" menjalankan perintah Prisma development tanpa peran database eksplisit`,
      )
    }
  }
})

test("package.json: hanya perintah bernama :production yang boleh menyentuh produksi", async () => {
  const s = await scripts()
  for (const [name, body] of Object.entries(s)) {
    if (!body.includes("migrate-media-production") && !body.includes("backup-production")) continue
    assert.ok(
      name.includes("production"),
      `"${name}" menjalankan skrip produksi tetapi namanya tidak menyebut production`,
    )
  }
})

test("dokumentasi dan source tidak lagi menyebut perintah npm yang dihapus", async () => {
  const files = [
    "README.md",
    "docs/operations/development.md",
    "docs/operations/local-database-workflow.md",
    "docs/operations/backup-restore.md",
    "docs/operations/deployment.md",
    "docs/operations/media-rollout.md",
    "docs/operations/rbac-cutover.md",
    "docs/architecture/media-storage.md",
    "scripts/dev-bootstrap.ts",
    "scripts/generate-euks-test-data.ts",
    "scripts/clear-euks-test-data.ts",
    "scripts/ensure-local-test-user.ts",
    "scripts/migrate-media.ts",
    "scripts/verify-media-migration.ts",
    "prisma/schema.prisma",
  ]

  for (const file of files) {
    const content = await readFile(path.join(PROJECT, file), "utf8")
    for (const name of forbiddenCommands) {
      // Batas kata di kanan: `db:seed` tidak boleh cocok dengan `db:seed:local`.
      const stale = new RegExp(`.*npm run ${name.replace(/[:.]/g, "\\$&")}(?![\\w:-]).*`, "g")
      for (const line of content.match(stale) ?? []) {
        // Dokumentasi boleh — dan sebaiknya — menjelaskan bahwa sebuah perintah
        // sengaja tidak ada; yang dilarang adalah menyuruh operator memakainya.
        // Penanda negasi eksplisit dikecualikan agar alasan penghapusan tetap
        // dapat ditulis, sementara instruksi basi tetap tertangkap.
        if (/no bare|Tidak ada |tidak ada /.test(line)) continue
        assert.fail(`${file} masih menyebut \`npm run ${name}\`: ${line.trim()}`)
      }
    }
  }
})
