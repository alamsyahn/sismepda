/**
 * Zona IMT/U pada Grafik IMT.
 *
 * Yang diuji adalah janji utama grafik: kategori tiap titik sama persis dengan
 * `nutritionStatus()`, ambang zona ikut berubah menurut umur dan jenis kelamin,
 * dan data yang kurang tidak membuat grafik hilang.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  BMI_SD_LINES,
  bmiThresholdsAt,
  categorizeZScore,
  bmiZScore,
} from "../lib/bmi-for-age"
import { nutritionStatus, type BmiPoint } from "../lib/euks"
import { bmiChartDomain, buildBmiChart } from "../lib/euks-bmi-chart"

const BIRTH_DATE = "2013-03-10"

function measurement(
  id: string,
  measuredAt: string,
  heightCm: number,
  weightKg: number,
): BmiPoint {
  return {
    id,
    measuredAt,
    heightCm,
    weightKg,
    bmi: weightKg / (heightCm / 100) ** 2,
    note: null,
  }
}

/** Berat yang membuat IMT jatuh persis pada z-score yang diminta. */
function weightForZ(z: number, heightCm: number, ageMonths: number, gender: "LAKI_LAKI" | "PEREMPUAN") {
  const thresholds = bmiThresholdsAt(ageMonths, gender)
  assert.ok(thresholds)
  // Interpolasi linear antar ambang tidak dipakai: cari IMT langsung lewat
  // pencarian biner pada z-score, sehingga nilai ujinya eksak.
  let low = 5
  let high = 60
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2
    const value = bmiZScore(mid, ageMonths, gender)
    assert.ok(value !== null)
    if (value < z) low = mid
    else high = mid
  }
  const bmi = (low + high) / 2
  return bmi * (heightCm / 100) ** 2
}

test("kategori tiap titik sama dengan nutritionStatus", () => {
  const points = [
    measurement("a", "2026-01-15", 150, 30),
    measurement("b", "2026-06-15", 152, 45),
    measurement("c", "2026-09-15", 154, 70),
  ]
  const model = buildBmiChart(points, BIRTH_DATE, "LAKI_LAKI")

  assert.equal(model.points.length, 3)
  for (const point of model.points) {
    const status = nutritionStatus({
      bmi: point.bmi,
      measuredAt: point.measuredAt,
      birthDate: BIRTH_DATE,
      gender: "LAKI_LAKI",
    })
    assert.equal(status.kind, "known")
    assert.equal(point.category, status.kind === "known" ? status.category : null)
    assert.equal(point.zScore, status.kind === "known" ? status.z : null)
  }
})

test("lima kategori Permenkes terwakili sesuai z-score", () => {
  const heightCm = 150
  const measuredAt = "2026-03-10" // tepat ulang tahun ke-13
  const ageMonths = 156
  const cases: Array<[number, string]> = [
    [-3.5, "gizi_buruk"],
    [-2.5, "gizi_kurang"],
    [0, "gizi_baik"],
    [1.5, "gizi_lebih"],
    [2.5, "obesitas"],
  ]

  for (const [z, expected] of cases) {
    const weightKg = weightForZ(z, heightCm, ageMonths, "LAKI_LAKI")
    const model = buildBmiChart(
      [measurement("x", measuredAt, heightCm, weightKg)],
      BIRTH_DATE,
      "LAKI_LAKI",
    )
    assert.equal(model.points[0].ageMonths, ageMonths)
    assert.equal(model.points[0].category, expected)
    assert.equal(categorizeZScore(model.points[0].zScore!), expected)
  }
})

test("ambang berbeda antara laki-laki dan perempuan", () => {
  const male = bmiThresholdsAt(156, "LAKI_LAKI")
  const female = bmiThresholdsAt(156, "PEREMPUAN")
  assert.ok(male && female)
  assert.equal(male.length, BMI_SD_LINES.length)
  assert.notDeepEqual(male, female)
})

test("ambang berubah ketika umur berubah", () => {
  const younger = bmiThresholdsAt(120, "PEREMPUAN")
  const older = bmiThresholdsAt(180, "PEREMPUAN")
  assert.ok(younger && older)
  for (let index = 0; index < BMI_SD_LINES.length; index += 1) {
    assert.ok(older[index] > younger[index])
  }
})

test("segmen zona mengikuti umur dalam bulan dan memakai ambang yang sama", () => {
  const model = buildBmiChart(
    [measurement("a", "2026-01-10", 150, 40), measurement("b", "2026-07-10", 152, 44)],
    BIRTH_DATE,
    "PEREMPUAN",
  )
  assert.ok(model.segments.length >= 6)
  assert.equal(model.zonesUnavailable, null)
  for (const segment of model.segments) {
    assert.deepEqual(segment.values, bmiThresholdsAt(segment.ageMonths, "PEREMPUAN"))
    assert.ok(segment.endDay >= segment.startDay)
  }
  // Ambang naik seiring umur, bukan konstan.
  assert.notEqual(model.segments[0].values[0], model.segments[model.segments.length - 1].values[0])
})

test("satu pengukuran tetap menghasilkan zona dengan lebar", () => {
  const model = buildBmiChart([measurement("a", "2026-05-20", 148, 38)], BIRTH_DATE, "LAKI_LAKI")
  assert.equal(model.points.length, 1)
  assert.ok(model.endDay > model.startDay)
  assert.ok(model.segments.length > 0)
  assert.ok(model.segments.some((segment) => segment.endDay > segment.startDay))
})

test("data tidak lengkap: titik tetap ada, zona dilaporkan tidak tersedia", () => {
  const points = [measurement("a", "2026-05-20", 148, 38)]

  const noBirth = buildBmiChart(points, null, "LAKI_LAKI")
  assert.equal(noBirth.points.length, 1)
  assert.equal(noBirth.segments.length, 0)
  assert.equal(noBirth.zonesUnavailable, "no_birth_date")
  assert.equal(noBirth.points[0].category, null)
  assert.equal(noBirth.points[0].zScore, null)

  const noGender = buildBmiChart(points, BIRTH_DATE, null)
  assert.equal(noGender.zonesUnavailable, "no_gender")

  const tooYoung = buildBmiChart(points, "2024-01-01", "LAKI_LAKI")
  assert.equal(tooYoung.points.length, 1)
  assert.equal(tooYoung.segments.length, 0)
  assert.equal(tooYoung.zonesUnavailable, "age_out_of_range")
})

test("pengukuran tanpa IMT dibuang, bukan membuat grafik gagal", () => {
  const broken: BmiPoint = {
    id: "z",
    measuredAt: "2026-05-20",
    heightCm: 0,
    weightKg: 40,
    bmi: null,
    note: null,
  }
  const model = buildBmiChart([broken, measurement("a", "2026-06-20", 150, 40)], BIRTH_DATE, "LAKI_LAKI")
  assert.equal(model.points.length, 1)
  assert.equal(model.points[0].id, "a")
})

test("domain Y memuat seluruh titik dan seluruh ambang, dengan ruang tambahan", () => {
  const model = buildBmiChart(
    [measurement("a", "2026-01-10", 150, 25), measurement("b", "2026-08-10", 151, 75)],
    BIRTH_DATE,
    "LAKI_LAKI",
  )
  const { min, max } = bmiChartDomain(model)
  const values = [
    ...model.points.map((point) => point.bmi),
    ...model.segments.flatMap((segment) => segment.values),
  ]
  assert.ok(min < Math.min(...values))
  assert.ok(max > Math.max(...values))
})
