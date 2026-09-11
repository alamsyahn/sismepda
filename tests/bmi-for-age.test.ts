import { strict as assert } from "node:assert"
import { test } from "node:test"

import { bmiZScore, categorizeZScore } from "../lib/bmi-for-age"
import permenkes from "./fixtures/permenkes-imt-u.json" with { type: "json" }

/**
 * Fixture ini diekstrak langsung dari Tabel 15 & 16 PDF Permenkes No. 2/2020.
 * Setiap baris berisi nilai IMT pada -3, -2, -1, 0, +1, +2, +3 SD.
 *
 * Test ini membuktikan implementasi LMS kita mereproduksi tabel resmi — bukan
 * sekadar mencocokkan beberapa titik pilihan.
 */
const Z_COLUMNS = [-3, -2, -1, 0, 1, 2, 3]

/** Kebalikan dari z-score: nilai IMT pada suatu z, memakai L/M/S yang sama. */
function bmiAtZ(bmi: number, ageMonths: number, gender: "LAKI_LAKI" | "PEREMPUAN", targetZ: number) {
  // Cari IMT yang menghasilkan targetZ, lewat bisection — cukup untuk uji.
  let lo = 5
  let hi = 60
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    const z = bmiZScore(mid, ageMonths, gender)
    if (z === null) return null
    if (z < targetZ) lo = mid
    else hi = mid
  }
  void bmi
  return (lo + hi) / 2
}

for (const gender of ["LAKI_LAKI", "PEREMPUAN"] as const) {
  test(`z-score mereproduksi seluruh tabel Permenkes IMT/U (${gender})`, () => {
    const table = permenkes[gender] as Record<string, number[]>
    const months = Object.keys(table)
    assert.ok(months.length >= 168, `tabel ${gender} tidak lengkap: ${months.length} baris`)

    // Dibandingkan dalam satuan IMT, bukan z: tabel Permenkes dibulatkan ke
    // 0,1 IMT, sehingga toleransi yang sahih adalah setengah satuan itu.
    let worst = 0
    for (const month of months) {
      const ageMonths = Number(month)
      table[month].forEach((expected, index) => {
        const calculated = bmiAtZ(expected, ageMonths, gender, Z_COLUMNS[index])
        assert.ok(calculated !== null, `null pada ${gender} bulan ${month}`)
        const drift = Math.abs(calculated! - expected)
        worst = Math.max(worst, drift)
        assert.ok(
          drift <= 0.051,
          `${gender} bulan ${month} pada ${Z_COLUMNS[index]}SD: dihitung ${calculated}, tabel ${expected}`,
        )
      })
    }
    // Setengah satuan pembulatan tabel (0,05) — bukan toleransi yang dilonggarkan
    // sampai test-nya lulus.
    assert.ok(worst <= 0.051, `selisih terburuk ${worst}`)
  })

  test(`kategori pada nilai batas tabel sesuai Permenkes (${gender})`, () => {
    const table = permenkes[gender] as Record<string, number[]>
    // 12 tahun 0 bulan — usia yang lazim di jenjang ini.
    const row = table["144"]
    assert.ok(row, "baris 144 bulan harus ada")
    const [sd3neg, sd2neg, , median, sd1, sd2] = row

    const at = (bmi: number) => categorizeZScore(bmiZScore(bmi, 144, gender)!)

    assert.equal(at(sd3neg - 0.5), "gizi_buruk")
    assert.equal(at(sd2neg - 0.2), "gizi_kurang")
    assert.equal(at(median), "gizi_baik")
    assert.equal(at(sd1 + 0.2), "gizi_lebih")
    assert.equal(at(sd2 + 0.5), "obesitas")
  })
}

test("ambang kategori tepat di titik potong mengikuti Permenkes", () => {
  // -2 SD masuk "gizi baik" (batasnya -2 SD s.d. +1 SD), bukan "gizi kurang".
  assert.equal(categorizeZScore(-2), "gizi_baik")
  assert.equal(categorizeZScore(-2.0001), "gizi_kurang")
  // -3 SD masuk "gizi kurang"; di bawahnya baru "gizi buruk".
  assert.equal(categorizeZScore(-3), "gizi_kurang")
  assert.equal(categorizeZScore(-3.0001), "gizi_buruk")
  // +1 SD masih "gizi baik"; di atasnya "gizi lebih".
  assert.equal(categorizeZScore(1), "gizi_baik")
  assert.equal(categorizeZScore(1.0001), "gizi_lebih")
  // +2 SD masih "gizi lebih"; di atasnya "obesitas".
  assert.equal(categorizeZScore(2), "gizi_lebih")
  assert.equal(categorizeZScore(2.0001), "obesitas")
})

test("umur di luar rentang rujukan tidak diekstrapolasi", () => {
  // Tabel hanya 61-228 bulan (5-19 tahun).
  assert.equal(bmiZScore(18, 60, "LAKI_LAKI"), null)
  assert.equal(bmiZScore(18, 229, "PEREMPUAN"), null)
  assert.ok(bmiZScore(18, 61, "LAKI_LAKI") !== null)
  assert.ok(bmiZScore(18, 228, "PEREMPUAN") !== null)
})

test("IMT tidak masuk akal ditolak", () => {
  assert.equal(bmiZScore(0, 144, "LAKI_LAKI"), null)
  assert.equal(bmiZScore(-5, 144, "LAKI_LAKI"), null)
  assert.equal(bmiZScore(Number.NaN, 144, "LAKI_LAKI"), null)
})

test("kurva laki-laki dan perempuan berbeda", () => {
  // Kalau sama, berarti salah satu tabel tertimpa saat pembuatan dataset.
  const l = bmiZScore(19, 168, "LAKI_LAKI")!
  const p = bmiZScore(19, 168, "PEREMPUAN")!
  assert.notEqual(l.toFixed(3), p.toFixed(3))
})
