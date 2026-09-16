import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  buildMappingPlan,
  normalizeName,
  normalizePersonName,
  similarity,
  suggestMapping,
  type InternalEntity,
} from "../lib/asc-mapping"

const GURU: InternalEntity[] = [
  { id: "g1", name: "Muhammad Nur Alamsyah, S.Pd." },
  { id: "g2", name: "Muhammad Nur Hidayat, S.Pd." },
  { id: "g3", name: "Siti Aminah, S.Ag." },
]

const KELAS: InternalEntity[] = [
  { id: "k1", name: "VII A" },
  { id: "k2", name: "VII B" },
]

const MAPEL: InternalEntity[] = [
  { id: "m1", name: "INFORMATIKA" },
  { id: "m2", name: "PPKn" },
]

test("normalisasi menyamakan huruf besar, tanda baca, dan spasi ganda", () => {
  assert.equal(normalizeName("  INFORMATIKA  "), "informatika")
  assert.equal(normalizeName("Informatika"), "informatika")
  assert.equal(normalizeName("VII-A"), "vii a")
  assert.equal(normalizeName("VII   A"), "vii a")
})

test("normalisasi nama orang menanggalkan gelar, termasuk gelar salah kapitalisasi", () => {
  assert.equal(
    normalizePersonName("Muhammad Nur Alamsyah, S.Pd."),
    normalizePersonName("Muhammad Nur Alamsyah, S.pd."),
  )
  assert.equal(normalizePersonName("Drs. Bambang"), "bambang")
  // Nama yang seluruhnya terdiri atas token gelar tidak boleh menjadi string
  // kosong, karena string kosong akan cocok dengan apa pun.
  assert.notEqual(normalizePersonName("S.Pd."), "")
})

test("typo gelar tetap menghasilkan kandidat persis", () => {
  const suggestion = suggestMapping("T1", "Muhammad Nur Alamsyah, S.pd.", GURU, {
    normalize: normalizePersonName,
  })

  assert.equal(suggestion.autoSelectId, "g1")
  assert.equal(suggestion.candidates[0].kind, "exact")
})

test("nama mirip tetapi berbeda orang TIDAK pernah ditautkan otomatis", () => {
  // "Muhamad Nur Alamsah" mirip dengan dua guru sekaligus; auto-link di sini
  // akan memindahkan seluruh jadwal seseorang ke orang lain.
  const suggestion = suggestMapping("T9", "Muhamad Nur Alamsah", GURU, {
    normalize: normalizePersonName,
  })

  assert.equal(suggestion.autoSelectId, null)
  assert.ok(suggestion.candidates.length >= 1)
})

test("fuzzy setinggi apa pun tidak menghasilkan auto-link", () => {
  const suggestion = suggestMapping("T8", "Siti Aminahh", GURU, { normalize: normalizePersonName })
  assert.equal(suggestion.autoSelectId, null)
  assert.ok(suggestion.candidates.some((row) => row.id === "g3"))
})

test("nama yang tidak dikenal sama sekali tidak menghasilkan kandidat palsu", () => {
  const suggestion = suggestMapping("T7", "Zulkarnain Pratama", GURU, {
    normalize: normalizePersonName,
  })
  assert.equal(suggestion.autoSelectId, null)
  assert.equal(suggestion.candidates.length, 0)
})

test("kelas dicocokkan lintas perbedaan format", () => {
  const suggestion = suggestMapping("C1", "VII-A", KELAS)
  assert.equal(suggestion.autoSelectId, "k1")
})

test("mapel beda kapitalisasi cocok persis, beda nama resmi tidak auto-link", () => {
  assert.equal(suggestMapping("S1", "Informatika", MAPEL).autoSelectId, "m1")
  // "Pendidikan Pancasila" ↔ "PPKn" hanya bisa dihubungkan admin.
  assert.equal(suggestMapping("S2", "Pendidikan Pancasila", MAPEL).autoSelectId, null)
})

test("pemetaan tersimpan menang atas nama, meski nama XML berubah", () => {
  const existing = new Map<string, InternalEntity>([["T1", { id: "g1", name: "Muhammad Nur Alamsyah, S.Pd." }]])

  const plan = buildMappingPlan(
    [
      { externalId: "T1", name: "M. Nur Alamsyah" },
      { externalId: "T2", name: "Siti Aminah, S.Ag." },
    ],
    existing,
    GURU,
    { normalize: normalizePersonName },
  )

  const mapped = plan.rows.find((row) => row.externalId === "T1")
  assert.ok(mapped)
  assert.equal(mapped.mappedId, "g1")
  // Baris terpetakan tidak dihitung ulang dari nama sama sekali.
  assert.equal(mapped.suggestion, null)

  assert.equal(plan.mappedCount, 1)
  assert.equal(plan.unmappedCount, 1)
})

test("external ID baru untuk orang yang sama dianggap belum terpetakan", () => {
  // Guru dihapus lalu dibuat ulang di aSc: ID berubah, jadi pemetaan lama tidak
  // berlaku dan sistem tidak boleh diam-diam membuat guru baru.
  const existing = new Map<string, InternalEntity>([["T1", { id: "g1", name: "Muhammad Nur Alamsyah, S.Pd." }]])

  const plan = buildMappingPlan(
    [{ externalId: "T1-baru", name: "Muhammad Nur Alamsyah, S.Pd." }],
    existing,
    GURU,
    { normalize: normalizePersonName },
  )

  const row = plan.rows[0]
  assert.equal(row.mappedId, null)
  assert.ok(row.suggestion, "harus menawarkan kembali guru yang sama")
  assert.equal(row.suggestion.autoSelectId, "g1")
  assert.equal(plan.unmappedCount, 1)
})

test("kemiripan adalah 1 hanya untuk string identik", () => {
  assert.equal(similarity("abc", "abc"), 1)
  assert.ok(similarity("abc", "abd") < 1)
  assert.equal(similarity("", "abc"), 0)
})
