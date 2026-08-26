import { DEFAULT_CSV_DELIMITER, isValidCsvDelimiter, serializeDelimitedRows } from "@/lib/csv"

export const exportTypes = [
  "students",
  "teachers",
  "homerooms",
  "holidays",
  "attendance_students",
  "attendance_classes",
] as const

export type ExportType = (typeof exportTypes)[number]

export function isExportType(value: string | null): value is ExportType {
  return exportTypes.includes(value as ExportType)
}

export function exportDelimiter(value: string | null): string {
  return value && isValidCsvDelimiter(value) ? value : DEFAULT_CSV_DELIMITER
}

function safeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export function csvDownload(
  filename: string,
  rows: readonly (readonly unknown[])[],
  delimiter = DEFAULT_CSV_DELIMITER,
): Response {
  const content = serializeDelimitedRows(
    rows.map((row) => row.map(safeCsvCell)),
    delimiter,
  )

  return new Response(`\uFEFF${content}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
