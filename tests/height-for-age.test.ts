import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  HEIGHT_REFERENCE_MAX_MONTHS,
  HEIGHT_REFERENCE_MIN_MONTHS,
  SD_LINES,
  heightReferenceCurves,
  heightZScore,
} from "../lib/height-for-age"
import whoHeight from "./fixtures/who-height-for-age.json" with { type: "json" }

const GENDERS = ["LAKI_LAKI", "PEREMPUAN"] as const

/**
 * Fixture berisi kolom SD terhitung dari berkas WHO — pembanding independen
 * terhadap L/M/S yang kita simpan. Kalau dataset rusak atau tergeser, test ini
 * gagal alih-alih diam-diam menggeser pita pada grafik siswa.
 */
for (const gender of GENDERS) {
  test(`kurva rujukan mereproduksi tabel SD WHO (${gender})`, () => {
    const table: Record<string, number[]> = whoHeight[gender]
    const months = Object.keys(table)
    assert.equal(months.length, 168, "harus 168 bulan (5-19 tahun)")

    const curves = heightReferenceCurves(gender, HEIGHT_REFERENCE_MIN_MONTHS, HEIGHT_REFERENCE_MAX_MONTHS)
    assert.equal(curves.length, 168)

    let worst = 0
    for (const point of curves) {
      const expected = table[String(point.ageMonths)]
      assert.ok(expected, `bulan ${point.ageMonths} tidak ada di fixture`)
      assert.equal(point.values.length, SD_LINES.length)
      point.values.forEach((value, index) => {
        const drift = Math.abs(value - expected[index])
        worst = Math.max(worst, drift)
        assert.ok(
          drift < 0.01,
          `${gender} bulan ${point.ageMonths} pada ${SD_LINES[index]}SD: ${value} vs ${expected[index]}`,
        )
      })
    }
    // Fixture dibulatkan ke 0,001 cm, jadi selisih wajar hanya sebesar itu.
    assert.ok(worst < 0.01, `selisih terburuk ${worst} cm`)
  })
}

test("z-score konsisten dengan pita yang digambar", () => {
  // Titik tepat di garis +1 SD harus menghasilkan z = +1; kalau tidak, grafik
  // dan penilaian memakai rumus yang berbeda.
  const curves = heightReferenceCurves("LAKI_LAKI", 144, 144)
  assert.equal(curves.length, 1)
  SD_LINES.forEach((z, index) => {
    const height = curves[0].values[index]
    const back = heightZScore(height, 144, "LAKI_LAKI")
    assert.ok(back !== null)
    assert.ok(Math.abs(back! - z) < 1e-6, `pada ${z}SD tinggi ${height} menghasilkan z=${back}`)
  })
})

test("median tinggi badan masuk akal untuk anak usia sekolah", () => {
  // Penjaga kewarasan: kalau berkas WHO tertukar dengan indikator lain
  // (mis. berat badan), angkanya akan jauh meleset dan test ini gagal.
  const [boys] = heightReferenceCurves("LAKI_LAKI", 61, 61)
  const median = boys.values[SD_LINES.indexOf(0)]
  assert.ok(median > 105 && median < 115, `median umur 5 tahun ${median} cm tidak masuk akal`)

  const [older] = heightReferenceCurves("LAKI_LAKI", 228, 228)
  assert.ok(older.values[SD_LINES.indexOf(0)] > 170, "median umur 19 tahun harus > 170 cm")
})

test("kurva laki-laki dan perempuan berbeda pada umur remaja", () => {
  const [l] = heightReferenceCurves("LAKI_LAKI", 204, 204)
  const [p] = heightReferenceCurves("PEREMPUAN", 204, 204)
  const mid = SD_LINES.indexOf(0)
  assert.ok(l.values[mid] > p.values[mid] + 5, "median laki-laki 17 tahun harus jauh di atas perempuan")
})

test("umur di luar rentang rujukan tidak diekstrapolasi", () => {
  assert.equal(heightZScore(140, 60, "LAKI_LAKI"), null)
  assert.equal(heightZScore(140, 229, "LAKI_LAKI"), null)
  assert.deepEqual(heightReferenceCurves("LAKI_LAKI", 12, 60), [])
})

test("rentang diminta lebih lebar dari tabel tetap dipotong, bukan diekstrapolasi", () => {
  const curves = heightReferenceCurves("PEREMPUAN", 0, 999)
  assert.equal(curves[0].ageMonths, HEIGHT_REFERENCE_MIN_MONTHS)
  assert.equal(curves[curves.length - 1].ageMonths, HEIGHT_REFERENCE_MAX_MONTHS)
})

test("rentang terbalik menghasilkan kurva kosong, bukan error", () => {
  assert.deepEqual(heightReferenceCurves("LAKI_LAKI", 200, 100), [])
})

test("tinggi badan tidak masuk akal ditolak", () => {
  assert.equal(heightZScore(0, 144, "LAKI_LAKI"), null)
  assert.equal(heightZScore(-150, 144, "LAKI_LAKI"), null)
  assert.equal(heightZScore(Number.NaN, 144, "LAKI_LAKI"), null)
})
