/**
 * Audit inventaris otorisasi: memastikan tidak ada jalur legacy yang masih
 * menjadi authority aktif setelah cutover RBAC.
 *
 * Menguji TEKS SUMBER karena yang dijaga adalah properti seluruh basis kode
 * ("tidak ada surface yang memutuskan akses dari User.role"), bukan perilaku
 * satu fungsi. Pemindaian teks menangkap call-site baru yang ditambahkan nanti;
 * unit test per-modul tidak.
 *
 * Pengecualian yang SAH (bukan authority):
 *   - lib/rbac-legacy.ts  : peta paritas untuk backfill one-time
 *   - lib/rbac-backfill.ts: pembaca flag legacy saat backfill
 *   - lib/euks.ts         : kode mati pasca-RBAC (lihat test terakhir)
 *   - app/generated/**    : artefak Prisma
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["app", "lib", "components"]

/** Modul yang memang berhak membaca flag legacy, dengan alasannya. */
const BACKFILL_ONLY = new Set([
  "lib/rbac-legacy.ts",
  "lib/rbac-backfill.ts",
  "prisma/rbac-backfill-legacy.ts",
])

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const rel = path.replace(/\\/g, "/")
      if (rel.startsWith("app/generated")) continue
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry)) out.push(rel)
    }
  }
  for (const root of ROOTS) walk(root)
  return out
}

const files = sourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }))

/** Buang komentar supaya penyebutan dalam dokumentasi tidak memicu temuan. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n")
}

test("inventaris sumber tidak kosong", () => {
  // Penjaga terhadap audit yang lolos karena tidak memindai apa pun.
  assert.ok(files.length > 200, `hanya ${files.length} berkas terpindai`)
})

/**
 * Perbandingan `role === "ADMIN"` yang SAH, masing-masing dengan alasan.
 * Yang dilarang adalah perbandingan yang MEMUTUSKAN AKSES.
 */
const ROLE_COMPARE_ALLOWED = new Map([
  // Label tampilan: fallback jabatan pada kartu profil guru. Tidak
  // mengembalikan izin dan tidak menyembunyikan data apa pun.
  ["app/guru/[teacherId]/page.tsx", "label jabatan, bukan otorisasi"],
  // Kode mati pasca-RBAC; ketiadaan pemanggil dikunci test terpisah.
  ["lib/euks.ts", "kode mati"],
  ["lib/sarpras.ts", "kode mati"],
  ["lib/teacher-profile.ts", "kode mati"],
  ["lib/workbook.ts", "kode mati"],
])

test("tidak ada surface baru yang memutuskan akses dari User.role legacy", () => {
  const offenders = files
    .filter(({ path }) => !BACKFILL_ONLY.has(path) && !ROLE_COMPARE_ALLOWED.has(path))
    .filter(({ text }) => /\brole\s*===\s*"(ADMIN|GURU)"|\brole\s*!==\s*"(ADMIN|GURU)"/.test(code(text)))
    .map(({ path }) => path)

  assert.deepEqual(offenders, [], `perbandingan role legacy sebagai authority: ${offenders.join(", ")}`)
})

const LEGACY_FLAGS = [
  "canManageTeacherProfiles",
  "canSuperviseWorkbooks",
  "canViewWorkbookSupervision",
  "canViewBos",
  "canCreateBos",
  "canEditBos",
  "canManageBosCategories",
  "canManageBosAccess",
  "canViewSarpras",
  "canEditSarpras",
  "canViewEuks",
  "canEditEuks",
]

/**
 * Penggunaan flag legacy yang SAH pasca-cutover, masing-masing dengan alasan.
 * Yang dilarang adalah flag sebagai *authority* (mengembalikan izin), bukan
 * sebagai nilai yang ditulis, ditampilkan, atau ditolak.
 */
const LEGACY_FLAG_ALLOWED = new Map([
  // Daftar tolak mass-assignment: menyebut flag justru supaya payload yang
  // memuatnya ditolak.
  ["lib/account-schemas.ts", "denylist mass-assignment"],
  ["lib/teacher-schemas.ts", "denylist mass-assignment"],
  // Menulis kolom inert + menampilkannya di UI pengelolaannya sendiri.
  // Authority-nya RBAC (`workbook.scope.manage`). Lihat TD-008.
  ["app/api/workbooks/scope/route.ts", "menulis kolom inert, authority RBAC"],
  ["lib/server-workbook.ts", "menampilkan nilai kolom di UI scope"],
  ["components/supervisi/supervision-scope-manager.tsx", "UI pengelola kolom inert"],
  ["lib/server-teacher-profile.ts", "menulis/menampilkan kolom inert"],
  // Kode mati pasca-RBAC; ketiadaan pemanggil dikunci test terpisah.
  ["lib/euks.ts", "kode mati"],
  ["lib/euks-access.ts", "kode mati"],
  ["lib/sarpras.ts", "kode mati"],
  ["lib/teacher-profile.ts", "kode mati"],
  ["lib/workbook.ts", "kode mati"],
])

test("tidak ada guard baru yang membaca boolean authorization legacy", () => {
  // Flag ini inert pasca-cutover. Membacanya untuk memutuskan akses akan
  // menghidupkan kembali sumber kebenaran kedua yang tak bisa dikelola UI RBAC.
  // Berkas baru yang menyentuh flag ini harus diperiksa manual lalu didaftarkan
  // dengan alasan eksplisit — gagal secara default, bukan lolos secara default.
  const pattern = new RegExp(`\\b(${LEGACY_FLAGS.join("|")})\\b`)

  const offenders = files
    .filter(({ path }) => !BACKFILL_ONLY.has(path) && !LEGACY_FLAG_ALLOWED.has(path))
    .filter(({ text }) => pattern.test(code(text)))
    .map(({ path }) => path)

  assert.deepEqual(offenders, [], `flag legacy terbaca di berkas tak terdaftar: ${offenders.join(", ")}`)
})

test("tidak ada requireAdmin atau guard berbasis peran generik", () => {
  const offenders = files
    .filter(({ text }) => /\brequireAdmin\b|\bisAdmin\s*\(|\brequireRole\s*\(/.test(code(text)))
    .map(({ path }) => path)

  assert.deepEqual(offenders, [], `guard berbasis peran: ${offenders.join(", ")}`)
})

test("permission diresolusi dari database, bukan dari klaim JWT", () => {
  // JWT bisa basi: permission yang dicabut harus langsung berlaku, jadi
  // resolusi wajib menyentuh database pada tiap permintaan.
  const access = readFileSync("lib/rbac-access.ts", "utf8")

  assert.match(access, /prisma/, "resolusi permission harus membaca database")
  assert.doesNotMatch(
    code(access),
    /token\.(permissions|grants|roles)|session\.user\.(permissions|grants)/,
    "permission tidak boleh dibaca dari token/sesi",
  )
})

test("helper euks legacy sudah menjadi kode mati", () => {
  // hasEuksPermission() masih mengandung `role === "ADMIN"`. Itu hanya aman
  // selama tidak ada satu pun surface yang memanggilnya.
  const callers = files
    .filter(({ path }) => path !== "lib/euks.ts")
    .filter(({ text }) => /\b(hasEuksPermission|euksCapabilities)\b|\bcanViewEuks\s*\(/.test(code(text)))
    .map(({ path }) => path)

  assert.deepEqual(callers, [], `helper euks legacy masih dipanggil: ${callers.join(", ")}`)
})
