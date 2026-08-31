import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  availabilityLabel,
  availabilityText,
  buildLocationTree,
  canReparent,
  canViewSarpras,
  flattenLocationTree,
  hasSarprasPermission,
  itemCountLabel,
  locationPath,
  normalizeSarprasName,
  primaryStatus,
  quantityError,
  sarprasCapabilities,
  sarprasSlug,
  shortageOf,
  statusCount,
  statusShare,
  subtreeIds,
  summarizeSarpras,
  surplusOf,
  validateQuantities,
  type SarprasQuantities,
} from "../lib/sarpras"

const admin = { role: "ADMIN" as const }
const guru = { role: "GURU" as const }

/** Convenience builder so each test only states the numbers it cares about. */
function qty(partial: Partial<SarprasQuantities>): SarprasQuantities {
  return {
    targetQuantity: 0,
    availableQuantity: 0,
    goodQuantity: 0,
    moderateQuantity: 0,
    repairQuantity: 0,
    ...partial,
  }
}

/* -------------------------------------------------------------------------- */
/* Permissions                                                                */
/* -------------------------------------------------------------------------- */

test("ADMIN selalu lolos setiap permission Sarpras", () => {
  assert.equal(hasSarprasPermission(admin, "sarpras.view"), true)
  assert.equal(hasSarprasPermission(admin, "sarpras.edit"), true)
})

test("GURU tanpa hak sama sekali tidak bisa melihat Sarpras", () => {
  assert.equal(canViewSarpras(guru), false)
  assert.equal(hasSarprasPermission(guru, "sarpras.edit"), false)
})

test("sarpras.edit otomatis menyiratkan sarpras.view", () => {
  assert.equal(canViewSarpras({ role: "GURU", canEditSarpras: true }), true)
  // Tetapi view saja tidak memberi hak menulis.
  assert.equal(hasSarprasPermission({ role: "GURU", canViewSarpras: true }, "sarpras.edit"), false)
})

test("sarprasCapabilities memetakan hak viewer dan editor", () => {
  assert.deepEqual(sarprasCapabilities({ role: "GURU", canViewSarpras: true }), {
    canView: true,
    canEdit: false,
  })
  assert.deepEqual(sarprasCapabilities({ role: "GURU", canEditSarpras: true }), {
    canView: true,
    canEdit: true,
  })
})

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

test("sarprasSlug menyatukan variasi kapitalisasi dan spasi", () => {
  assert.equal(sarprasSlug("  VII   A "), "vii a")
  assert.equal(sarprasSlug("Kursi Siswa"), sarprasSlug("kursi   siswa"))
})

test("normalizeSarprasName merapikan spasi tetapi menjaga kapitalisasi", () => {
  assert.equal(normalizeSarprasName("  Laboratorium   Komputer "), "Laboratorium Komputer")
})

/* -------------------------------------------------------------------------- */
/* Validasi jumlah                                                            */
/* -------------------------------------------------------------------------- */

test("baik + sedang + perluPerbaikan harus sama dengan jumlah tersedia", () => {
  const valid = qty({ targetQuantity: 32, availableQuantity: 32, goodQuantity: 28, moderateQuantity: 2, repairQuantity: 2 })
  assert.deepEqual(validateQuantities(valid), [])

  const mismatch = qty({ targetQuantity: 32, availableQuantity: 32, goodQuantity: 28, moderateQuantity: 2, repairQuantity: 1 })
  assert.deepEqual(validateQuantities(mismatch), ["condition-sum-mismatch"])
  assert.equal(quantityError(mismatch), "Baik + Sedang + Perlu Perbaikan harus sama dengan jumlah tersedia")
})

test("jumlah negatif ditolak", () => {
  assert.deepEqual(validateQuantities(qty({ targetQuantity: -1 })), ["target-negative"])
  assert.deepEqual(validateQuantities(qty({ availableQuantity: -3 })), ["available-negative"])
  assert.deepEqual(validateQuantities(qty({ goodQuantity: -2 })), ["condition-negative"])
})

test("jumlah tersedia melebihi target tetap valid dan dilaporkan sebagai surplus", () => {
  const surplus = qty({ targetQuantity: 2, availableQuantity: 3, goodQuantity: 3 })
  assert.deepEqual(validateQuantities(surplus), [])
  assert.equal(surplusOf(surplus), 1)
  assert.equal(shortageOf(surplus), 0)
})

/* -------------------------------------------------------------------------- */
/* Status per item                                                            */
/* -------------------------------------------------------------------------- */

test("item dengan target terdefinisi dan tersedia 0 berstatus Tidak Ada", () => {
  const cctv = qty({ targetQuantity: 1, availableQuantity: 0 })
  assert.equal(primaryStatus(cctv), "MISSING")
  assert.equal(availabilityText(cctv), "Tidak Ada")
  assert.equal(availabilityLabel(cctv), "0/1")
})

test("status utama mengambil kondisi terburuk yang ada", () => {
  assert.equal(primaryStatus(qty({ targetQuantity: 1, availableQuantity: 1, repairQuantity: 1 })), "REPAIR")
  assert.equal(primaryStatus(qty({ targetQuantity: 1, availableQuantity: 1, moderateQuantity: 1 })), "MODERATE")
  assert.equal(primaryStatus(qty({ targetQuantity: 1, availableQuantity: 1, goodQuantity: 1 })), "GOOD")
  // 28 baik tidak boleh menyembunyikan 2 unit rusak.
  const kursi = qty({ targetQuantity: 32, availableQuantity: 32, goodQuantity: 28, moderateQuantity: 2, repairQuantity: 2 })
  assert.equal(primaryStatus(kursi), "REPAIR")
})

test("barang tersedia sebagian bukan Tidak Ada", () => {
  const kipas = qty({ targetQuantity: 4, availableQuantity: 2, goodQuantity: 2 })
  assert.notEqual(primaryStatus(kipas), "MISSING")
  assert.equal(availabilityText(kipas), "Ada")
  assert.equal(availabilityLabel(kipas), "2/4")
})

/* -------------------------------------------------------------------------- */
/* Statistik dashboard (berbasis unit)                                        */
/* -------------------------------------------------------------------------- */

test("chart menghitung unit, bukan jumlah record", () => {
  const stats = summarizeSarpras([
    qty({ targetQuantity: 32, availableQuantity: 32, goodQuantity: 28, moderateQuantity: 2, repairQuantity: 2 }),
    qty({ targetQuantity: 1, availableQuantity: 0 }),
  ])
  assert.deepEqual(stats, { missing: 1, repair: 2, moderate: 2, good: 28, total: 33 })
})

test("Tidak Ada merepresentasikan kekurangan unit terhadap kebutuhan", () => {
  // Target 4, tersedia 2 -> 2 unit belum tersedia, walau barang ini punya stok.
  const stats = summarizeSarpras([qty({ targetQuantity: 4, availableQuantity: 2, goodQuantity: 2 })])
  assert.equal(stats.missing, 2)
  assert.equal(stats.good, 2)
  assert.equal(stats.total, 4)
})

test("surplus tidak menghasilkan kekurangan negatif", () => {
  const stats = summarizeSarpras([qty({ targetQuantity: 1, availableQuantity: 3, goodQuantity: 3 })])
  assert.equal(stats.missing, 0)
  assert.equal(stats.total, 3)
})

test("statusCount dan statusShare konsisten dengan stats", () => {
  const stats = summarizeSarpras([
    qty({ targetQuantity: 10, availableQuantity: 5, goodQuantity: 5 }),
    qty({ targetQuantity: 5, availableQuantity: 5, repairQuantity: 5 }),
  ])
  assert.equal(statusCount(stats, "MISSING"), 5)
  assert.equal(statusCount(stats, "GOOD"), 5)
  assert.equal(statusCount(stats, "REPAIR"), 5)
  assert.equal(statusShare(stats, "GOOD"), 33)
  // Tanpa data sama sekali pembagian nol tidak boleh meledak.
  assert.equal(statusShare(summarizeSarpras([]), "GOOD"), 0)
})

/* -------------------------------------------------------------------------- */
/* Tree lokasi                                                                */
/* -------------------------------------------------------------------------- */

const locations = [
  { id: "kelas", name: "Kelas", parentId: null, sortOrder: 0 },
  { id: "viia", name: "VII A", parentId: "kelas", sortOrder: 1 },
  { id: "viib", name: "VII B", parentId: "kelas", sortOrder: 2 },
  { id: "lab", name: "Laboratorium", parentId: null, sortOrder: 1 },
  { id: "labkom", name: "Laboratorium Komputer", parentId: "lab", sortOrder: 0 },
]

test("tree menjumlahkan barang anak ke induknya", () => {
  const counts = new Map([
    ["kelas", 2], // CCTV koridor langsung di node induk
    ["viia", 34],
    ["viib", 35],
    ["labkom", 12],
  ])
  const tree = buildLocationTree(locations, counts)
  const kelas = tree.find((node) => node.id === "kelas")
  assert.ok(kelas)
  // Node induk boleh punya child DAN barang sekaligus.
  assert.equal(kelas.directItemCount, 2)
  assert.equal(kelas.totalItemCount, 71)
  assert.equal(kelas.children.length, 2)

  const lab = tree.find((node) => node.id === "lab")
  assert.equal(lab?.directItemCount, 0)
  assert.equal(lab?.totalItemCount, 12)
})

test("kedalaman tree tidak dibatasi dua tingkat", () => {
  const deep = [
    { id: "gedung", name: "Gedung A", parentId: null, sortOrder: 0 },
    { id: "lantai", name: "Lantai 2", parentId: "gedung", sortOrder: 0 },
    { id: "ruang", name: "Ruang 201", parentId: "lantai", sortOrder: 0 },
    { id: "area", name: "Area Depan", parentId: "ruang", sortOrder: 0 },
  ]
  const flat = flattenLocationTree(buildLocationTree(deep, new Map([["area", 3]])))
  assert.deepEqual(flat.map((node) => node.depth), [0, 1, 2, 3])
  assert.equal(flat[0].totalItemCount, 3)
  assert.equal(locationPath(deep, "area"), "Gedung A / Lantai 2 / Ruang 201 / Area Depan")
})

test("lokasi dengan parent hilang tetap muncul sebagai root", () => {
  const orphan = [{ id: "x", name: "Lorong", parentId: "tidak-ada", sortOrder: 0 }]
  const tree = buildLocationTree(orphan)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].id, "x")
})

test("subtreeIds mengumpulkan seluruh keturunan", () => {
  assert.deepEqual([...subtreeIds(locations, "kelas")].sort(), ["kelas", "viia", "viib"])
})

test("lokasi tidak boleh dipindahkan ke dalam keturunannya sendiri", () => {
  assert.equal(canReparent(locations, "kelas", "viia"), false)
  assert.equal(canReparent(locations, "kelas", "kelas"), false)
  assert.equal(canReparent(locations, "viia", "lab"), true)
  assert.equal(canReparent(locations, "viia", null), true)
})

test("itemCountLabel membaca wajar saat kosong", () => {
  assert.equal(itemCountLabel(0), "Belum ada barang")
  assert.equal(itemCountLabel(34), "34 barang")
})
