import { strict as assert } from "node:assert"
import { test } from "node:test"

import { parseBirthDate, parseCsv, parseGender, validateManual } from "../lib/student-input"

const classOptions = ["7A", "7B"]

function rowsOf(result: ReturnType<typeof parseCsv>) {
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error("unreachable")
  return result.rows
}

test("CSV lama tanpa kolom demografi tetap terbaca", () => {
  const rows = rowsOf(parseCsv("nis,nisn,nama_lengkap,kelas\n1234567,1234567890,Budi,7A\n", classOptions))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, "valid")
  assert.equal(rows[0].nama, "Budi")
  // Kolom tidak ada -> null, bukan baris bermasalah.
  assert.equal(rows[0].tanggalLahir, null)
  assert.equal(rows[0].jenisKelamin, null)
})

test("CSV dengan kolom demografi terbaca berdasarkan nama header", () => {
  const csv =
    "nis,nisn,nama_lengkap,kelas,tanggal_lahir,jenis_kelamin\n" +
    "1234567,1234567890,Budi,7A,2014-05-10,L\n"
  const rows = rowsOf(parseCsv(csv, classOptions))
  assert.equal(rows[0].status, "valid")
  assert.equal(rows[0].tanggalLahir, "2014-05-10")
  assert.equal(rows[0].jenisKelamin, "LAKI_LAKI")
})

test("urutan kolom opsional yang terbalik tetap terbaca", () => {
  const csv =
    "nis,nisn,nama_lengkap,kelas,jenis_kelamin,tanggal_lahir\n" +
    "1234567,1234567890,Budi,7A,P,2014-05-10\n"
  const rows = rowsOf(parseCsv(csv, classOptions))
  assert.equal(rows[0].jenisKelamin, "PEREMPUAN")
  assert.equal(rows[0].tanggalLahir, "2014-05-10")
})

test("jenis kelamin menerima variasi penulisan yang lazim", () => {
  assert.equal(parseGender("L"), "LAKI_LAKI")
  assert.equal(parseGender("laki-laki"), "LAKI_LAKI")
  assert.equal(parseGender("P"), "PEREMPUAN")
  assert.equal(parseGender("Perempuan"), "PEREMPUAN")
  assert.equal(parseGender(""), null)
  assert.equal(parseGender("X"), undefined)
})

test("tanggal lahir menerima YYYY-MM-DD dan DD/MM/YYYY", () => {
  assert.equal(parseBirthDate("2014-05-10"), "2014-05-10")
  assert.equal(parseBirthDate("10/05/2014"), "2014-05-10")
  // Tahun di belakang tidak ambigu, jadi DD-MM-YYYY juga diterima.
  assert.equal(parseBirthDate("10-05-2014"), "2014-05-10")
  // Tanggal yang tidak ada pada kalender ditolak, bukan digeser diam-diam.
  assert.equal(parseBirthDate("31-02-2014"), undefined)
  assert.equal(parseBirthDate(""), null)
  assert.equal(parseBirthDate("2014-13-40"), undefined)
})

test("baris dengan demografi tidak valid ditandai, bukan diam-diam dibuang", () => {
  const csv =
    "nis,nisn,nama_lengkap,kelas,tanggal_lahir,jenis_kelamin\n" +
    "1234567,1234567890,Budi,7A,31-02-2014,L\n" +
    "1234568,1234567891,Siti,7A,2014-05-10,X\n"
  const rows = rowsOf(parseCsv(csv, classOptions))
  assert.equal(rows[0].status, "tanggal_lahir_tidak_valid")
  assert.equal(rows[1].status, "jenis_kelamin_tidak_valid")
})

test("input manual menolak tanggal lahir di masa depan", () => {
  const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const errors = validateManual(
    { nis: "1234567", nisn: "1234567890", nama: "Budi", kelas: "7A", tanggalLahir: besok, jenisKelamin: "" },
    classOptions,
  )
  assert.ok(errors.tanggalLahir)
})

test("demografi kosong tetap valid — pengisian bertahap", () => {
  const errors = validateManual(
    { nis: "1234567", nisn: "1234567890", nama: "Budi", kelas: "7A", tanggalLahir: "", jenisKelamin: "" },
    classOptions,
  )
  assert.equal(errors.tanggalLahir, undefined)
  assert.equal(errors.jenisKelamin, undefined)
})
