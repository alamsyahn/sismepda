import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  DEFAULT_STATUS_COLORS,
  colorDistance,
  normalizeHexColor,
  parseStatusColors,
  similarColorWarnings,
} from "../lib/attendance-status-colors"

test("hex dinormalkan ke bentuk enam digit huruf kecil", () => {
  assert.equal(normalizeHexColor("#AABBCC"), "#aabbcc")
  assert.equal(normalizeHexColor("aabbcc"), "#aabbcc")
  // Bentuk singkat tetap diterima supaya admin bebas mengetik.
  assert.equal(normalizeHexColor("#abc"), "#aabbcc")
})

test("hex tidak valid ditolak", () => {
  assert.equal(normalizeHexColor("#12345"), null)
  assert.equal(normalizeHexColor("merah"), null)
  assert.equal(normalizeHexColor(""), null)
  assert.equal(normalizeHexColor(null), null)
})

test("warna default dipakai saat pengaturan kosong atau rusak", () => {
  assert.deepEqual(parseStatusColors(null), DEFAULT_STATUS_COLORS)
  assert.deepEqual(parseStatusColors("bukan json"), DEFAULT_STATUS_COLORS)
  // Nilai sebagian: kategori yang tidak diatur tetap memakai default.
  assert.deepEqual(parseStatusColors(JSON.stringify({ sakit: "#123456" })), {
    ...DEFAULT_STATUS_COLORS,
    sakit: "#123456",
  })
  // Nilai rusak pada satu kategori tidak merusak kategori lain.
  assert.deepEqual(parseStatusColors(JSON.stringify({ izin: "bukan-warna" })), DEFAULT_STATUS_COLORS)
})

test("jarak warna mengukur kemiripan visual", () => {
  assert.equal(colorDistance("#000000", "#000000"), 0)
  assert.ok(colorDistance("#ff0000", "#fe0101") < 10)
  assert.ok(colorDistance("#ff0000", "#0000ff") > 100)
})

test("warna terlalu mirip memicu peringatan non-blocking dengan nama kategori", () => {
  const warnings = similarColorWarnings({
    ...DEFAULT_STATUS_COLORS,
    sakit: "#3366cc",
    izin: "#3466cc",
  })
  assert.equal(warnings.sakit, "Warna ini cukup mirip dengan warna Izin dan mungkin sulit dibedakan.")
  assert.equal(warnings.izin, "Warna ini cukup mirip dengan warna Sakit dan mungkin sulit dibedakan.")
  // Warna default cukup berbeda sehingga tidak ada peringatan.
  assert.deepEqual(similarColorWarnings(DEFAULT_STATUS_COLORS), {})
})
