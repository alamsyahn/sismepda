import { strict as assert } from "node:assert"
import { test } from "node:test"

import { coverCrop, outputSize } from "../lib/image-resize"
import {
  FACILITY_PHOTO_ASPECT,
  HERO_PHOTO_ASPECT,
  OFFICER_PHOTO_ASPECT,
  euksFacilityPhotoUrl,
  euksHeroImageUrl,
  euksOfficerPhotoUrl,
  officerInitials,
  officerPlaceholderTone,
} from "../lib/euks-settings"

test("potongan cover memangkas sisi yang berlebih, bukan meregangkan gambar", () => {
  // Sumber lanskap 4000x3000 dipaksa ke 9:16 → yang dipotong adalah kiri-kanan.
  const wide = coverCrop(4000, 3000, OFFICER_PHOTO_ASPECT)
  assert.equal(wide.sh, 3000, "tinggi penuh dipakai")
  assert.equal(wide.sw, Math.round(3000 * OFFICER_PHOTO_ASPECT))
  assert.equal(wide.sx, Math.round((4000 - wide.sw) / 2), "potongan terpusat")
  assert.equal(wide.sy, 0)

  // Sumber potret sangat tinggi dipaksa ke 4:3 → yang dipotong atas-bawah.
  const tall = coverCrop(1000, 4000, FACILITY_PHOTO_ASPECT)
  assert.equal(tall.sw, 1000)
  assert.equal(tall.sh, Math.round(1000 / FACILITY_PHOTO_ASPECT))
  assert.equal(tall.sx, 0)
  assert.equal(tall.sy, Math.round((4000 - tall.sh) / 2))
})

test("potongan cover pada rasio yang sudah pas tidak membuang piksel", () => {
  const exact = coverCrop(900, 1600, OFFICER_PHOTO_ASPECT)
  assert.deepEqual(exact, { sx: 0, sy: 0, sw: 900, sh: 1600 })
})

test("ukuran keluaran membatasi sisi terpanjang sesuai orientasi", () => {
  // Potret: tinggi yang dibatasi, lebar mengikuti rasio.
  assert.deepEqual(outputSize(OFFICER_PHOTO_ASPECT, 1280), { width: 720, height: 1280 })
  // Lanskap: lebar yang dibatasi.
  assert.deepEqual(outputSize(FACILITY_PHOTO_ASPECT, 1280), { width: 1280, height: 960 })
})

test("URL foto null ketika belum pernah ada foto", () => {
  // Baris lama yang dibuat sebelum fitur foto selalu bernilai null dan harus
  // jatuh ke placeholder, bukan meminta gambar yang pasti 404.
  assert.equal(euksOfficerPhotoUrl("abc", null), null)
  assert.equal(euksFacilityPhotoUrl("abc", undefined), null)
})

test("URL foto membawa penanda waktu agar foto pengganti tidak tertahan cache", () => {
  const at = new Date("2026-09-12T03:04:05.000Z")
  assert.equal(euksOfficerPhotoUrl("ofc1", at), `/api/e-uks/officers/ofc1/photo?v=${at.getTime()}`)
  assert.equal(
    euksFacilityPhotoUrl("fac1", at.toISOString()),
    `/api/e-uks/facilities/fac1/photo?v=${at.getTime()}`,
  )
})

test("foto hero mengikuti aturan URL yang sama dengan pengurus dan fasilitas", () => {
  // Slide tanpa foto disaring sebelum render; null di sini yang menjaganya.
  assert.equal(euksHeroImageUrl("hero1", null), null)

  const at = new Date("2026-09-12T03:04:05.000Z")
  assert.equal(
    euksHeroImageUrl("hero1", at),
    `/api/e-uks/hero-images/hero1/photo?v=${at.getTime()}`,
  )
  // Foto hero dilayani dengan Cache-Control immutable, jadi penanda waktu ini
  // satu-satunya hal yang membuat foto pengganti terlihat.
  assert.notEqual(
    euksHeroImageUrl("hero1", at),
    euksHeroImageUrl("hero1", new Date(at.getTime() + 1000)),
  )
})

test("hero memakai rasio lanskap lebar agar aman sebagai latar penuh", () => {
  assert.equal(HERO_PHOTO_ASPECT, 16 / 9)
  assert.deepEqual(outputSize(HERO_PHOTO_ASPECT, 1600), { width: 1600, height: 900 })
})

test("inisial pengurus membuang gelar tetapi mempertahankan singkatan nama depan", () => {
  assert.equal(officerInitials("Budi Santoso"), "BS")
  // Gelar setelah koma tidak boleh ikut terhitung.
  assert.equal(officerInitials("Budi Santoso, S.Pd"), "BS")
  assert.equal(officerInitials("Siti Aminah, S.Pd., M.M."), "SA")
  // "Moh." adalah bagian nama, bukan gelar — harus tetap dihitung.
  assert.equal(officerInitials("Moh. Rizki"), "MR")
  assert.equal(officerInitials("Abd. Rahman Hakim"), "AH")
  // Nama satu kata hanya menghasilkan satu huruf.
  assert.equal(officerInitials("Sukarno"), "S")
  // Tidak ada kata tersisa → tanda tanya, bukan string kosong.
  assert.equal(officerInitials(", S.Pd"), "?")
  assert.equal(officerInitials("   "), "?")
})

test("nada placeholder deterministik dan selalu di dalam rentang", () => {
  // Kartu orang yang sama tidak boleh berganti warna tiap halaman dimuat.
  assert.equal(officerPlaceholderTone("Budi Santoso", 3), officerPlaceholderTone("Budi Santoso", 3))
  for (const name of ["Budi", "Siti Aminah", "Moh. Rizki", "", "Zulkarnain Abdul Hakim"]) {
    const tone = officerPlaceholderTone(name, 3)
    assert.ok(tone >= 0 && tone < 3, `nada ${tone} di luar rentang untuk "${name}"`)
    assert.equal(Number.isInteger(tone), true)
  }
})
