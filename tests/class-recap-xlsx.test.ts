import assert from "node:assert/strict"
import test from "node:test"
import ExcelJS from "exceljs"
import { classRecapWorkbook } from "../lib/class-recap-xlsx"

const counts = { hadir: 1, sakit: 0, izin: 0, dispensasi: 0, alfa: 0 }
const rows = [
  { id: "1", nis: "101", nisn: null, name: "Ahmad", statuses: ["HADIR" as const], codes: ["—" as const], counts, totalAbsent: 0 },
  { id: "2", nis: "102", nisn: null, name: "Siti", statuses: ["SAKIT" as const], codes: ["S" as const], counts: { ...counts, hadir: 0, sakit: 1 }, totalAbsent: 1 },
]
const data = {
  schoolClass: { id: "class-ix-a", name: "IX A", grade: "IX", homeroom: "Ibu Guru" },
  from: "2026-08-01",
  to: "2026-08-01",
  dates: [{ value: "2026-08-01", day: 1, weekday: "Sab", holiday: null, submitted: true }],
  rows,
  cumulativeRows: [rows[1], rows[0]],
  schoolDayCount: 1,
  submittedDayCount: 1,
}

test("exports every student regardless of the UI absence checkbox", async () => {
  for (const mode of ["cumulative", "matrix"] as const) {
    const buffer = await classRecapWorkbook(data, mode)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.worksheets[0]
    const values = Array.from({ length: sheet.rowCount }, (_, index) => {
      const row = sheet.getRow(index + 1).values
      return Array.isArray(row) ? row.map(String).join(" ") : String(row)
    })
    assert.equal(values.some((value) => value.includes("Ahmad")), true)
    assert.equal(values.some((value) => value.includes("Siti")), true)
  }
})
