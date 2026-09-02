import assert from "node:assert/strict"
import test from "node:test"

import {
  attendanceDistributionTotal,
  computeSummary,
  sharePercentage,
  type ClassRecord,
} from "../lib/dashboard-data"

function classRecord(overrides: Partial<ClassRecord> & Pick<ClassRecord, "id">): ClassRecord {
  return {
    name: "VII A",
    grade: "VII",
    homeroom: "Guru",
    homeroomId: null,
    totalStudents: 0,
    hadir: 0,
    sakit: 0,
    izin: 0,
    alfa: 0,
    dispensasi: 0,
    submitted: false,
    submittedAt: null,
    onTime: null,
    previousHadir: 0,
    previousTotal: 0,
    ...overrides,
  }
}

/** Persentase Hadir seperti yang dihitung donut/legend dari segmennya sendiri. */
function chartHadirPercentage(summary: ReturnType<typeof computeSummary>): number {
  const segments = [
    summary.totalHadir,
    summary.totalSakit,
    summary.totalIzin,
    summary.totalDispensasi,
    summary.totalAlfa,
  ]
  return sharePercentage(summary.totalHadir, segments.reduce((sum, value) => sum + value, 0))
}

test("sharePercentage memakai nilai mentah dan hanya membulatkan di akhir", () => {
  assert.equal(sharePercentage(409, 434), 94)
  assert.equal(sharePercentage(1, 3), 33)
  assert.equal(sharePercentage(2, 3), 67)
})

test("sharePercentage aman untuk total 0 dan input tidak valid", () => {
  assert.equal(sharePercentage(0, 0), 0)
  assert.equal(sharePercentage(5, 0), 0)
  assert.equal(sharePercentage(5, -1), 0)
  assert.equal(sharePercentage(Number.NaN, 10), 0)
  assert.ok(Number.isFinite(sharePercentage(5, 0)))
})

test("denominator distribusi = jumlah seluruh status yang tercatat", () => {
  assert.equal(
    attendanceDistributionTotal({
      totalHadir: 409,
      totalSakit: 13,
      totalIzin: 2,
      totalAlfa: 3,
      totalDispensasi: 7,
    }),
    434,
  )
})

test("data normal: tingkat kehadiran memakai status tercatat", () => {
  const summary = computeSummary([
    classRecord({ id: "a", totalStudents: 30, hadir: 28, sakit: 2, submitted: true }),
    classRecord({ id: "b", totalStudents: 30, hadir: 25, izin: 5, submitted: true }),
  ])

  assert.equal(summary.totalRecorded, 60)
  assert.equal(summary.attendanceRate, 88)
  assert.equal(summary.attendanceRate, chartHadirPercentage(summary))
})

test("total 0 menghasilkan 0%, bukan NaN atau Infinity", () => {
  const summary = computeSummary([classRecord({ id: "a", totalStudents: 30 })])

  assert.equal(summary.totalRecorded, 0)
  assert.equal(summary.attendanceRate, 0)
  assert.ok(Number.isFinite(summary.attendanceRate))
  assert.equal(summary.attendanceRate, chartHadirPercentage(summary))
})

test("daftar kelas kosong tidak memicu pembagian nol", () => {
  const summary = computeSummary([])

  assert.equal(summary.totalRecorded, 0)
  assert.equal(summary.attendanceRate, 0)
  assert.equal(summary.completionRate, 0)
})

test("contoh nyata 409/13/2/7/3 menghasilkan 94%, bukan 101%", () => {
  // Kelas terakhir sengaja BELUM lengkap: inilah kondisi yang dulu membuat
  // pembilang (semua kelas) dan pembagi (hanya kelas submitted) tidak sebanding.
  const summary = computeSummary([
    classRecord({ id: "a", totalStudents: 405, hadir: 380, sakit: 13, izin: 2, dispensasi: 7, alfa: 3, submitted: true }),
    classRecord({ id: "b", totalStudents: 40, hadir: 29 }),
  ])

  assert.equal(summary.totalHadir, 409)
  assert.equal(summary.totalSakit, 13)
  assert.equal(summary.totalIzin, 2)
  assert.equal(summary.totalDispensasi, 7)
  assert.equal(summary.totalAlfa, 3)
  assert.equal(summary.totalRecorded, 434)
  assert.equal(summary.attendanceRate, 94)
  assert.equal(chartHadirPercentage(summary), 94)
})

test("persentase tengah tidak pernah berbeda dari persentase Hadir milik chart", () => {
  const scenarios: ClassRecord[][] = [
    [],
    [classRecord({ id: "a", totalStudents: 30 })],
    [classRecord({ id: "a", totalStudents: 30, hadir: 30, submitted: true })],
    [classRecord({ id: "a", totalStudents: 30, hadir: 3, sakit: 1 })],
    [
      classRecord({ id: "a", totalStudents: 405, hadir: 380, sakit: 13, izin: 2, dispensasi: 7, alfa: 3, submitted: true }),
      classRecord({ id: "b", totalStudents: 40, hadir: 29 }),
    ],
    [
      classRecord({ id: "a", totalStudents: 32, hadir: 30, alfa: 2, submitted: true }),
      classRecord({ id: "b", totalStudents: 31, hadir: 1 }),
      classRecord({ id: "c", totalStudents: 28 }),
    ],
  ]

  for (const records of scenarios) {
    const summary = computeSummary(records)
    assert.equal(summary.attendanceRate, chartHadirPercentage(summary))
    assert.ok(summary.attendanceRate >= 0 && summary.attendanceRate <= 100)
  }
})

test("kelas terisi sebagian tidak lagi membuat rasio melebihi 100%", () => {
  // Sebelum perbaikan: 100 / 30 = 333%. Sekarang dibandingkan dengan status tercatat.
  const summary = computeSummary([
    classRecord({ id: "a", totalStudents: 30, hadir: 30, submitted: true }),
    classRecord({ id: "b", totalStudents: 200, hadir: 70 }),
  ])

  assert.equal(summary.attendanceRate, 100)
  assert.equal(summary.attendanceRate, chartHadirPercentage(summary))
})
