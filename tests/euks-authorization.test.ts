import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("E-UKS uses DB-current school-wide permission guards, not homeroom or legacy flags", () => {
  const access = read("lib/euks-access.ts")
  assert.match(access, /requirePermission/)
  // Abaikan komentar: yang dinilai adalah kode yang benar-benar dieksekusi.
  const code = access.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
  assert.doesNotMatch(code, /canViewEuks|canEditEuks|requireClassScope|homeroom/i)
  assert.doesNotMatch(code, /requireEuksAdmin|role === "ADMIN"/)
})

test("visit update permission does not authorize sick absence update", () => {
  assert.match(read("app/api/e-uks/visits/[visitId]/route.ts"), /euks\.visits\.update/)
  assert.match(read("app/api/e-uks/sick-absences/[attendanceId]/route.ts"), /euks\.sick_absences\.update/)
})

test("sick absence endpoint cannot accept or update status date or class", () => {
  const source = read("app/api/e-uks/sick-absences/[attendanceId]/route.ts")
  assert.match(source, /status:\s*"SAKIT"/)
  assert.doesNotMatch(source, /status:\s*z\.|date:\s*z\.|classId:\s*z\./)
  assert.match(source, /data:\s*\{\s*note,\s*followUp\s*\}/)
})

test("landing content is isolated from optional overview health queries", () => {
  const source = read("app/e-uks/page.tsx")
  const overviewGuard = source.indexOf('pageCan("euks.overview.read")')
  const trendQuery = source.indexOf("readEuksVisitDateRange()")
  assert.ok(overviewGuard >= 0 && trendQuery > overviewGuard)
  assert.match(source, /const range = canOverview \? await readEuksVisitDateRange\(\) : null/)
})

test("notifikasi kunjungan menuntut permission-nya sendiri, bukan hak menyunting", () => {
  const route = read("app/api/e-uks/visits/[visitId]/notify/route.ts")
  assert.match(route, /requireEuksPermission\("euks\.visits\.notify"\)/)
  // Guard berjalan SEBELUM service dipanggil; permintaan langsung ke API tanpa
  // hak notifikasi tidak boleh pernah menyentuh jalur pengiriman.
  const guard = route.indexOf("euks.visits.notify")
  const send = route.indexOf("notifyEuksVisit(")
  assert.ok(guard >= 0 && send > guard)
})

test("Simpan & Kirim memeriksa hak notifikasi terpisah dari hak mencatat", () => {
  const route = read("app/api/e-uks/visits/route.ts")
  assert.match(route, /requireEuksPermission\("euks\.visits\.create"\)/)
  assert.match(route, /requireEuksPermission\("euks\.visits\.notify"\)/)
  // Pemeriksaan kedua berada di dalam cabang `body.notify`, sehingga pencatatan
  // biasa tidak ikut menuntut hak mengirim.
  const branch = route.indexOf("if (body.notify)")
  assert.ok(branch >= 0)
  assert.ok(route.indexOf('requireEuksPermission("euks.visits.notify")') > branch)
})

test("PATCH kunjungan tidak pernah mengirim pesan sebagai efek samping", () => {
  const route = read("app/api/e-uks/visits/[visitId]/route.ts")
  assert.doesNotMatch(route, /notifyEuksVisit|euks\.visits\.notify/)
})

test("service notifikasi memakai relasi wali kelas resmi, bukan mapping sendiri", () => {
  const source = read("lib/server-euks-notification.ts")
  assert.match(source, /homeroomUser/)
  // Nomor dibaca dari User.phone lewat relasi kelas; tidak ada tabel atau kolom
  // nomor khusus E-UKS.
  assert.doesNotMatch(source, /euksHomeroom|homeroomPhone:|EuksRecipient/)
  assert.match(source, /normalizeIndonesianPhone/)
})

test("measurement delete requires its exact permission", () => {
  assert.match(read("app/api/e-uks/measurements/[measurementId]/route.ts"), /euks\.measurements\.delete/)
})

test("complaint read permission does not grant mutation", () => {
  const source = read("app/api/e-uks/complaint-options/route.ts")
  assert.match(source, /GET[\s\S]*euks\.complaint_options\.read/)
  assert.match(source, /POST[\s\S]*euks\.complaint_options\.create/)
  assert.match(source, /PATCH[\s\S]*euks\.complaint_options\.update/)
})

test("E-UKS settings page is permission-composed, not legacy ADMIN-gated", () => {
  const source = read("app/e-uks/pengaturan/page.tsx")
  assert.doesNotMatch(source, /requireEuksAdmin|role === "ADMIN"|legacyAdminOnly/)
  assert.match(source, /requirePageAnyPermission\(/)
  // Setiap panel hanya dimuat bila pemakainya berhak atasnya.
  assert.match(source, /pageCan/)
  for (const key of [
    "euks.profile.update",
    "euks.officers.create",
    "euks.facilities.delete",
    "euks.complaint_options.update",
  ]) {
    assert.ok(source.includes(`"${key}"`), `panel permission ${key} hilang`)
  }
  assert.match(source, /canOfficers \? await readAssignableTeachers\(\) : \[\]/)
})
