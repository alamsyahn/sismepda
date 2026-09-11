import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  ageInMonths,
  ageInYears,
  calculateBmi,
  canViewEuks,
  countVisitTerms,
  euksCapabilities,
  formatBmi,
  formatZScore,
  hasEuksPermission,
  latestMeasurement,
  normalizeVisitTerm,
  nutritionStatus,
  nutritionStatusLabel,
  toBmiSeries,
  toHeightSeries,
  visitTermLabel,
} from "../lib/euks"

const admin = { role: "ADMIN" as const }
const guru = { role: "GURU" as const }

test("ADMIN selalu lolos setiap hak E-UKS", () => {
  assert.equal(hasEuksPermission(admin, "euks.view"), true)
  assert.equal(hasEuksPermission(admin, "euks.edit"), true)
})

test("GURU polos tidak memegang hak E-UKS apa pun", () => {
  assert.equal(hasEuksPermission(guru, "euks.view"), false)
  assert.equal(hasEuksPermission(guru, "euks.edit"), false)
  assert.equal(canViewEuks(guru), false)
})

test("hak kelola menyiratkan hak lihat", () => {
  const editor = { role: "GURU" as const, canEditEuks: true }
  assert.equal(hasEuksPermission(editor, "euks.view"), true)
  assert.equal(canViewEuks(editor), true)
})

test("hak lihat tidak menyiratkan hak kelola", () => {
  const viewer = { role: "GURU" as const, canViewEuks: true }
  assert.equal(hasEuksPermission(viewer, "euks.view"), true)
  assert.equal(hasEuksPermission(viewer, "euks.edit"), false)
})

test("capabilities merangkum kedua hak", () => {
  assert.deepEqual(euksCapabilities({ role: "GURU", canViewEuks: true }), {
    canView: true,
    canEdit: false,
  })
  assert.deepEqual(euksCapabilities(admin), { canView: true, canEdit: true })
})

test("normalisasi keluhan menyatukan variasi spasi dan kapital", () => {
  assert.equal(normalizeVisitTerm("  Pusing  "), "pusing")
  assert.equal(normalizeVisitTerm("Sakit   Perut"), "sakit perut")
  assert.equal(normalizeVisitTerm("PUSING"), "pusing")
})

test("label keluhan memakai kapital di awal", () => {
  assert.equal(visitTermLabel("  sakit   perut "), "Sakit perut")
  assert.equal(visitTermLabel("   "), "")
})

test("agregasi keluhan menghitung varian yang sama sebagai satu istilah", () => {
  const counts = countVisitTerms(["Pusing", "pusing", "  PUSING ", "Sakit perut"])
  assert.deepEqual(counts, [
    { term: "Pusing", count: 3 },
    { term: "Sakit perut", count: 1 },
  ])
})

test("agregasi mengabaikan nilai kosong", () => {
  assert.deepEqual(countVisitTerms(["", "   ", "Demam"]), [{ term: "Demam", count: 1 }])
  assert.deepEqual(countVisitTerms([]), [])
})

test("jumlah sama diurutkan alfabetis agar stabil", () => {
  assert.deepEqual(countVisitTerms(["Demam", "Batuk"]), [
    { term: "Batuk", count: 1 },
    { term: "Demam", count: 1 },
  ])
})


test("IMT dihitung dari tinggi dan berat, bukan disimpan", () => {
  const bmi = calculateBmi(170, 60)
  assert.ok(bmi !== null)
  assert.equal(Math.round((bmi as number) * 100) / 100, 20.76)
})

test("IMT null bila tinggi atau berat tidak masuk akal", () => {
  assert.equal(calculateBmi(0, 60), null)
  assert.equal(calculateBmi(170, 0), null)
  assert.equal(calculateBmi(-170, 60), null)
})

test("formatBmi menampilkan satu desimal dan strip untuk null", () => {
  assert.equal(formatBmi(20.76), "20.8")
  assert.equal(formatBmi(null), "-")
})

test("status gizi melaporkan data spesifik yang masih kurang", () => {
  const base = {
    bmi: 17.5,
    measuredAt: "2026-05-10",
    birthDate: "2014-05-10",
    gender: "LAKI_LAKI" as const,
  }

  assert.deepEqual(nutritionStatus({ ...base, bmi: null }), { kind: "unknown", reason: "no_measurement" })
  assert.deepEqual(nutritionStatus({ ...base, birthDate: null }), { kind: "unknown", reason: "no_birth_date" })
  assert.deepEqual(nutritionStatus({ ...base, gender: null }), { kind: "unknown", reason: "no_gender" })
  assert.equal(
    nutritionStatusLabel({ kind: "unknown", reason: "no_gender" }),
    "Jenis kelamin belum diisi",
  )
})

test("status gizi terklasifikasi ketika data lengkap", () => {
  // Laki-laki tepat 12 tahun (144 bulan); median tabel Permenkes = 17,5.
  const status = nutritionStatus({
    bmi: 17.5,
    measuredAt: "2026-05-10",
    birthDate: "2014-05-10",
    gender: "LAKI_LAKI",
  })
  assert.equal(status.kind, "known")
  if (status.kind !== "known") return
  assert.equal(status.category, "gizi_baik")
  assert.equal(status.ageMonths, 144)
  assert.ok(Math.abs(status.z) < 0.05, `z pada median seharusnya ~0, dapat ${status.z}`)
  assert.equal(nutritionStatusLabel(status), "Gizi baik")
})

test("jenis kelamin mengubah kategori pada IMT dan umur yang sama", () => {
  const input = { bmi: 25.5, measuredAt: "2026-05-10", birthDate: "2014-05-10" }
  const l = nutritionStatus({ ...input, gender: "LAKI_LAKI" })
  const p = nutritionStatus({ ...input, gender: "PEREMPUAN" })
  assert.equal(l.kind, "known")
  assert.equal(p.kind, "known")
  if (l.kind !== "known" || p.kind !== "known") return
  // Kurva perempuan lebih tinggi pada umur ini, sehingga z-nya lebih rendah.
  assert.ok(l.z > p.z, `harusnya z laki-laki > perempuan, dapat ${l.z} vs ${p.z}`)
})

test("umur di luar rentang rujukan tidak dipaksakan", () => {
  const status = nutritionStatus({
    bmi: 17.5,
    measuredAt: "2026-05-10",
    birthDate: "2022-05-10", // 4 tahun, di bawah tabel 5-19 tahun
    gender: "LAKI_LAKI",
  })
  assert.deepEqual(status, { kind: "unknown", reason: "age_out_of_range" })
})

test("toHeightSeries membuang pengukuran yang tidak dapat dipetakan", () => {
  const measurements = [
    { id: "b", measuredAt: "2026-05-10", heightCm: 150, weightKg: 39, note: null },
    { id: "a", measuredAt: "2025-05-10", heightCm: 145, weightKg: 36, note: null },
    // Tinggi badan tidak sahih: tidak boleh digambar.
    { id: "c", measuredAt: "2026-08-10", heightCm: 0, weightKg: 40, note: null },
  ]

  const series = toHeightSeries(measurements, "2014-05-10")
  assert.deepEqual(
    series.map((point) => point.id),
    ["a", "b"],
    "harus urut menaik menurut umur dan membuang tinggi tidak sahih",
  )
  assert.equal(series[0].ageMonths, 132)
  assert.equal(series[1].ageMonths, 144)

  // Tanpa tanggal lahir tidak ada sumbu umur, jadi tidak ada yang bisa digambar.
  assert.deepEqual(toHeightSeries(measurements, null), [])
})

test("format z-score memakai tanda dan koma Indonesia", () => {
  assert.equal(formatZScore(1.34), "+1,3 SD")
  assert.equal(formatZScore(-2.16), "-2,2 SD")
  assert.equal(formatZScore(0), "+0,0 SD")
  // Hanya untuk tampilan — kategori selalu dihitung dari z penuh, bukan teks ini.
  assert.equal(formatZScore(0.96), "+1,0 SD")
})

test("umur dihitung dalam bulan penuh pada tanggal pengukuran", () => {
  // Ulang tahun belum terlewati pada bulan pengukuran.
  assert.equal(ageInMonths("2014-05-10", "2026-05-09"), 143)
  // Tepat pada hari ulang tahun.
  assert.equal(ageInMonths("2014-05-10", "2026-05-10"), 144)
  assert.equal(ageInYears("2014-05-10", "2026-05-09"), 11)
  assert.equal(ageInYears("2014-05-10", "2026-05-10"), 12)
})

test("umur null bila pengukuran mendahului kelahiran atau tanggal tidak valid", () => {
  assert.equal(ageInMonths("2026-05-10", "2014-05-10"), null)
  assert.equal(ageInMonths("bukan-tanggal", "2026-05-10"), null)
})

test("toBmiSeries mengurutkan menaik dan menurunkan IMT tiap titik", () => {
  const series = toBmiSeries([
    { id: "b", measuredAt: "2026-03-01", heightCm: 170, weightKg: 60, note: null },
    { id: "a", measuredAt: "2026-01-01", heightCm: 165, weightKg: 55, note: null },
  ])
  assert.deepEqual(series.map((point) => point.id), ["a", "b"])
  assert.ok(series.every((point) => point.bmi !== null))
})

test("latestMeasurement memilih tanggal paling baru, bukan urutan array", () => {
  const latest = latestMeasurement([
    { id: "a", measuredAt: "2026-01-01", heightCm: 165, weightKg: 55, note: null },
    { id: "b", measuredAt: "2026-03-01", heightCm: 170, weightKg: 60, note: null },
    { id: "c", measuredAt: "2026-02-01", heightCm: 168, weightKg: 58, note: null },
  ])
  assert.equal(latest?.id, "b")
  assert.equal(latestMeasurement([]), null)
})
