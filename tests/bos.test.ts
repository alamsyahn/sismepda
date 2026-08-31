import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  bosCapabilities,
  canViewBos,
  categoryBreakdown,
  categorySlug,
  documentLabel,
  formatPercent,
  formatRupiah,
  formatRupiahCompact,
  hasBosPermission,
  normalizeCategoryName,
  normalizeDocumentUrl,
  summarizeBos,
} from "../lib/bos"

const admin = { role: "ADMIN" as const }
const guru = { role: "GURU" as const }

test("ADMIN selalu lolos setiap permission BOS", () => {
  for (const permission of [
    "bos.view",
    "bos.create",
    "bos.edit",
    "bos.manage_categories",
    "bos.manage_access",
  ] as const) {
    assert.equal(hasBosPermission(admin, permission), true)
  }
})

test("GURU tanpa hak sama sekali tidak bisa melihat BOS", () => {
  assert.equal(canViewBos(guru), false)
  assert.equal(hasBosPermission(guru, "bos.create"), false)
  assert.equal(hasBosPermission(guru, "bos.manage_access"), false)
})

test("hak selain view otomatis menyiratkan bos.view", () => {
  assert.equal(canViewBos({ role: "GURU", canCreateBos: true }), true)
  assert.equal(canViewBos({ role: "GURU", canEditBos: true }), true)
  assert.equal(canViewBos({ role: "GURU", canManageBosCategories: true }), true)
  assert.equal(canViewBos({ role: "GURU", canManageBosAccess: true }), true)
  // Tetapi view saja tidak memberi hak menulis.
  assert.equal(hasBosPermission({ role: "GURU", canViewBos: true }, "bos.edit"), false)
})

test("bosCapabilities memetakan seluruh hak viewer", () => {
  const caps = bosCapabilities({ role: "GURU", canViewBos: true, canCreateBos: true })
  assert.deepEqual(caps, {
    canView: true,
    canCreate: true,
    canEdit: false,
    canManageCategories: false,
    canManageAccess: false,
  })
})

test("categorySlug menyatukan variasi kapitalisasi dan spasi", () => {
  assert.equal(categorySlug("ATK"), "atk")
  assert.equal(categorySlug("atk"), "atk")
  assert.equal(categorySlug("  ATK "), "atk")
  assert.equal(categorySlug("Sarana   & Prasarana"), "sarana & prasarana")
  assert.equal(normalizeCategoryName("  Sarana   & Prasarana "), "Sarana & Prasarana")
})

test("summarizeBos menghitung sisa dan persentase, tanpa menyimpannya", () => {
  const summary = summarizeBos(200_000_000, 134_000_000)
  assert.equal(summary.remaining, 66_000_000)
  assert.equal(summary.percentUsed, 67)
  assert.equal(summary.overspent, false)
  assert.equal(summary.budgetSet, true)
})

test("anggaran belum diisi tidak membagi dengan nol", () => {
  const summary = summarizeBos(null, 5_000_000)
  assert.equal(summary.budgetSet, false)
  assert.equal(summary.remaining, null)
  assert.equal(summary.percentUsed, null)
  assert.equal(summary.overspent, false)

  const zeroBudget = summarizeBos(0, 1_000_000)
  assert.equal(zeroBudget.budgetSet, false)
  assert.equal(zeroBudget.percentUsed, null)
})

test("realisasi nol tetap valid", () => {
  const summary = summarizeBos(200_000_000, 0)
  assert.equal(summary.percentUsed, 0)
  assert.equal(summary.remaining, 200_000_000)
  assert.equal(summary.overspent, false)
})

test("overspent menghasilkan sisa negatif dan persentase di atas 100", () => {
  const summary = summarizeBos(100_000_000, 130_000_000)
  assert.equal(summary.remaining, -30_000_000)
  assert.equal(summary.percentUsed, 130)
  assert.equal(summary.overspent, true)
})

test("categoryBreakdown mengambil top 5 dan menggabungkan sisanya", () => {
  const totals = [
    { id: "a", name: "Sarana & Prasarana", total: 72_000_000 },
    { id: "b", name: "Kegiatan Pembelajaran", total: 31_000_000 },
    { id: "c", name: "Administrasi", total: 15_000_000 },
    { id: "d", name: "Langganan & Jasa", total: 9_000_000 },
    { id: "e", name: "Honorarium", total: 7_000_000 },
    { id: "f", name: "ATK", total: 3_000_000 },
    { id: "g", name: "Lain", total: 1_000_000 },
  ]
  const slices = categoryBreakdown(totals)
  assert.equal(slices.length, 6)
  assert.deepEqual(
    slices.map((slice) => slice.name),
    ["Sarana & Prasarana", "Kegiatan Pembelajaran", "Administrasi", "Langganan & Jasa", "Honorarium", "Lainnya"],
  )
  assert.equal(slices[5].total, 4_000_000)
  // Share relatif terhadap kategori terbesar.
  assert.equal(slices[0].share, 100)
})

test("categoryBreakdown tanpa data menghasilkan daftar kosong", () => {
  assert.deepEqual(categoryBreakdown([]), [])
  assert.deepEqual(categoryBreakdown([{ id: "a", name: "ATK", total: 0 }]), [])
})

test("categoryBreakdown tidak membuat Lainnya bila kategori <= 5", () => {
  const slices = categoryBreakdown([
    { id: "a", name: "A", total: 3 },
    { id: "b", name: "B", total: 2 },
  ])
  assert.equal(slices.length, 2)
  assert.ok(!slices.some((slice) => slice.name === "Lainnya"))
})

test("format rupiah memakai locale Indonesia", () => {
  assert.equal(formatRupiah(200_000_000).replace(/\u00a0/g, ""), "Rp200.000.000")
  assert.equal(formatRupiah(0).replace(/\u00a0/g, ""), "Rp0")
  assert.equal(formatRupiahCompact(72_000_000), "Rp72 jt")
  assert.equal(formatRupiahCompact(1_500_000_000), "Rp1,5 M")
})

test("formatPercent menjaga angka bulat tetap bersih", () => {
  assert.equal(formatPercent(67), "67%")
  assert.equal(formatPercent(66.666), "66.7%")
  assert.equal(formatPercent(130), "130%")
})

test("hanya URL http/https yang diterima sebagai dokumentasi", () => {
  assert.equal(normalizeDocumentUrl("https://drive.google.com/x"), "https://drive.google.com/x")
  assert.equal(normalizeDocumentUrl("  "), null)
  assert.equal(normalizeDocumentUrl("bukan-url"), null)
  assert.equal(normalizeDocumentUrl("javascript:alert(1)"), null)
})

test("label dokumentasi ringkas", () => {
  assert.equal(documentLabel(3), "3 file")
  assert.equal(documentLabel(0), "Belum ada")
})
