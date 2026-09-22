/**
 * Kartu Komposisi Tindakan.
 *
 * Dua lapis: alokasi kotak diuji sebagai fungsi murni, lalu komponennya
 * dirender sungguhan dengan React. Jumlah kotak adalah klaim yang dibaca
 * pengguna sebagai persentase — sebuah pembulatan yang meleset satu kotak
 * membuat grafik berbohong tanpa memicu kesalahan tipe apa pun.
 *
 * JSX tidak dipakai supaya berkas tetap `.test.ts` dan ikut terjaring
 * `tsx --test tests/**\/*.test.ts`.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { EuksTreatmentComposition } from "../components/e-uks/euks-treatment-composition"
import {
  COMPOSITION_SLICE_LIMIT,
  OTHER_COMPOSITION_KEY,
  WAFFLE_BOX_LIMIT,
  allocateBoxes,
  buildTreatmentComposition,
} from "../lib/euks-treatment-composition"
import { rankTerms, type TrendCount } from "../lib/euks-trends"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

/** Baris peringkat buatan dengan `share` yang konsisten terhadap totalnya. */
function rows(counts: Record<string, number>): TrendCount[] {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return Object.entries(counts).map(([label, count]) => ({
    key: label.toLowerCase(),
    label,
    count,
    share: total === 0 ? 0 : (count / total) * 100,
  }))
}

const render = (props: Parameters<typeof EuksTreatmentComposition>[0]) =>
  renderToStaticMarkup(createElement(EuksTreatmentComposition, props))

const countBoxes = (html: string) => (html.match(/aspect-square/g) ?? []).length

test("judul kartu menjadi Komposisi Tindakan", () => {
  const source = read("components/e-uks/euks-complaint-treatment-insights.tsx")
  assert.match(source, /<CardTitle>Komposisi Tindakan<\/CardTitle>/)
  assert.doesNotMatch(source, /Tindakan Terbanyak/)
  // Kartu tetangga tidak boleh ikut berubah.
  assert.match(source, /<CardTitle>Keluhan Terbanyak<\/CardTitle>/)
})

test("maksimal tiga tindakan terbesar tampil terpisah, sisanya digabung", () => {
  const { slices } = buildTreatmentComposition(
    rows({ Istirahat: 40, Kompres: 30, Obat: 20, Rujuk: 6, Minum: 4 }),
  )

  assert.equal(slices.length, COMPOSITION_SLICE_LIMIT + 1)
  assert.deepEqual(
    slices.map((slice) => slice.label),
    ["Istirahat", "Kompres", "Obat", "Tindakan lainnya"],
  )

  const other = slices.at(-1)!
  assert.equal(other.key, OTHER_COMPOSITION_KEY)
  assert.equal(other.count, 10)
  assert.deepEqual(other.merged, ["Rujuk", "Minum"])
  // Urut dari terbesar ke terkecil.
  const counts = slices.map((slice) => slice.count)
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a))
})

test("tiga kategori atau kurang tidak memunculkan baris gabungan", () => {
  const { slices } = buildTreatmentComposition(rows({ Istirahat: 5, Kompres: 3, Obat: 1 }))
  assert.equal(slices.length, 3)
  assert.ok(!slices.some((slice) => slice.key === OTHER_COMPOSITION_KEY))
})

test("penggabungan tidak mengubah data asli maupun jumlah total", () => {
  const source = rows({ A: 9, B: 7, C: 5, D: 3, E: 1 })
  const snapshot = JSON.parse(JSON.stringify(source))
  const { slices, total } = buildTreatmentComposition(source)

  assert.deepEqual(source, snapshot)
  assert.equal(total, 25)
  assert.equal(
    slices.reduce((sum, slice) => sum + slice.count, 0),
    25,
  )
  assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.share, 0) - 100) < 1e-9)
})

test("total sampai 100: satu kotak satu kunjungan", () => {
  const data = rows({ Istirahat: 40, Kompres: 30, Obat: 25, Rujuk: 5 })
  const composition = buildTreatmentComposition(data)

  assert.equal(composition.approximate, false)
  assert.equal(composition.boxes.length, 100)
  assert.deepEqual(
    composition.slices.map((slice) => slice.boxes),
    composition.slices.map((slice) => slice.count),
  )

  const html = render({ rows: data, emptyLabel: "kosong" })
  assert.equal(countBoxes(html), 100)
  assert.match(html, /Setiap kotak mewakili 1 kunjungan\./)

  const small = rows({ Istirahat: 7, Kompres: 2 })
  assert.equal(countBoxes(render({ rows: small, emptyLabel: "kosong" })), 9)
})

test("total di atas 100: tepat 100 kotak dan keterangan perkiraan", () => {
  const data = rows({ Istirahat: 401, Kompres: 233, Obat: 97, Rujuk: 41, Minum: 7 })
  const composition = buildTreatmentComposition(data)

  assert.equal(composition.approximate, true)
  assert.equal(composition.boxes.length, WAFFLE_BOX_LIMIT)
  assert.equal(
    composition.slices.reduce((sum, slice) => sum + slice.boxes, 0),
    WAFFLE_BOX_LIMIT,
  )

  const html = render({ rows: data, emptyLabel: "kosong" })
  assert.equal(countBoxes(html), WAFFLE_BOX_LIMIT)
  assert.match(html, /Setiap kotak mewakili sekitar 1% kunjungan\./)
})

test("pembulatan proporsional selalu menjumlah tepat dan deterministik", () => {
  // Tiga sepertiga dan tujuh sepertujuh adalah kasus klasik yang meleset bila
  // tiap kategori dibulatkan sendiri-sendiri.
  assert.deepEqual(allocateBoxes([1, 1, 1], 100), [34, 33, 33])
  assert.deepEqual(allocateBoxes([1, 1, 1, 1, 1, 1, 1], 100), [15, 15, 14, 14, 14, 14, 14])
  assert.deepEqual(allocateBoxes([1], 100), [100])
  assert.deepEqual(allocateBoxes([0, 0], 100), [0, 0])
  assert.deepEqual(allocateBoxes([5, 5], 0), [0, 0])

  for (const counts of [
    [401, 233, 97, 41],
    [1, 2, 3, 994],
    [333, 333, 334],
    [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
    [999999, 1],
  ]) {
    const boxes = allocateBoxes(counts, WAFFLE_BOX_LIMIT)
    assert.equal(
      boxes.reduce((sum, value) => sum + value, 0),
      WAFFLE_BOX_LIMIT,
      `jumlah kotak untuk ${counts.join("/")}`,
    )
    assert.ok(
      boxes.every((value) => value >= 0),
      "alokasi tidak boleh negatif",
    )
    // Data yang sama harus menghasilkan tampilan yang sama.
    assert.deepEqual(allocateBoxes(counts, WAFFLE_BOX_LIMIT), boxes)
  }
})

test("jumlah dan persentase legenda konsisten dengan kotak yang dirender", () => {
  const data = rows({ Istirahat: 401, Kompres: 233, Obat: 97, Rujuk: 41 })
  const composition = buildTreatmentComposition(data)
  const html = render({ rows: data, emptyLabel: "kosong" })

  for (const slice of composition.slices) {
    assert.ok(html.includes(`>${slice.count}</span>`), `jumlah ${slice.label}`)
    assert.ok(
      html.includes(`${slice.share.toFixed(1).replace(".", ",")}%`),
      `persentase ${slice.label}`,
    )
    const rendered = composition.boxes.filter((key) => key === slice.key).length
    assert.equal(rendered, slice.boxes, `kotak ${slice.label}`)
  }
})

test("empty state tidak merender kotak maupun NaN", () => {
  for (const data of [[], rows({ Kosong: 0 })]) {
    const html = render({ rows: data, emptyLabel: "Belum ada data tindakan pada pilihan ini." })
    assert.match(html, /Belum ada data tindakan pada pilihan ini\./)
    assert.equal(countBoxes(html), 0)
    assert.doesNotMatch(html, /NaN/)
  }

  // Sumber kosong memang menghasilkan peringkat kosong, bukan baris nol.
  assert.deepEqual(rankTerms([], COMPOSITION_SLICE_LIMIT), [])
  const empty = buildTreatmentComposition([])
  assert.deepEqual(empty, { slices: [], total: 0, boxes: [], approximate: false })
})

test("nama tindakan panjang dibungkus, bukan dipotong", () => {
  const long = "Diistirahatkan di UKS lalu wali kelas dihubungi dan orang tua diminta menjemput"
  const html = render({ rows: rows({ [long]: 3, Kompres: 1 }), emptyLabel: "kosong" })

  assert.ok(html.includes(long), "nama panjang tampil utuh")
  assert.match(html, /break-words/)
  assert.match(html, /text-pretty/)
  assert.doesNotMatch(html, /truncate|text-ellipsis|whitespace-nowrap/)
})

test("sorotan dapat dipakai dengan papan tik dan tidak hanya mengandalkan warna", () => {
  const data = rows({ Istirahat: 40, Kompres: 30, Obat: 20, Rujuk: 6, Minum: 4 })
  const html = render({ rows: data, emptyLabel: "kosong" })

  // Baris legenda adalah tombol sungguhan: dapat difokus, dapat ditekan
  // dengan Enter/Spasi, dan menyatakan keadaan aktifnya.
  const legendButtons = html.match(/<button[^>]*aria-pressed="false"/g) ?? []
  assert.equal(legendButtons.length, data.length - 1)
  assert.match(html, /focus-visible:ring-2/)

  // Satu perhentian papan tik per kategori, bukan seratus.
  const focusable = (html.match(/tabindex="0"/g) ?? []).length
  assert.equal(focusable, 4)
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 100 - 4)

  // Kategori tetap dapat dikenali tanpa melihat warna.
  assert.match(html, /aria-label="Komposisi tindakan dari 100 entri tindakan\./)
  assert.match(html, /title="Istirahat, 40 kunjungan, 40,0%"/)
  assert.match(html, /aria-label="Istirahat, 40 kunjungan, 40,0%"/)
})

test("penyaring keluhan lama tetap utuh", () => {
  const source = read("components/e-uks/euks-complaint-treatment-insights.tsx")

  assert.match(source, /aria-label="Saring menurut keluhan"/)
  assert.match(source, /<SelectItem value=\{ALL_COMPLAINTS\}>Semua Keluhan<\/SelectItem>/)
  assert.match(source, /treatmentByComplaint\[row\.key\] !== undefined/)
  assert.match(source, /treatmentByComplaint\[selectedRow\.key\] \?\? \[\]/)
  // Penyaring memenuhi lebar di ponsel dan kembali ke samping judul di desktop.
  assert.match(source, /flex flex-col gap-2 sm:flex-row/)
  assert.match(source, /w-full sm:w-52/)
})

test("catatan metodologis tidak menyiratkan tingkat atau keparahan", () => {
  const source = read("components/e-uks/euks-complaint-treatment-insights.tsx")
  assert.match(
    source,
    /Komposisi dihitung berdasarkan tindakan yang dicatat pada setiap kunjungan\./,
  )
  assert.doesNotMatch(source, /posisi relatif|tingkat keparahan|skor/)
})
