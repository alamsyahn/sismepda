import assert from "node:assert/strict"
import test from "node:test"

import { isMousePointer, nearestIndex, tooltipPlacement } from "@/lib/chart-tooltip"

test("pointer sentuh tidak dianggap mouse sehingga tooltip tap tidak langsung hilang", () => {
  // pointerleave terkirim tepat setelah touchend; hanya mouse yang boleh
  // menghapus titik aktif.
  assert.equal(isMousePointer({ pointerType: "mouse" }), true)
  assert.equal(isMousePointer({ pointerType: "touch" }), false)
  assert.equal(isMousePointer({ pointerType: "pen" }), false)
  // Event sintetis tanpa pointerType diperlakukan sebagai mouse.
  assert.equal(isMousePointer({}), true)
  assert.equal(isMousePointer({ pointerType: "" }), true)
})

test("titik di tengah kanvas memusatkan tooltip di atas titik", () => {
  const placement = tooltipPlacement(0.5, 0.6)
  assert.equal(placement.left, "50%")
  assert.equal(placement.top, "60%")
  assert.equal(placement.side, "top")
  assert.match(placement.transform, /translateX\(-50%\)/)
  assert.match(placement.transform, /translateY\(calc\(-100% - 10px\)\)/)
})

test("titik dekat tepi kiri menyandarkan tooltip ke kanan titik", () => {
  // Tanpa penyandaran, kartu yang dipusatkan akan menonjol keluar kartu induk.
  assert.match(tooltipPlacement(0.02, 0.5).transform, /translateX\(0\)/)
})

test("titik dekat tepi kanan menyandarkan tooltip ke kiri titik", () => {
  assert.match(tooltipPlacement(0.97, 0.5).transform, /translateX\(-100%\)/)
})

test("titik dekat tepi atas membalik tooltip ke bawah titik", () => {
  const placement = tooltipPlacement(0.5, 0.05)
  assert.equal(placement.side, "bottom")
  assert.match(placement.transform, /translateY\(10px\)/)
})

test("rasio di luar 0..1 dijepit, bukan dilanjutkan keluar kanvas", () => {
  assert.equal(tooltipPlacement(-3, 9).left, "0%")
  assert.equal(tooltipPlacement(-3, 9).top, "100%")
})

test("rasio bukan angka tidak menghasilkan posisi NaN", () => {
  // Domain yang seluruhnya nol pernah menghasilkan pembagian 0/0 pada chart;
  // tooltip tidak boleh ikut rusak karenanya.
  assert.equal(tooltipPlacement(Number.NaN, Number.NaN).left, "0%")
})

test("nearest-x memilih titik terdekat, bukan sekadar titik yang dilewati", () => {
  const positions = [0, 0.25, 0.5, 0.75, 1]
  assert.equal(nearestIndex(positions, 0.26), 1)
  assert.equal(nearestIndex(positions, 0.4), 2)
  assert.equal(nearestIndex(positions, 0.99), 4)
})

test("pada jarak sama, titik lebih awal yang dipilih", () => {
  assert.equal(nearestIndex([0, 1], 0.5), 0)
})

test("posisi pointer di luar kanvas tetap memilih titik ujung", () => {
  assert.equal(nearestIndex([0.2, 0.6], -5), 0)
  assert.equal(nearestIndex([0.2, 0.6], 5), 1)
})

test("seri kosong tidak menghasilkan indeks", () => {
  assert.equal(nearestIndex([], 0.5), null)
})
