import { strict as assert } from "node:assert"
import { test } from "node:test"

import { checkSvgPayload, detectEuksLogoType, euksHeroLogoUrl } from "../lib/euks-logo"

const encoder = new TextEncoder()
const svg = (body: string) => encoder.encode(body)

/** Kepala berkas raster asli, cukup untuk pemeriksaan magic bytes. */
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WEBP_HEAD = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

test("mengenali format logo yang didukung dari isi berkas", () => {
  assert.equal(detectEuksLogoType(JPEG_HEAD), "image/jpeg")
  assert.equal(detectEuksLogoType(PNG_HEAD), "image/png")
  assert.equal(detectEuksLogoType(WEBP_HEAD), "image/webp")
  assert.equal(detectEuksLogoType(svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml")
})

test("mengenali SVG di balik prolog XML, komentar, DOCTYPE, dan BOM", () => {
  const variants = [
    '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<!-- dibuat oleh editor --><svg viewBox="0 0 10 10"/>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>',
    '\uFEFF  \n<svg />',
    '<?xml version="1.0"?>\n<!-- catatan -->\n<svg\n  width="10">\n</svg>',
  ]
  for (const variant of variants) {
    assert.equal(detectEuksLogoType(svg(variant)), "image/svg+xml", variant.slice(0, 30))
  }
})

test("menolak berkas yang bukan gambar yang didukung", () => {
  // GIF: gambar, tetapi sengaja di luar daftar format yang diterima.
  assert.equal(detectEuksLogoType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), null)
  // PDF dan teks biasa.
  assert.equal(detectEuksLogoType(encoder.encode("%PDF-1.7")), null)
  assert.equal(detectEuksLogoType(encoder.encode("sekadar teks")), null)
  assert.equal(detectEuksLogoType(new Uint8Array()), null)
})

test("HTML yang menyelipkan <svg> tidak dianggap berkas SVG", () => {
  // Kalau deteksi hanya mencari '<svg' di mana saja, berkas seperti ini lolos.
  assert.equal(detectEuksLogoType(svg("<html><body><svg/></body></html>")), null)
  assert.equal(detectEuksLogoType(svg("<!DOCTYPE html><html><svg /></html>")), null)
  // Nama elemen yang kebetulan berawalan sama juga bukan SVG.
  assert.equal(detectEuksLogoType(svg("<svgfake/>")), null)
})

test("SVG bersih dinyatakan aman", () => {
  const clean = svg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#2f6f3e"/><circle cx="12" cy="12" r="5"/></svg>',
  )
  assert.deepEqual(checkSvgPayload(clean), { safe: true })
})

test("SVG bermuatan aktif ditolak beserta alasannya", () => {
  const hostile: Array<[string, string]> = [
    ['<svg><script>alert(1)</script></svg>', "script"],
    ['<svg onload="alert(1)"></svg>', "onload"],
    ['<svg><a href="javascript:alert(1)">x</a></svg>', "javascript:"],
    ['<svg><foreignObject><body/></foreignObject></svg>', "foreignObject"],
    ['<svg><iframe src="x"/></svg>', "iframe"],
    ['<svg><use href="https://luar.example/x.svg#a"/></svg>', "luar"],
    ['<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>', "entitas"],
  ]

  for (const [payload, hint] of hostile) {
    const result = checkSvgPayload(svg(payload))
    assert.equal(result.safe, false, `seharusnya ditolak: ${payload}`)
    if (!result.safe) assert.ok(result.reason.length > 0, `alasan kosong untuk ${hint}`)
  }
})

test("URL logo membawa penanda versi dan null saat berkas belum ada", () => {
  const updatedAt = new Date("2026-02-03T04:05:06.000Z")
  assert.equal(
    euksHeroLogoUrl("logo1", updatedAt),
    `/api/e-uks/hero-logos/logo1/logo?v=${updatedAt.getTime()}`,
  )
  assert.equal(euksHeroLogoUrl("logo1", null), null)
  assert.equal(euksHeroLogoUrl("logo1", undefined), null)
})
