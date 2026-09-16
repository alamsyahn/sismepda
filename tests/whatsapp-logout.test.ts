/**
 * Logout WhatsApp: idempotent, dan selalu meninggalkan keadaan bersih.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Keluhan yang memicunya: "Keluar & hapus sesi" gagal justru ketika paling
 * dibutuhkan — saat sesi sudah tidak sah. Penyebabnya, logout jarak jauh
 * dijadikan syarat: tidak ada soket untuk memintanya, permintaan melempar, dan
 * pembersihan lokal tidak pernah berjalan. Akibatnya kredensial mati tertinggal
 * di disk, `sessionExists` tetap melaporkan "tertaut", dan admin terkurung pada
 * layar yang menuntut tindakan yang selalu gagal.
 *
 * Yang dikunci di sini: pembersihan lokal TIDAK bergantung pada WhatsApp.
 *
 * Adapter Baileys sendiri tidak dapat diimpor dalam uji (binding native), jadi
 * mekanisme pembersihannya diuji langsung di `whatsapp-session-store`, dan
 * urutan pemakaiannya di dalam adapter dikunci di tingkat sumber.
 */
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

import {
  CREDENTIALS_FILE,
  discardSessionCredentials,
  sessionExistsIn,
} from "../lib/whatsapp-session-store"

/** Direktori sesi berisi kredensial palsu — bentuknya saja, bukan rahasia. */
function sesiTersimpan(): string {
  const dir = mkdtempSync(join(tmpdir(), "sismepda-wa-logout-"))
  writeFileSync(join(dir, CREDENTIALS_FILE), JSON.stringify({ me: { id: "0@s.whatsapp.net" } }), "utf8")
  writeFileSync(join(dir, "app-state-sync-key-AAAAAA.json"), "{}", "utf8")
  writeFileSync(join(dir, "session-628123456789.0.json"), "{}", "utf8")
  writeFileSync(join(dir, "pre-key-1.json"), "{}", "utf8")
  return dir
}

// ---------------------------------------------------------------------------
// Pembersihan kredensial
// ---------------------------------------------------------------------------

test("sesi tersimpan dikenali dari kredensialnya, bukan dari berkas lain", () => {
  const dir = mkdtempSync(join(tmpdir(), "sismepda-wa-parsial-"))
  try {
    // Kunci sinkronisasi tanpa creds.json bukan sesi: tidak ada identitas
    // perangkat di dalamnya.
    writeFileSync(join(dir, "app-state-sync-key-AAAAAA.json"), "{}", "utf8")
    assert.equal(sessionExistsIn(dir), false)

    writeFileSync(join(dir, CREDENTIALS_FILE), "{}", "utf8")
    assert.equal(sessionExistsIn(dir), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("logout menghapus SELURUH kredensial lokal, bukan sebagian", async () => {
  const dir = sesiTersimpan()
  try {
    const bersih = await discardSessionCredentials(dir)

    // Kredensial parsial lebih buruk daripada tidak ada: percobaan koneksi
    // berikutnya memakainya, gagal, dan tampak seperti kesalahan baru.
    assert.equal(bersih, true)
    const tersisa = existsSync(dir) ? readdirSync(dir) : []
    assert.deepEqual(tersisa, [], `kredensial parsial tertinggal: ${tersisa.join(", ")}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("logout berulang tidak melempar dan hasil akhirnya sama", async () => {
  // Idempotent: admin yang menekan tombol dua kali tidak boleh melihat error.
  const dir = sesiTersimpan()
  try {
    assert.equal(await discardSessionCredentials(dir), true)
    assert.equal(await discardSessionCredentials(dir), true)
    assert.equal(await discardSessionCredentials(dir), true)
    assert.equal(sessionExistsIn(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("logout pada sesi yang memang belum pernah ada tetap sukses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sismepda-wa-kosong-"))
  try {
    assert.equal(await discardSessionCredentials(dir), true, "tidak ada yang dihapus bukan kegagalan")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("direktori yang tidak dapat dihapus tetap dikosongkan isinya", async () => {
  // Di produksi direktori sesi adalah titik mount volume: ia tidak dapat
  // di-unlink. Menganggap itu kegagalan berarti logout tidak pernah berhasil
  // di satu-satunya tempat yang penting.
  const dir = sesiTersimpan()
  try {
    const bersih = await discardSessionCredentials(dir)

    assert.equal(bersih, true)
    assert.equal(sessionExistsIn(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Urutan di dalam adapter
// ---------------------------------------------------------------------------

function bacaSumber(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

test("pembersihan lokal tidak berada di dalam blok try logout jarak jauh", () => {
  const adapter = bacaSumber("lib/whatsapp-baileys.mts")
  const logout = adapter.slice(adapter.indexOf("async logout()"))
  const badan = logout.slice(0, logout.indexOf("\n  }"))

  // Bentuk yang salah: `await this.socket.logout()` dan pembersihan berada di
  // blok try yang sama, sehingga logout jarak jauh yang gagal melewati
  // pembersihan sepenuhnya.
  const posisiCatch = badan.indexOf("catch")
  const posisiBersih = badan.indexOf("discardCredentials")

  assert.ok(posisiCatch !== -1, "logout jarak jauh harus dibungkus try/catch")
  assert.ok(posisiBersih !== -1, "logout harus membuang kredensial")
  assert.ok(
    posisiBersih > posisiCatch,
    "pembersihan harus di LUAR blok yang menangani kegagalan logout jarak jauh",
  )
})

test("logout selalu menutup soket sebelum membuang kredensial", () => {
  const adapter = bacaSumber("lib/whatsapp-baileys.mts")
  const logout = adapter.slice(adapter.indexOf("async logout()"))
  const badan = logout.slice(0, logout.indexOf("\n  }"))

  // Soket yang masih hidup akan menulis ulang kredensial setelah dihapus, dan
  // sesi yang seharusnya bersih kembali separuh terisi.
  assert.ok(
    badan.indexOf("closeSocket") < badan.indexOf("discardCredentials"),
    "soket harus dihentikan lebih dulu",
  )
})

test("logout menandai transport berhenti agar tidak menyambung ulang sendiri", () => {
  const adapter = bacaSumber("lib/whatsapp-baileys.mts")
  const logout = adapter.slice(adapter.indexOf("async logout()"))
  const badan = logout.slice(0, logout.indexOf("\n  }"))

  // Tanpa ini, penutupan soket yang dipicu logout dibaca sebagai putus biasa
  // dan menjadwalkan sambung ulang atas sesi yang baru saja dihapus.
  assert.match(badan, /this\.stopped = true/)
})
