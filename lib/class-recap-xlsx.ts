import ExcelJS from "exceljs"
import type { readClassPeriodRecap } from "@/lib/server-class-recap"

type Success = Extract<Awaited<ReturnType<typeof readClassPeriodRecap>>, { ok: true }>["data"]
type Mode = "cumulative" | "matrix"

const fills: Record<string, string> = { A: "FECACA", S: "FEF3C7", I: "DBEAFE", D: "EDE9FE", "—": "FFFFFF", "·": "E5E7EB", L: "DCFCE7" }

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  row.height = 28
}

export async function classRecapWorkbook(data: Success, mode: Mode) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SISMEPDA"
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(mode === "matrix" ? "Matriks Tanggal" : "Rekap Kumulatif", { views: [{ state: "frozen", xSplit: mode === "matrix" ? 3 : 2, ySplit: 4 }] })
  const totalColumns = mode === "matrix" ? 4 + data.dates.length : 10
  sheet.mergeCells(1, 1, 1, totalColumns)
  sheet.getCell("A1").value = `REKAP KEHADIRAN KELAS ${data.schoolClass.name}`
  sheet.getCell("A1").font = { bold: true, size: 15 }
  sheet.getCell("A2").value = `Periode: ${data.from} s.d. ${data.to}`
  sheet.getCell("A3").value = `Wali kelas: ${data.schoolClass.homeroom} | Hari sekolah: ${data.schoolDayCount} | Sudah diinput: ${data.submittedDayCount}`

  if (mode === "cumulative") buildCumulative(sheet, data)
  else buildMatrix(sheet, data)
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: sheet.columnCount } }
  const output = await workbook.xlsx.writeBuffer()
  return Buffer.from(output)
}

function buildCumulative(sheet: ExcelJS.Worksheet, data: Success) {
  const headers = ["No", "NIS", "NISN", "Nama Siswa", "Hadir", "Sakit", "Izin", "Dispensasi", "Alfa", "Total Tidak Hadir"]
  styleHeader(sheet.addRow(headers))
  data.cumulativeRows.forEach((row, index) => sheet.addRow([index + 1, row.nis ?? "", row.nisn ?? "", row.name, row.counts.hadir, row.counts.sakit, row.counts.izin, row.counts.dispensasi, row.counts.alfa, row.totalAbsent]))
  const widths = [6, 14, 16, 30, 10, 10, 10, 14, 10, 18]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.getColumn(10).font = { bold: true }
  sheet.getColumn(4).alignment = { vertical: "middle" }
  for (let col = 5; col <= 10; col += 1) sheet.getColumn(col).alignment = { horizontal: "center" }
}

function buildMatrix(sheet: ExcelJS.Worksheet, data: Success) {
  const headers = ["No", "NIS", "Nama Siswa", ...data.dates.map((date) => `${String(date.day).padStart(2, "0")}\n${date.weekday}`), "Total"]
  styleHeader(sheet.addRow(headers))
  data.rows.forEach((row, index) => {
    const excelRow = sheet.addRow([index + 1, row.nis ?? "", row.name, ...row.codes, row.totalAbsent])
    row.codes.forEach((code, codeIndex) => {
      const cell = excelRow.getCell(4 + codeIndex)
      cell.alignment = { horizontal: "center", vertical: "middle" }
      cell.font = { bold: code !== "—" }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fills[code] ?? "FFFFFF"}` } }
      cell.note = `${data.dates[codeIndex].value}: ${row.statuses[codeIndex]}`
    })
  })
  sheet.getColumn(1).width = 6
  sheet.getColumn(2).width = 14
  sheet.getColumn(3).width = 30
  data.dates.forEach((_, index) => { sheet.getColumn(4 + index).width = 5 })
  sheet.getColumn(4 + data.dates.length).width = 9
  sheet.getColumn(4 + data.dates.length).font = { bold: true }
  sheet.getColumn(4 + data.dates.length).alignment = { horizontal: "center" }
  const legendRow = sheet.addRow([])
  legendRow.getCell(1).value = "Legenda"
  legendRow.getCell(3).value = "— Hadir | A Alfa | S Sakit | I Izin | D Dispensasi | · Belum input | L Libur"
  legendRow.font = { italic: true, color: { argb: "FF6B7280" } }
}

export function xlsxDownload(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "Cache-Control": "private, no-store",
  } })
}
