import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

import {
  addSchoolDays,
  compareSchoolDates,
  eachSchoolDate,
  formatSchoolDate,
  formatSchoolTime,
  fromPrismaDate,
  isIanaTimeZone,
  parseSchoolDate,
  prismaSchoolDateRange,
  schoolDateAtStart,
  schoolDateFromInstant,
  schoolMonthOf,
  schoolTimestampRange,
  startOfSchoolWeek,
  todayInSchoolTimeZone,
  toPrismaDate,
} from "../lib/school-date"

const date = (value: unknown) => {
  const parsed = parseSchoolDate(value)
  assert.ok(parsed)
  return parsed
}

test("school date parser accepts only real canonical Gregorian dates", () => {
  assert.equal(parseSchoolDate("2024-02-29"), "2024-02-29")
  assert.equal(parseSchoolDate("2000-02-29"), "2000-02-29")
  for (const value of [
    "2026-02-29",
    "1900-02-29",
    "2100-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "0000-01-01",
    "2026-8-01",
    " 2026-08-01",
    "2026-08-01T00:00:00.000Z",
    "",
    null,
    undefined,
    20260907,
  ]) assert.equal(parseSchoolDate(value), null)
})

test("Prisma DATE codec round-trips at UTC midnight", () => {
  const value = date("2026-09-07")
  const encoded = toPrismaDate(value)
  assert.equal(encoded.toISOString(), "2026-09-07T00:00:00.000Z")
  assert.equal(fromPrismaDate(encoded), value)
  assert.throws(() => fromPrismaDate(new Date("2026-09-07T01:00:00.000Z")))
  assert.throws(() => fromPrismaDate(new Date(Number.NaN)))
})

test("school today follows the explicitly selected IANA timezone", () => {
  const instant = new Date("2026-09-06T16:00:00.000Z")
  assert.equal(todayInSchoolTimeZone(instant, "Asia/Jakarta"), "2026-09-06")
  assert.equal(todayInSchoolTimeZone(instant, "Asia/Makassar"), "2026-09-07")
  assert.equal(todayInSchoolTimeZone(instant, "Asia/Jayapura"), "2026-09-07")
  assert.equal(todayInSchoolTimeZone(instant, "America/New_York"), "2026-09-06")
  assert.equal(isIanaTimeZone("Asia/Makassar"), true)
  assert.equal(isIanaTimeZone("UTC+8"), false)
})

test("school date arithmetic, comparison, range, week, and month are civil-date based", () => {
  assert.equal(addSchoolDays(date("2024-02-28"), 1), "2024-02-29")
  assert.equal(addSchoolDays(date("2026-12-31"), 1), "2027-01-01")
  assert.equal(compareSchoolDates(date("2026-09-07"), date("2026-09-08")), -1)
  assert.deepEqual(eachSchoolDate(date("2026-02-27"), date("2026-03-01")), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
  ])
  assert.equal(startOfSchoolWeek(date("2026-09-09")), "2026-09-07")
  assert.equal(schoolMonthOf(date("2026-09-07")), "2026-09")
})

test("Prisma DATE ranges use inclusive UTC-midnight DATE endpoints", () => {
  const range = prismaSchoolDateRange(date("2026-09-01"), date("2026-09-07"))
  assert.equal(range.gte.toISOString(), "2026-09-01T00:00:00.000Z")
  assert.equal(range.lte.toISOString(), "2026-09-07T00:00:00.000Z")
})

test("school date formatting is stable and timestamp boundaries are timezone explicit", () => {
  const value = date("2026-09-07")
  assert.equal(formatSchoolDate(value), "Senin, 7 September 2026")
  assert.equal(schoolDateAtStart(value, "Asia/Jakarta").toISOString(), "2026-09-06T17:00:00.000Z")
  assert.equal(schoolDateAtStart(value, "Asia/Makassar").toISOString(), "2026-09-06T16:00:00.000Z")
  assert.equal(schoolDateAtStart(value, "Asia/Jayapura").toISOString(), "2026-09-06T15:00:00.000Z")
  assert.equal(schoolDateAtStart(date("0001-01-01"), "UTC").toISOString(), "0001-01-01T00:00:00.000Z")
  const range = schoolTimestampRange(value, value, "Asia/Makassar")
  assert.equal(range.gte.toISOString(), "2026-09-06T16:00:00.000Z")
  assert.equal(range.lt.toISOString(), "2026-09-07T16:00:00.000Z")
  assert.equal(formatSchoolTime(new Date("2026-09-06T23:30:00.000Z"), "Asia/Makassar"), "07:30")
  assert.equal(schoolDateFromInstant(new Date("2026-09-06T16:00:00.000Z"), "Asia/Makassar"), value)
})

test("school date behavior is identical across host timezones", () => {
  const moduleUrl = new URL("../lib/school-date.ts", import.meta.url).href
  const script = `
    import { parseSchoolDate, toPrismaDate, fromPrismaDate, formatSchoolDate, addSchoolDays, todayInSchoolTimeZone, schoolDateAtStart } from ${JSON.stringify(moduleUrl)};
    const value = parseSchoolDate("2026-09-07");
    console.log(JSON.stringify({
      encoded: toPrismaDate(value).toISOString(),
      decoded: fromPrismaDate(toPrismaDate(value)),
      formatted: formatSchoolDate(value),
      next: addSchoolDays(value, 1),
      today: todayInSchoolTimeZone(new Date("2026-09-06T16:00:00.000Z"), "Asia/Makassar"),
      start: schoolDateAtStart(value, "Asia/Makassar").toISOString(),
    }));
  `
  const outputs = ["UTC", "Asia/Jakarta", "America/New_York", "Pacific/Kiritimati"].map((tz) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: tz },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  })
  assert.equal(new Set(outputs).size, 1)
})
