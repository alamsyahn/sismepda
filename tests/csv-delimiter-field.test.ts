import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { isValidCsvDelimiter } from "../lib/csv"

const source = readFileSync(new URL("../components/csv-delimiter-field.tsx", import.meta.url), "utf8")

/**
 * Regresi: `<SelectItem value="\t">` di JSX BUKAN karakter tab — atribut JSX
 * tidak memproses escape, sehingga yang terkirim adalah dua karakter `\` + `t`.
 * Delimiter itu gagal isValidCsvDelimiter() dan membuat parser melempar error,
 * jadi opsi Tab tidak dapat dipakai sama sekali. Nilai tab harus datang dari
 * string literal TypeScript (ekspresi `{...}`), bukan atribut string JSX.
 */
test("opsi delimiter tidak memakai atribut string JSX untuk tab", () => {
  assert.ok(
    !/<SelectItem\s+value="\\t"/.test(source),
    'value="\\t" pada JSX menghasilkan backslash+t, bukan karakter tab'
  )
})

test("tab adalah delimiter yang sah, backslash+t tidak", () => {
  assert.equal(isValidCsvDelimiter("\t"), true)
  assert.equal(isValidCsvDelimiter("\\t"), false)
})

/**
 * Base UI merender value mentah bila SelectValue tidak diberi fungsi render,
 * sehingga trigger akan menampilkan "," alih-alih "Koma (,)".
 */
test("trigger memetakan value ke label", () => {
  assert.ok(
    !/<SelectValue\s*\/>/.test(source),
    "SelectValue tanpa fungsi render akan menampilkan value mentah"
  )
  assert.ok(source.includes("DELIMITER_LABELS[selected]"))
})

test("daftar dan trigger memakai sumber label yang sama", () => {
  assert.equal(source.match(/DELIMITER_LABELS/g)?.length, 4)
})
