import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

/**
 * Phase 5: otorisasi harus berjalan sebelum parsing/validasi payload.
 *
 * Kalau `settingInput.parse()` dijalankan lebih dulu, pemanggil tanpa hak
 * menerima 400 berisi pesan validasi Zod alih-alih 403 — perbedaan status yang
 * membocorkan bentuk skema kepada pihak yang seharusnya ditolak lebih awal.
 */
test("PUT /api/admin/settings menolak sebelum mem-parse payload", () => {
  const source = read("app/api/admin/settings/route.ts")
  const put = source.slice(source.indexOf("export async function PUT"))

  const firstGuard = put.search(/require(Any)?Permission\(/)
  const firstParse = put.indexOf("settingInput.parse")

  assert.ok(firstGuard !== -1 && firstParse !== -1, "PUT harus punya guard dan parsing")
  assert.ok(
    firstGuard < firstParse,
    "requirePermission harus dipanggil sebelum settingInput.parse agar penolakan tetap 403, bukan 400 validasi",
  )
})

/**
 * Setiap grup field tetap butuh grant-nya sendiri. Ini menjaga agar editor
 * pengaturan biasa tidak bisa menyalakan akses seluruh kelas.
 */
test("grup field pengaturan tetap menuntut permission masing-masing", () => {
  const source = read("app/api/admin/settings/route.ts")

  assert.match(source, /SETTINGS_FIELDS\)\)\s*await requirePermission\("school\.settings\.update"\)/)
  assert.match(source, /BRANDING_FIELDS\)\)\s*await requirePermission\("school\.branding\.update"\)/)
  assert.match(source, /CLASS_ACCESS_FIELDS\)\)\s*await requirePermission\("school\.class_access\.manage"\)/)
})
