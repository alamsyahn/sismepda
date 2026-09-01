import assert from "node:assert/strict"
import test from "node:test"

import {
  appLogoUrl,
  DEFAULT_APP_FULL_NAME,
  DEFAULT_APP_LOGO_URL,
  DEFAULT_APP_NAME,
  detectAppLogoType,
  resolveAppFullName,
  resolveAppName,
} from "../lib/site-branding"

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0)
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)

test("mengenali format logo yang didukung dari magic bytes", () => {
  assert.equal(detectAppLogoType(PNG), "image/png")
  assert.equal(detectAppLogoType(JPEG), "image/jpeg")
  assert.equal(detectAppLogoType(WEBP), "image/webp")
})

test("menolak file yang bukan gambar meski ekstensinya menyerupai gambar", () => {
  // Skrip shell / executable stub.
  assert.equal(detectAppLogoType(bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e)), null)
  // ELF executable.
  assert.equal(detectAppLogoType(bytes(0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0)), null)
  // Windows PE executable.
  assert.equal(detectAppLogoType(bytes(0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0)), null)
})

test("menolak SVG karena dapat memuat script", () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
  assert.equal(detectAppLogoType(svg), null)
})

test("menolak file kosong dan file yang terlalu pendek", () => {
  assert.equal(detectAppLogoType(bytes()), null)
  assert.equal(detectAppLogoType(bytes(0x89, 0x50)), null)
})

test("RIFF tanpa penanda WEBP ditolak", () => {
  assert.equal(detectAppLogoType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20)), null)
})

test("URL logo memakai default saat belum ada logo custom", () => {
  assert.equal(appLogoUrl(null), DEFAULT_APP_LOGO_URL)
  assert.equal(appLogoUrl(undefined), DEFAULT_APP_LOGO_URL)
})

test("URL logo custom membawa cache buster dari waktu update", () => {
  const updatedAt = new Date("2026-09-02T10:00:00.000Z")
  assert.equal(appLogoUrl(updatedAt), `/app-logo?v=${updatedAt.getTime()}`)
  assert.equal(appLogoUrl(updatedAt.toISOString()), `/app-logo?v=${updatedAt.getTime()}`)
})

test("nama kosong atau hanya spasi kembali ke default", () => {
  assert.equal(resolveAppName(""), DEFAULT_APP_NAME)
  assert.equal(resolveAppName("   "), DEFAULT_APP_NAME)
  assert.equal(resolveAppName(null), DEFAULT_APP_NAME)
  assert.equal(resolveAppFullName(undefined), DEFAULT_APP_FULL_NAME)
})

test("nama custom dipertahankan dan dirapikan", () => {
  assert.equal(resolveAppName("  TEST APP  "), "TEST APP")
  assert.equal(resolveAppFullName(" Sistem Informasi Madrasah "), "Sistem Informasi Madrasah")
})
