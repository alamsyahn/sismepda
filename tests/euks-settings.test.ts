import { strict as assert } from "node:assert"
import { test } from "node:test"

import { euksSlug, normalizeLabel, officerDisplayName, reorder } from "../lib/euks-settings"
import { normalizeTerm } from "../lib/euks-trends"

test("slug merapikan spasi dan menyamakan huruf besar-kecil", () => {
  assert.equal(euksSlug("  Sakit   Kepala "), "sakit kepala")
  assert.equal(euksSlug("TANDU"), "tandu")
})

test("slug pengaturan identik dengan normalisasi tren", () => {
  // Kalau kedua fungsi ini berbeda, sebuah keluhan bisa lolos sebagai "baru"
  // di form tetapi menyatu di statistik Halaman Utama, atau sebaliknya.
  for (const value of ["Demam", " demam ", "SAKIT  KEPALA", "Batuk Pilek", "a"]) {
    assert.equal(euksSlug(value), normalizeTerm(value), `berbeda untuk "${value}"`)
  }
})

test("normalizeLabel merapikan spasi tanpa mengubah huruf", () => {
  assert.equal(normalizeLabel("  Sakit   Kepala "), "Sakit Kepala")
  assert.equal(normalizeLabel("TANDU"), "TANDU")
})

test("reorder menukar dengan tetangga", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.deepEqual(reorder(items, "b", -1).map((i) => i.id), ["b", "a", "c"])
  assert.deepEqual(reorder(items, "b", 1).map((i) => i.id), ["a", "c", "b"])
})

test("reorder di batas atas dan bawah tidak mengubah apa pun", () => {
  const items = [{ id: "a" }, { id: "b" }]
  assert.deepEqual(reorder(items, "a", -1).map((i) => i.id), ["a", "b"])
  assert.deepEqual(reorder(items, "b", 1).map((i) => i.id), ["a", "b"])
})

test("reorder mengabaikan id yang tidak ada", () => {
  const items = [{ id: "a" }, { id: "b" }]
  assert.deepEqual(reorder(items, "zzz", 1).map((i) => i.id), ["a", "b"])
})

test("reorder tidak mengubah array asli", () => {
  const items = [{ id: "a" }, { id: "b" }]
  reorder(items, "a", 1)
  assert.deepEqual(items.map((i) => i.id), ["a", "b"], "array asli harus utuh")
})

test("nama pengurus memakai nama akun guru bila tertaut", () => {
  assert.equal(officerDisplayName({ name: "Nama Lama", user: { name: "Budi Santoso" } }), "Budi Santoso")
})

test("nama pengurus manual dipakai apa adanya bila tanpa akun", () => {
  assert.equal(officerDisplayName({ name: "Siti Aminah", user: null }), "Siti Aminah")
  assert.equal(officerDisplayName({ name: "Siti Aminah" }), "Siti Aminah")
})
