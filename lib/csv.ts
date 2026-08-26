export const DEFAULT_CSV_DELIMITER = ","

export function isValidCsvDelimiter(delimiter: string): boolean {
  return delimiter.length === 1 && delimiter !== '"' && delimiter !== "\r" && delimiter !== "\n"
}

/**
 * Parse CSV-like text using a caller-selected, single-character delimiter.
 * Quoted fields, escaped quotes, and line breaks inside quoted fields are supported.
 */
export function parseDelimitedText(text: string, delimiter = DEFAULT_CSV_DELIMITER): string[][] {
  if (!isValidCsvDelimiter(delimiter)) {
    throw new Error("Delimiter CSV harus tepat satu karakter dan bukan tanda petik atau baris baru")
  }

  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  const pushRow = () => {
    row.push(field)
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row)
    row = []
    field = ""
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(field)
      field = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      pushRow()
    } else {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) pushRow()
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "")

  return rows
}

export function serializeDelimitedRows(rows: readonly (readonly string[])[], delimiter = DEFAULT_CSV_DELIMITER): string {
  if (!isValidCsvDelimiter(delimiter)) {
    throw new Error("Delimiter CSV harus tepat satu karakter dan bukan tanda petik atau baris baru")
  }

  return rows
    .map((row) => row.map((cell) => {
      const escaped = cell.replace(/"/g, '""')
      return cell.includes(delimiter) || /["\r\n]/.test(cell) ? `"${escaped}"` : escaped
    }).join(delimiter))
    .join("\r\n")
}

export function changeCsvDelimiter(text: string, delimiter: string): string {
  return serializeDelimitedRows(parseDelimitedText(text), delimiter)
}
