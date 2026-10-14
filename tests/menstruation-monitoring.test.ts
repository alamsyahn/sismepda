import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"

test("kartu individual hanya dimuat dengan izin khusus dan gender perempuan", () => {
  const page = readFileSync("app/e-uks/pantauan-kesehatan/page.tsx", "utf8")
  assert.match(page, /pageCan\("euks\.menstruation\.read"\)/)
  assert.match(page, /canMenstruation && monitoring\?\.student\.gender === "PEREMPUAN"/)
  assert.match(page, /await readMenstruationCard\(studentId\)/)
  assert.match(page, /<MenstruationCard/)
  const printPayload = page.slice(page.indexOf("<EuksStudentPrintAction"), page.indexOf("<div className=\"grid gap-6"))
  assert.doesNotMatch(printPayload, /menstruation|Menstruation/)
})
