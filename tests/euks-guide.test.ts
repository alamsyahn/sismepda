/**
 * Panduan & Referensi E-UKS.
 *
 * Dua hal yang diuji di sini dan tidak terlihat oleh tsc:
 *
 * 1. Isi panduan harus mengikuti implementasi perhitungan yang benar-benar
 *    dipakai (`calculateBmi`, `categorizeZScore`, rumus LMS), bukan angka yang
 *    diketik ulang di teks. Panduan yang mengklaim ambang berbeda dari kode
 *    lebih berbahaya daripada tidak ada panduan.
 * 2. Halaman benar-benar merender heading dan section pentingnya. Komponen
 *    dirender sungguhan dengan React, karena kesalahan struktur (anchor tanpa
 *    target, tautan referensi hilang) tetap lolos pemeriksaan tipe.
 *
 * JSX tidak dipakai supaya berkas tetap `.test.ts` dan ikut terjaring
 * `tsx --test tests/**\/*.test.ts`.
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { EuksGuideFlow } from "../components/e-uks/euks-guide-flow"
import { EuksGuideHero } from "../components/e-uks/euks-guide-hero"
import { EuksGuideNavigation } from "../components/e-uks/euks-guide-navigation"
import { categorizeZScore, nutritionCategoryLabels } from "../lib/bmi-for-age"
import { calculateBmi } from "../lib/euks"
import {
  EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM,
  EUKS_GUIDE_BMI_EXAMPLE_WEIGHT_KG,
  EUKS_GUIDE_FLOW,
  EUKS_GUIDE_LMS_FORMULA,
  EUKS_GUIDE_LMS_FORMULA_ZERO_L,
  EUKS_GUIDE_REFERENCES,
  EUKS_GUIDE_SECTIONS,
  NUTRITION_GUIDE_ROWS,
  guideBmiExample,
} from "../lib/euks-guide"
import { activeNavGroupId, activeNavHref, isNavGroup, mainNav } from "../lib/nav"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Panduan & Referensi berada di bawah Riwayat Kunjungan UKS dan di atas Pengaturan E-UKS", () => {
  const group = mainNav.find((entry) => isNavGroup(entry) && entry.id === "e-uks")
  assert.ok(group && isNavGroup(group))

  const hrefs = group.children.map((child) => child.href)
  const guideIndex = hrefs.indexOf("/e-uks/panduan")
  assert.ok(guideIndex > -1, "menu panduan harus ada")
  assert.equal(hrefs[guideIndex - 1], "/e-uks/riwayat-kunjungan")
  assert.equal(hrefs[guideIndex + 1], "/e-uks/pengaturan")

  const item = group.children[guideIndex]
  assert.equal(item.title, "Panduan & Referensi")
  assert.deepEqual(item.permissions, ["euks.content.read"])
})

test("active state panduan tidak merusak route E-UKS lain", () => {
  assert.equal(activeNavHref(mainNav, "/e-uks/panduan"), "/e-uks/panduan")
  assert.equal(activeNavGroupId(mainNav, "/e-uks/panduan"), "e-uks")
  // Halaman utama dicocokkan `exact`, jadi tidak ikut menyala di sub-route ini.
  assert.notEqual(activeNavHref(mainNav, "/e-uks/panduan"), "/e-uks")
})

test("halaman panduan dijaga izin baca konten E-UKS", () => {
  const source = read("app/e-uks/panduan/page.tsx")
  assert.match(source, /requirePagePermission\("euks\.content\.read"\)/)
  // Halaman statis: tidak boleh ada query database maupun permission baru.
  assert.doesNotMatch(source, /prisma|readEuks|fetch\(/)
})

test("contoh IMT pada panduan dihitung dengan calculateBmi aplikasi", () => {
  const expected = calculateBmi(EUKS_GUIDE_BMI_EXAMPLE_HEIGHT_CM, EUKS_GUIDE_BMI_EXAMPLE_WEIGHT_KG)
  assert.ok(expected !== null)
  const example = guideBmiExample()
  assert.equal(example.bmi, expected.toFixed(1).replace(".", ","))
  // Contoh yang diminta: 45 kg, 155 cm → 18,7.
  assert.equal(example.bmi, "18,7")
  assert.equal(example.heightM, "1,55")
})

test("tabel kategori panduan memakai ambang categorizeZScore, bukan salinan teks", () => {
  assert.deepEqual(
    NUTRITION_GUIDE_ROWS.map((row) => row.range),
    ["< −3 SD", "−3 SD sampai < −2 SD", "−2 SD sampai +1 SD", "> +1 SD sampai +2 SD", "> +2 SD"],
  )
  for (const row of NUTRITION_GUIDE_ROWS) {
    assert.equal(row.category, categorizeZScore(row.sampleZ))
    assert.equal(row.label, nutritionCategoryLabels[row.category])
  }
  assert.deepEqual(
    NUTRITION_GUIDE_ROWS.map((row) => row.label),
    ["Gizi buruk", "Gizi kurang", "Gizi baik", "Gizi lebih", "Obesitas"],
  )
})

test("rumus LMS pada panduan sama dengan yang dijalankan lib/lms.ts", () => {
  const lms = read("lib/lms.ts")
  // Kode menghitung ((value/M)^L - 1) / (L*S), dan ln(value/M)/S ketika L = 0.
  assert.match(lms, /Math\.pow\(value \/ m, l\) - 1\) \/ \(l \* s\)/)
  assert.match(lms, /Math\.log\(value \/ m\) \/ s/)
  assert.equal(EUKS_GUIDE_LMS_FORMULA, "z = ((IMT/M)^L − 1) ÷ (L × S)")
  assert.equal(EUKS_GUIDE_LMS_FORMULA_ZERO_L, "z = ln(IMT/M) ÷ S")
})

test("hero panduan merender heading utama dan tiga badge", () => {
  const html = renderToStaticMarkup(createElement(EuksGuideHero))
  assert.match(html, /<h1[^>]*>Panduan &amp; Referensi E-UKS<\/h1>/)
  assert.match(html, /Pahami cara kerja data kesehatan/)
  for (const badge of ["Dasar Perhitungan", "Tindak Lanjut", "Sumber Resmi"]) {
    assert.ok(html.includes(badge), badge)
  }
})

test("navigasi cepat menautkan setiap section yang ada di halaman", () => {
  const html = renderToStaticMarkup(createElement(EuksGuideNavigation))
  const page = read("app/e-uks/panduan/page.tsx")
  for (const entry of EUKS_GUIDE_SECTIONS) {
    assert.ok(html.includes(`href="#${entry.id}"`), `tautan ${entry.id}`)
    // Anchor tanpa target adalah tautan mati; section-nya harus benar-benar
    // dirender di halaman.
    assert.ok(page.includes(`id="${entry.id}"`), `section ${entry.id}`)
  }
})

test("diagram alur merender delapan tahap berurutan tanpa ASCII", () => {
  const html = renderToStaticMarkup(createElement(EuksGuideFlow))
  assert.equal(EUKS_GUIDE_FLOW.length, 8)
  EUKS_GUIDE_FLOW.forEach((step, index) => {
    assert.equal(step.step, index + 1)
    assert.ok(html.includes(step.title), step.title)
  })
  assert.match(html, /<ol/)
  assert.match(html, /<svg/)
})

test("tautan referensi resmi tersedia dan aman", () => {
  const page = read("app/e-uks/panduan/page.tsx")
  assert.match(page, /target="_blank"/)
  assert.match(page, /rel="noreferrer"/)

  const urls = EUKS_GUIDE_REFERENCES.map((reference) => reference.url)
  assert.deepEqual(urls, [
    "https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-2-tahun-2020",
    "https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/bmi-for-age",
    "https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/",
  ])
  for (const url of urls) assert.ok(url.startsWith("https://"), url)
})

test("tanggal pembaruan panduan adalah konstanta, bukan waktu server", () => {
  const source = read("lib/euks-guide.ts")
  assert.match(source, /EUKS_GUIDE_LAST_UPDATED = "/)
  assert.doesNotMatch(source, /new Date\(\)|Date\.now\(\)/)
})
