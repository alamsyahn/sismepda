import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  formatMonthLabel,
  formatMonthShort,
  isPartialFinalMonth,
  monthlyVisitCounts,
  monthlyVisitStats,
  normalizeTerm,
  peakMonth,
  rankTerms,
  visitsBetween,
} from "../lib/euks-trends"
import type { SchoolDate, SchoolMonth } from "../lib/school-date"

const d = (value: string) => value as SchoolDate
const m = (value: string) => value as SchoolMonth

const visit = (occurredAt: string, complaint: string, treatment = "Istirahat") => ({
  occurredAt: d(occurredAt),
  complaint,
  treatment,
})

test("peringkat keluhan diurutkan menurun dengan porsi yang menjumlah 100 persen", () => {
  const rows = rankTerms(["Demam", "Batuk", "Demam", "Pusing", "Demam", "Batuk"], 10)

  assert.deepEqual(
    rows.map((row) => [row.label, row.count]),
    [
      ["Demam", 3],
      ["Batuk", 2],
      ["Pusing", 1],
    ],
  )
  const total = rows.reduce((sum, row) => sum + row.share, 0)
  assert.ok(Math.abs(total - 100) < 1e-9, `porsi menjumlah ${total}`)
})

test("pengelompokan mengabaikan huruf besar-kecil dan spasi berlebih", () => {
  const rows = rankTerms(["Sakit  Kepala", "sakit kepala", "SAKIT KEPALA "], 10)

  assert.equal(rows.length, 1, "ketiganya harus menjadi satu kelompok")
  assert.equal(rows[0].count, 3)
  assert.equal(rows[0].share, 100)
})

test("label memakai ejaan yang paling sering dipakai operator", () => {
  const rows = rankTerms(["sakit kepala", "Sakit Kepala", "Sakit Kepala"], 10)
  assert.equal(rows[0].label, "Sakit Kepala")
})

test("istilah berbeda tidak disatukan diam-diam", () => {
  // Menyamakan "ISPA" dengan "batuk pilek" adalah keputusan medis, bukan
  // keputusan aplikasi presensi.
  const rows = rankTerms(["ISPA", "Batuk Pilek", "ISPA"], 10)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.label), ["ISPA", "Batuk Pilek"])
})

test("sisa peringkat digabung ke Lainnya dan porsi tetap menjumlah 100 persen", () => {
  const values = ["A", "A", "A", "B", "B", "C", "D", "E"]
  const rows = rankTerms(values, 2)

  assert.deepEqual(
    rows.map((row) => [row.label, row.count]),
    [
      ["A", 3],
      ["B", 2],
      ["Lainnya", 3],
    ],
  )
  const total = rows.reduce((sum, row) => sum + row.share, 0)
  assert.ok(Math.abs(total - 100) < 1e-9)
})

test("Lainnya tidak muncul bila seluruh kelompok sudah masuk peringkat", () => {
  const rows = rankTerms(["A", "B"], 5)
  assert.equal(rows.some((row) => row.label === "Lainnya"), false)
})

test("entri kosong diabaikan, bukan dihitung sebagai kelompok", () => {
  const rows = rankTerms(["Demam", "", "   ", "Demam"], 10)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 2)
  assert.equal(rows[0].share, 100)
  assert.deepEqual(rankTerms([], 10), [])
  assert.deepEqual(rankTerms(["", "  "], 10), [])
})

test("urutan stabil ketika jumlahnya imbang", () => {
  const first = rankTerms(["Beta", "Alfa"], 10).map((row) => row.label)
  const second = rankTerms(["Alfa", "Beta"], 10).map((row) => row.label)
  assert.deepEqual(first, second, "data sama harus menghasilkan urutan sama")
  assert.deepEqual(first, ["Alfa", "Beta"])
})

test("bulan tanpa kunjungan tetap muncul sebagai nol", () => {
  const series = monthlyVisitCounts([
    visit("2026-01-10", "Demam"),
    visit("2026-01-20", "Batuk"),
    // Februari sengaja kosong.
    visit("2026-03-05", "Demam"),
  ])

  assert.deepEqual(series, [
    { month: m("2026-01"), count: 2 },
    { month: m("2026-02"), count: 0 },
    { month: m("2026-03"), count: 1 },
  ])
})

test("rentang bulan menyeberang tahun", () => {
  const series = monthlyVisitCounts([visit("2025-11-10", "Demam"), visit("2026-02-10", "Demam")])
  assert.deepEqual(
    series.map((point) => point.month),
    ["2025-11", "2025-12", "2026-01", "2026-02"],
  )
})

test("tanpa kunjungan tidak ada seri bulanan", () => {
  assert.deepEqual(monthlyVisitCounts([]), [])
})

test("penyaringan rentang tanggal mengikutkan batas", () => {
  const visits = [
    visit("2026-01-01", "A"),
    visit("2026-01-15", "B"),
    visit("2026-01-31", "C"),
    visit("2026-02-01", "D"),
  ]
  const inRange = visitsBetween(visits, d("2026-01-01"), d("2026-01-31"))
  assert.deepEqual(inRange.map((item) => item.complaint), ["A", "B", "C"])
})

test("seri bulanan untuk grafik memakai angka kunjungan yang sama persis", () => {
  const visits = [
    { ...visit("2026-01-10", "Demam"), studentId: "s1" },
    { ...visit("2026-01-20", "Batuk"), studentId: "s1" },
    // Februari sengaja kosong.
    { ...visit("2026-03-05", "Demam"), studentId: "s2" },
    { ...visit("2026-03-06", "Demam"), studentId: "s3" },
  ]

  const base = monthlyVisitCounts(visits)
  const stats = monthlyVisitStats(visits)

  // Redesign grafik tidak boleh mengubah angka apa pun.
  assert.deepEqual(
    stats.map((point) => ({ month: point.month, count: point.count })),
    base,
  )
  // Siswa berbeda dihitung per bulan: dua kunjungan siswa yang sama pada Januari
  // tetap satu siswa.
  assert.deepEqual(
    stats.map((point) => point.students),
    [1, 0, 2],
  )
})

test("bulan kosong tetap ada pada seri grafik dengan nol siswa", () => {
  const stats = monthlyVisitStats([
    { ...visit("2026-01-10", "Demam"), studentId: "s1" },
    { ...visit("2026-03-05", "Demam"), studentId: "s1" },
  ])
  assert.equal(stats.length, 3)
  assert.deepEqual(stats[1], { month: m("2026-02"), count: 0, students: 0 })
})

test("kunjungan tanpa studentId tidak menghasilkan jumlah siswa palsu", () => {
  const stats = monthlyVisitStats([visit("2026-01-10", "Demam")])
  assert.equal(stats[0].count, 1)
  assert.equal(stats[0].students, 0)
})

test("tanpa kunjungan tidak ada seri grafik", () => {
  assert.deepEqual(monthlyVisitStats([]), [])
})

test("bulan tertinggi memilih yang paling awal ketika jumlahnya imbang", () => {
  const peak = peakMonth([
    { month: m("2026-01"), count: 4 },
    { month: m("2026-02"), count: 9 },
    { month: m("2026-03"), count: 9 },
  ])
  assert.equal(peak?.month, "2026-02")
})

test("seluruh bulan nol tidak menghasilkan bulan tertinggi", () => {
  assert.equal(peakMonth([{ month: m("2026-01"), count: 0 }]), null)
  assert.equal(peakMonth([]), null)
})

test("bulan terakhir dianggap belum genap hanya bila tanggalnya belum akhir bulan", () => {
  assert.equal(isPartialFinalMonth(d("2026-09-13")), true)
  assert.equal(isPartialFinalMonth(d("2026-09-30")), false)
  assert.equal(isPartialFinalMonth(d("2026-01-31")), false)
  // Februari tahun kabisat: 29 hari, jadi tanggal 29 sudah genap.
  assert.equal(isPartialFinalMonth(d("2024-02-29")), false)
  assert.equal(isPartialFinalMonth(d("2026-02-28")), false)
})

test("normalizeTerm merapikan spasi dan huruf besar-kecil", () => {
  assert.equal(normalizeTerm("  Sakit   Kepala "), "sakit kepala")
})

test("label bulan memakai nama bulan Indonesia", () => {
  assert.equal(formatMonthLabel(m("2026-05")), "Mei 2026")
  assert.equal(formatMonthLabel(m("2026-12")), "Des 2026")
  assert.equal(formatMonthShort(m("2026-01")), "Jan")
})
