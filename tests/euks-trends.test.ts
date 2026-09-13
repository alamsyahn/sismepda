import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  formatMonthLabel,
  formatMonthShort,
  isPartialFinalMonth,
  monthlyVisitCounts,
  monthlyVisitStats,
  normalizeTerm,
  OTHER_TERMS_KEY,
  peakMonth,
  rankTerms,
  termGroupMembers,
  treatmentRankingByComplaint,
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

test("anggota kelompok keluhan mengikuti peringkat yang ditampilkan", () => {
  const values = ["Pusing", "Pusing", "Mual", "Batuk", "Pilek"]
  const members = termGroupMembers(values, 2)
  const rows = rankTerms(values, 2)

  // Setiap baris peringkat punya kelompok anggota, dan sebaliknya.
  assert.deepEqual([...members.keys()].sort(), rows.map((row) => row.key).sort())
  assert.deepEqual([...members.get("pusing")!], ["pusing"])
  // "Lainnya" bukan istilah literal: isinya seluruh kunci di luar peringkat.
  // Peringkat: pusing (2), lalu Batuk/Mual/Pilek (1) alfabetis — jadi dua
  // teratas adalah pusing dan batuk, sisanya masuk Lainnya.
  assert.deepEqual([...members.get(OTHER_TERMS_KEY)!].sort(), ["mual", "pilek"])
})

test("tanpa sisa di luar peringkat tidak ada kelompok Lainnya", () => {
  const members = termGroupMembers(["Pusing", "Mual"], 5)
  assert.equal(members.has(OTHER_TERMS_KEY), false)
  assert.deepEqual([...members.keys()].sort(), ["mual", "pusing"])
})

test("peringkat tindakan per keluhan hanya memakai kunjungan keluhan itu", () => {
  const visits = [
    { ...visit("2026-01-01", "Pusing"), treatment: "Istirahat di UKS" },
    { ...visit("2026-01-02", "Pusing"), treatment: "Istirahat di UKS" },
    { ...visit("2026-01-03", "Pusing"), treatment: "Diberi air hangat" },
    { ...visit("2026-01-04", "Mual"), treatment: "Diberi air hangat" },
  ]

  const byComplaint = treatmentRankingByComplaint(visits, 10)

  assert.deepEqual(
    byComplaint["pusing"].map((row) => [row.label, row.count]),
    [
      ["Istirahat di UKS", 2],
      ["Diberi air hangat", 1],
    ],
  )
  // Denominator mengikuti himpunan bagian, bukan total global: 2 dari 3.
  assert.equal(Math.round(byComplaint["pusing"][0].share), 67)
  assert.deepEqual(
    byComplaint["mual"].map((row) => [row.label, row.count]),
    [["Diberi air hangat", 1]],
  )
})

test("penyaringan memakai istilah ternormalisasi, bukan substring mentah", () => {
  const visits = [
    { ...visit("2026-01-01", "  PUSING  "), treatment: "Istirahat" },
    // Substring "pusing" ada di dalamnya, tetapi ini istilah yang berbeda.
    { ...visit("2026-01-02", "Pusing berat"), treatment: "Dirujuk" },
  ]

  const byComplaint = treatmentRankingByComplaint(visits, 10)

  assert.deepEqual(byComplaint["pusing"].map((row) => row.label), ["Istirahat"])
  assert.deepEqual(byComplaint["pusing berat"].map((row) => row.label), ["Dirujuk"])
})

test("peringkat tindakan Lainnya menggabungkan seluruh keluhan di luar peringkat", () => {
  const visits = [
    { ...visit("2026-01-01", "Pusing"), treatment: "Istirahat" },
    { ...visit("2026-01-02", "Pusing"), treatment: "Istirahat" },
    { ...visit("2026-01-03", "Batuk"), treatment: "Diberi air hangat" },
    { ...visit("2026-01-04", "Pilek"), treatment: "Diberi air hangat" },
  ]

  const byComplaint = treatmentRankingByComplaint(visits, 1)

  assert.deepEqual(
    byComplaint[OTHER_TERMS_KEY].map((row) => [row.label, row.count]),
    [["Diberi air hangat", 2]],
  )
})

test("keluhan tanpa tindakan tercatat menghasilkan peringkat kosong", () => {
  const visits = [
    { ...visit("2026-01-01", "Pusing"), treatment: "   " },
    { ...visit("2026-01-02", "Mual"), treatment: "Istirahat" },
  ]

  const byComplaint = treatmentRankingByComplaint(visits, 10)
  // Kosong, bukan lollipop rusak — komponen menampilkan empty state.
  assert.deepEqual(byComplaint["pusing"], [])
  assert.equal(byComplaint["mual"].length, 1)
})

test("kunjungan dengan beberapa keluhan masuk ke setiap kelompok relevan", () => {
  // Skema sekarang menyimpan satu istilah keluhan per kunjungan. Uji ini
  // mengunci bahwa keanggotaan diuji per kelompok, bukan eksklusif, sehingga
  // dua kunjungan berbeda keluhan tidak saling mengambil tindakan.
  const visits = [
    { ...visit("2026-01-01", "Pusing"), treatment: "Istirahat" },
    { ...visit("2026-01-01", "Mual"), treatment: "Diberi air hangat" },
  ]
  const byComplaint = treatmentRankingByComplaint(visits, 10)
  assert.deepEqual(byComplaint["pusing"].map((row) => row.label), ["Istirahat"])
  assert.deepEqual(byComplaint["mual"].map((row) => row.label), ["Diberi air hangat"])
})

test("peringkat global tidak berubah oleh pra-agregasi per keluhan", () => {
  const visits = [
    { ...visit("2026-01-01", "Pusing"), treatment: "Istirahat" },
    { ...visit("2026-01-02", "Mual"), treatment: "Istirahat" },
    { ...visit("2026-01-03", "Mual"), treatment: "Diberi air hangat" },
  ]
  const before = rankTerms(visits.map((v) => v.treatment), 10)
  treatmentRankingByComplaint(visits, 10)
  assert.deepEqual(rankTerms(visits.map((v) => v.treatment), 10), before)
  assert.deepEqual(before.map((row) => [row.label, row.count]), [
    ["Istirahat", 2],
    ["Diberi air hangat", 1],
  ])
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
