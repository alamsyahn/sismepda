import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const settings = source("app/api/admin/settings/route.ts")
const holidays = source("app/api/admin/holidays/route.ts")
const database = source("app/api/admin/database/route.ts")
const appLogo = source("app/app-logo/route.ts")
const favicon = source("app/favicon.ico/route.ts")
const publicBranding = source("app/site-branding.json/route.ts")
const serverBranding = source("lib/server-site-branding.ts")

function handlerBody(route: string, method: string): string {
  const start = route.indexOf(`export async function ${method}`)
  assert.notEqual(start, -1, `${method} handler tidak ditemukan`)
  const next = route.indexOf("\nexport async function ", start + 1)
  return route.slice(start, next === -1 ? route.length : next)
}

test("settings GET memakai permission read DB-current", () => {
  assert.match(handlerBody(settings, "GET"), /await requirePermission\("school\.settings\.read"\)/)
  assert.doesNotMatch(settings, /requireAdmin/)
})

test("settings PUT memisahkan field class access dari settings dan branding", () => {
  const put = handlerBody(settings, "PUT")
  assert.match(put, /school\.settings\.update/)
  assert.match(put, /school\.class_access\.manage/)
  assert.match(put, /school\.branding\.update/)
  assert.match(settings, /SETTINGS_FIELDS/)
  assert.match(settings, /BRANDING_FIELDS/)
  assert.match(settings, /CLASS_ACCESS_FIELDS/)
  assert.match(settings, /allowTeachersAccessAllClasses/)
})

test("mutasi branding text dan asset memakai school.branding.update", () => {
  assert.match(handlerBody(settings, "PUT"), /school\.branding\.update/)
  for (const route of [appLogo, favicon]) {
    assert.doesNotMatch(route, /requireAdmin/)
    assert.match(handlerBody(route, "PUT"), /await requirePermission\("school\.branding\.update"\)/)
  }
  assert.match(handlerBody(appLogo, "DELETE"), /await requirePermission\("school\.branding\.update"\)/)
})

test("GET branding tetap publik dengan projection persis", () => {
  assert.doesNotMatch(publicBranding, /requirePermission|requireAdmin|requireUser/)
  assert.match(serverBranding, /select:\s*{[\s\S]*?websiteTitle: true,[\s\S]*?faviconUpdatedAt: true,[\s\S]*?appName: true,[\s\S]*?appFullName: true,[\s\S]*?appLogoUpdatedAt: true,?\s*}/)
  assert.doesNotMatch(serverBranding, /select:\s*{[^}]*schoolName/)
})

test("holiday CRUD memakai permission operasi masing-masing", () => {
  const expected = {
    GET: "school.holidays.read",
    POST: "school.holidays.create",
    PATCH: "school.holidays.update",
    DELETE: "school.holidays.delete",
  } as const
  for (const [method, permission] of Object.entries(expected)) {
    assert.match(handlerBody(holidays, method), new RegExp(`await requirePermission\\(\"${permission.replaceAll(".", "\\.")}\"\\)`))
  }
  assert.doesNotMatch(holidays, /requireAdmin/)
})

test("backup dan restore menolak sebelum side effect dengan permission independen", () => {
  const backup = handlerBody(database, "GET")
  const restore = handlerBody(database, "POST")
  assert.match(backup, /await requirePermission\("database\.backup"\)/)
  assert.match(restore, /await requirePermission\("database\.restore"\)/)
  assert.ok(backup.indexOf("requirePermission") < backup.indexOf("mkdtemp"), "backup guard harus sebelum filesystem/proses")
  assert.ok(restore.indexOf("requirePermission") < restore.indexOf("formData"), "restore guard harus sebelum membaca upload")
  assert.ok(restore.indexOf("requirePermission") < restore.indexOf("mkdtemp"), "restore guard harus sebelum filesystem/proses")
  assert.doesNotMatch(database, /requireAdmin/)
  assert.match(database, /authFailureResponse\(error,/)
})
