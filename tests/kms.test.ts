import { strict as assert } from "node:assert"
import { test } from "node:test"

import type { HeightPoint } from "../lib/euks"
import { heightZScore } from "../lib/height-for-age"
import {
  KMS_FALLBACK_GENDER,
  formatAgeMonths,
  kmsReferenceLabel,
  resolveKmsReference,
  sdBandOf,
  toKmsPoints,
} from "../lib/kms"

function point(id: string, ageMonths: number, heightCm: number): HeightPoint {
  return { id, measuredAt: "2026-03-10", ageMonths, heightCm }
}

test("jenis kelamin siswa dipakai apa adanya dan bukan fallback", () => {
  const reference = resolveKmsReference("PEREMPUAN")
  assert.equal(reference.gender, "PEREMPUAN")
  assert.equal(reference.isFallback, false)
})

test("pilihan manual tidak dapat menimpa jenis kelamin siswa yang sudah terisi", () => {
  // Kalau ini longgar, grafik siswa laki-laki bisa diam-diam memakai kurva
  // perempuan hanya karena state klien.
  const reference = resolveKmsReference("LAKI_LAKI", "PEREMPUAN")
  assert.equal(reference.gender, "LAKI_LAKI")
  assert.equal(reference.isFallback, false)
})

test("jenis kelamin kosong memakai fallback dan menandainya", () => {
  const reference = resolveKmsReference(null)
  assert.equal(reference.gender, KMS_FALLBACK_GENDER)
  assert.equal(reference.isFallback, true)
})

test("saat kosong, pilihan manual menentukan kurva tetapi tetap ditandai fallback", () => {
  const reference = resolveKmsReference(null, "PEREMPUAN")
  assert.equal(reference.gender, "PEREMPUAN")
  assert.equal(reference.isFallback, true)
})

test("label rujukan menyebut indikator dan jenis kelamin", () => {
  assert.equal(
    kmsReferenceLabel(resolveKmsReference("PEREMPUAN")),
    "Tinggi badan menurut umur · WHO 5-19 tahun · Perempuan",
  )
  assert.equal(
    kmsReferenceLabel(resolveKmsReference(null)),
    "Tinggi badan menurut umur · WHO 5-19 tahun · Laki-laki",
  )
})

test("z-score titik benar-benar berubah mengikuti jenis kelamin", () => {
  // Bukan sekadar label: satu tinggi yang sama harus dinilai berbeda oleh dua
  // tabel WHO yang berbeda.
  const points = [point("a", 150, 160)]
  const boys = toKmsPoints(points, "LAKI_LAKI")[0]
  const girls = toKmsPoints(points, "PEREMPUAN")[0]
  assert.ok(boys.zScore !== null && girls.zScore !== null)
  assert.notEqual(boys.zScore, girls.zScore)
})

test("z-score titik memakai sumber yang sama dengan pita rujukan", () => {
  const mapped = toKmsPoints([point("a", 150, 160)], "LAKI_LAKI")[0]
  assert.equal(mapped.zScore, heightZScore(160, 150, "LAKI_LAKI"))
})

test("umur di luar tabel rujukan tidak diekstrapolasi", () => {
  const mapped = toKmsPoints([point("a", 24, 86)], "LAKI_LAKI")[0]
  assert.equal(mapped.zScore, null)
  assert.equal(mapped.band, null)
  assert.equal(mapped.description, null)
})

test("pita SD mengikuti garis yang digambar pada grafik", () => {
  assert.equal(sdBandOf(-3.5), "di bawah -3 SD")
  assert.equal(sdBandOf(-2.5), "-3 s.d. -2 SD")
  assert.equal(sdBandOf(0), "-2 s.d. +2 SD")
  assert.equal(sdBandOf(2), "-2 s.d. +2 SD")
  assert.equal(sdBandOf(2.5), "+2 s.d. +3 SD")
  assert.equal(sdBandOf(3.5), "di atas +3 SD")
})

test("riwayat kosong menghasilkan daftar kosong, bukan galat", () => {
  assert.deepEqual(toKmsPoints([], "LAKI_LAKI"), [])
})

test("satu titik tetap dipetakan lengkap", () => {
  const mapped = toKmsPoints([point("a", 150, 160)], "LAKI_LAKI")
  assert.equal(mapped.length, 1)
  assert.equal(mapped[0].ageLabel, "12 tahun 6 bulan")
  assert.ok(mapped[0].description)
})

test("tinggi tidak masuk akal tidak membuat z-score palsu", () => {
  const mapped = toKmsPoints([point("a", 150, 0)], "LAKI_LAKI")[0]
  assert.equal(mapped.zScore, null)
  assert.equal(mapped.band, null)
})

test("umur ditampilkan dalam tahun dan bulan", () => {
  assert.equal(formatAgeMonths(156), "13 tahun")
  assert.equal(formatAgeMonths(160), "13 tahun 4 bulan")
})
