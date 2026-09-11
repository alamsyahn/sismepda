import { test } from "node:test"
import assert from "node:assert/strict"
import { filterRosterByName } from "../lib/attendance-input"

const roster = [
  { id: "1", name: "Budi Santoso" },
  { id: "2", name: "Siti Aminah" },
  { id: "3", name: "Ahmad Budiman" },
  { id: "4", name: "budi raharjo" },
]

test("kata kunci kosong mengembalikan seluruh daftar", () => {
  assert.deepEqual(filterRosterByName(roster, "").map((s) => s.id), ["1", "2", "3", "4"])
})

test("kata kunci berisi spasi saja mengembalikan seluruh daftar", () => {
  assert.deepEqual(filterRosterByName(roster, "   ").map((s) => s.id), ["1", "2", "3", "4"])
})

test("pencocokan mengabaikan huruf besar/kecil", () => {
  assert.deepEqual(filterRosterByName(roster, "BUDI").map((s) => s.id), ["1", "3", "4"])
})

test("cocok pada potongan kata di tengah nama", () => {
  assert.deepEqual(filterRosterByName(roster, "amin").map((s) => s.id), ["2"])
})

test("semua kata harus muncul", () => {
  assert.deepEqual(filterRosterByName(roster, "budi santoso").map((s) => s.id), ["1"])
})

test("urutan kata tidak mempengaruhi hasil", () => {
  assert.deepEqual(filterRosterByName(roster, "santoso budi").map((s) => s.id), ["1"])
})

test("spasi berlebih di antara kata diabaikan", () => {
  assert.deepEqual(filterRosterByName(roster, "  budi   santoso  ").map((s) => s.id), ["1"])
})

test("tanpa hasil mengembalikan daftar kosong", () => {
  assert.deepEqual(filterRosterByName(roster, "zulkifli"), [])
})

test("urutan asli daftar dipertahankan", () => {
  assert.deepEqual(filterRosterByName(roster, "a").map((s) => s.name), [
    "Budi Santoso",
    "Siti Aminah",
    "Ahmad Budiman",
    "budi raharjo",
  ])
})

test("daftar masukan tidak diubah", () => {
  const original = [...roster]
  filterRosterByName(roster, "budi")
  assert.deepEqual(roster, original)
})
