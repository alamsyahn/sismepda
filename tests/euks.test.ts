import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  calculateBmi,
  canViewEuks,
  countVisitTerms,
  euksCapabilities,
  formatBmi,
  hasEuksPermission,
  latestMeasurement,
  normalizeVisitTerm,
  nutritionStatus,
  nutritionStatusLabel,
  toBmiSeries,
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

test("status gizi belum dapat ditentukan tanpa referensi IMT-menurut-umur", () => {
  assert.equal(nutritionStatus(), "unknown")
  assert.equal(nutritionStatusLabel(nutritionStatus()), "Belum dapat ditentukan")
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
