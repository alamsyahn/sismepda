import { strict as assert } from "node:assert"
import { test } from "node:test"

import { resolveTrustedOrigins, verifySameOrigin } from "../lib/same-origin"

const TRUSTED = ["https://sekolah.example.id"]

function request(headers: Record<string, string>, method = "POST") {
  return { method, headers: new Headers(headers) }
}

test("permintaan aman dilewatkan tanpa memeriksa origin", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const result = verifySameOrigin(request({}, method), TRUSTED)
    assert.equal(result.ok, true)
  }
})

test("Origin yang cocok diterima", () => {
  const result = verifySameOrigin(
    request({ origin: "https://sekolah.example.id" }),
    TRUSTED,
  )
  assert.equal(result.ok, true)
})

test("Origin lintas situs ditolak", () => {
  const result = verifySameOrigin(
    request({ origin: "https://penyerang.example.com" }),
    TRUSTED,
  )
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
})

test("Origin yang hanya berakhiran sama ditolak", () => {
  // "evil-sekolah.example.id" tidak boleh lolos oleh pencocokan akhiran.
  const result = verifySameOrigin(
    request({ origin: "https://evil-sekolah.example.id" }),
    TRUSTED,
  )
  assert.equal(result.ok, false)
})

test("skema dan port ikut dibandingkan", () => {
  assert.equal(verifySameOrigin(request({ origin: "http://sekolah.example.id" }), TRUSTED).ok, false)
  assert.equal(
    verifySameOrigin(request({ origin: "https://sekolah.example.id:8443" }), TRUSTED).ok,
    false,
  )
})

test("mutasi tanpa header Origin ditolak", () => {
  // Fail closed: klien browser modern selalu mengirim Origin pada mutasi.
  const result = verifySameOrigin(request({}), TRUSTED)
  assert.equal(result.ok, false)
})

test("Origin null (sandbox/redirect lintas situs) ditolak", () => {
  assert.equal(verifySameOrigin(request({ origin: "null" }), TRUSTED).ok, false)
})

test("header Host atau X-Forwarded-Host tidak pernah membuat origin dipercaya", () => {
  const result = verifySameOrigin(
    request({
      origin: "https://penyerang.example.com",
      host: "penyerang.example.com",
      "x-forwarded-host": "penyerang.example.com",
    }),
    TRUSTED,
  )
  assert.equal(result.ok, false)
})

test("origin tepercaya berasal dari konfigurasi eksplisit, bukan dari header", () => {
  const origins = resolveTrustedOrigins({
    APP_ORIGIN: "https://sekolah.example.id",
    AUTH_URL: "https://lain.example.id/api/auth",
  })
  assert.ok(origins.includes("https://sekolah.example.id"))
  // AUTH_URL dinormalisasi menjadi origin-nya saja.
  assert.ok(origins.includes("https://lain.example.id"))
  assert.equal(origins.some((origin) => origin.includes("/api/auth")), false)
})

test("tanpa konfigurasi, origin localhost dev diterima dan produksi tidak menebak", () => {
  const dev = resolveTrustedOrigins({ NODE_ENV: "development" })
  assert.ok(dev.some((origin) => origin.startsWith("http://localhost")))

  const production = resolveTrustedOrigins({ NODE_ENV: "production" })
  assert.deepEqual(production, [])
})

test("daftar tepercaya kosong menolak semua mutasi, bukan mengizinkan semua", () => {
  const result = verifySameOrigin(request({ origin: "https://sekolah.example.id" }), [])
  assert.equal(result.ok, false)
})
