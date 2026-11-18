import ExcelJS from "exceljs"
import { matrixStatusLabel } from "@/lib/class-recap-period"
import { formatSchoolTime, toPrismaDate } from "@/lib/school-date"
import type { readWorshipExport } from "@/lib/server-worship-export"
import { WORSHIP_STATUS_LABELS } from "@/lib/worship-attendance"

type ExportData = Awaited<ReturnType<typeof readWorshipExport>>

function addReportSheet(
  workbook: ExcelJS.Workbook, name: string, data: ExportData, columns: [string, number][],
) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] })
  sheet.mergeCells(1, 1, 1, columns.length)
  sheet.getCell("A1").value = `Rekap Ibadah Zuhur · Kelas ${data.className}`
  sheet.getCell("A1").font = { bold: true, size: 15 }
  sheet.mergeCells(2, 1, 2, columns.length)
  sheet.getCell("A2").value = `${data.from} s.d. ${data.to}`
  const header = sheet.getRow(4)
  header.values = columns.map(([label]) => label)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
  columns.forEach(([, width], index) => { sheet.getColumn(index + 1).width = width })
  return sheet
}

export async function worshipWorkbook(data: ExportData, timeZone: string) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SISMEPDA"
  const summary = addReportSheet(workbook, "Ringkasan", data, [
    ["NIS", 16], ["Nama Siswa", 34], ["Jumlah Ikut", 17], ["Jumlah Dispensasi", 23],
  ])
  for (const row of data.summary) summary.addRow([row.nis ?? "", row.name, row.attended, row.excused])
  summary.autoFilter = `A4:D${summary.rowCount}`

  const details = addReportSheet(workbook, "Rincian Harian", data, [
    ["Tanggal", 15], ["NIS", 16], ["Nama Siswa", 34], ["Absensi Sekolah", 19],
    ["Ibadah Zuhur", 23], ["Jam Scan Pertama", 23], ["Sumber", 14],
  ])
  details.mergeCells("A3:G3")
  details.getCell("A3").value = data.details.length
    ? "Tanggal dengan data absensi sekolah atau catatan ibadah."
    : "Belum ada data absensi sekolah atau catatan ibadah pada periode ini."
  details.getColumn(1).numFmt = "yyyy-mm-dd"
  for (const row of data.details) {
    const scan = row.worship?.firstScannedAt
    details.addRow([
      toPrismaDate(row.day), row.student.nis ?? "", row.student.name,
      row.school ? matrixStatusLabel(row.school) : "Belum diisi",
      WORSHIP_STATUS_LABELS[row.worship?.status ?? "BELUM"],
      scan ? formatSchoolTime(scan, timeZone) : "",
      row.worship?.manualByName ? "Manual" : scan ? "Scan" : "",
    ])
  }
  details.autoFilter = `A4:G${details.rowCount}`
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
