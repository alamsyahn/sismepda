/**
 * Grup tujuan: default, override, dan resolver yang dipakai bersama.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Sebelum fitur ini, tujuan pengiriman adalah satu JID per jenis pesan yang
 * hanya dapat diisi dengan MENGETIK NAMA grup, lalu diterjemahkan server. Nama
 * grup dapat berubah dan dapat kembar, sehingga identitas tujuan tidak pernah
 * benar-benar stabil.
 *
 * Yang dijaga berkas ini adalah satu janji: **JID adalah identitas, nama hanya
 * tampilan**. Semua yang lain — default, override, pengaktifan otomatis,
 * pengiriman manual — mengikuti janji itu.
 *
 * Seluruh test di sini murni: tidak ada database dan tidak ada akun WhatsApp,
 * karena aturan tujuan harus dapat diperiksa tanpa keduanya.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  AUTOMATIC_BLOCK_MESSAGES,
  STALE_DESTINATION_MESSAGE,
  automaticBlockFor,
  destinationDisplay,
  isGroupJid,
  resolveDestination,
  type DefaultDestination,
  type ReportDestination,
} from "../lib/whatsapp-target"
import type { WhatsAppGroup } from "../lib/whatsapp-transport"

const GURU: WhatsAppGroup = { jid: "120363111111111@g.us", name: "Guru SMPN 2 Blitar" }
const WALI: WhatsAppGroup = { jid: "120363222222222@g.us", name: "Wali Kelas SMPN 2 Blitar" }

const DEFAULT_SET: DefaultDestination = { jid: GURU.jid, name: GURU.name }
const NO_DEFAULT: DefaultDestination = { jid: null, name: null }

const FOLLOWS_DEFAULT: ReportDestination = { mode: "DEFAULT", jid: null, name: null }
const OVERRIDES: ReportDestination = { mode: "OVERRIDE", jid: WALI.jid, name: WALI.name }

// ── Resolver ────────────────────────────────────────────────────────────────

test("laporan tanpa override memakai grup default", () => {
  const target = resolveDestination(FOLLOWS_DEFAULT, DEFAULT_SET)

  assert.equal(target.status, "RESOLVED")
  assert.equal(target.status === "RESOLVED" && target.jid, GURU.jid)
})

test("laporan dengan override memakai grup override, bukan default", () => {
  const target = resolveDestination(OVERRIDES, DEFAULT_SET)

  assert.equal(target.status, "RESOLVED")
  assert.equal(target.status === "RESOLVED" && target.jid, WALI.jid)
})

test("dua laporan dapat menunjuk grup berbeda pada saat yang sama", () => {
  // Inilah alasan tujuan tidak boleh satu nilai global.
  const a = resolveDestination(FOLLOWS_DEFAULT, DEFAULT_SET)
  const b = resolveDestination(OVERRIDES, DEFAULT_SET)

  assert.notEqual(
    a.status === "RESOLVED" && a.jid,
    b.status === "RESOLVED" && b.jid,
  )
})

test("default kosong berarti laporan yang mengikutinya tidak punya tujuan", () => {
  assert.equal(resolveDestination(FOLLOWS_DEFAULT, NO_DEFAULT).status, "NOT_RESOLVED")
})

test("mode override tanpa JID tidak diam-diam jatuh ke default", () => {
  // Admin yang memilih \"grup berbeda\" sedang menyatakan laporan ini TIDAK boleh
  // ikut default. Menebak berarti mengirim ke grup yang justru dihindari.
  const target = resolveDestination({ mode: "OVERRIDE", jid: null, name: null }, DEFAULT_SET)

  assert.equal(target.status, "NOT_RESOLVED")
})

test("JID tersimpan yang tidak berbentuk JID grup membatalkan pengiriman", () => {
  const target = resolveDestination(
    { mode: "OVERRIDE", jid: "628123456789@s.whatsapp.net", name: "Nomor pribadi" },
    DEFAULT_SET,
  )

  // Nomor perorangan bukan grup. Lebih baik batal daripada mengirim rekap
  // seluruh sekolah ke satu orang.
  assert.equal(target.status, "INVALID")
})

test("JID adalah identitas, nama hanya tampilan", () => {
  assert.ok(isGroupJid(GURU.jid))
  assert.ok(!isGroupJid("Guru SMPN 2 Blitar"))
})

// ── Nama grup berubah ───────────────────────────────────────────────────────

test("nama grup berubah tetapi JID sama: tujuan tetap grup yang sama", () => {
  const renamed: WhatsAppGroup = { jid: GURU.jid, name: "Guru & Tendik SMPN 2 Blitar" }

  const target = resolveDestination(FOLLOWS_DEFAULT, DEFAULT_SET)
  const display = destinationDisplay(FOLLOWS_DEFAULT, DEFAULT_SET, [renamed])

  // Tujuan tidak bergeser …
  assert.equal(target.status === "RESOLVED" && target.jid, GURU.jid)
  // … dan yang ditampilkan adalah nama TERBARU, bukan snapshot lama.
  assert.equal(display.label, "Guru & Tendik SMPN 2 Blitar")
})

test("JID tersimpan hilang dari daftar: ditandai, tidak diganti diam-diam", () => {
  const display = destinationDisplay(FOLLOWS_DEFAULT, DEFAULT_SET, [WALI])

  assert.equal(display.kind, "STALE")
  // Yang ditampilkan tetap grup tersimpan — bukan WALI, satu-satunya grup yang
  // tersedia. Mengganti otomatis akan memindahkan tujuan tanpa sepengetahuan
  // siapa pun.
  assert.equal(display.label, GURU.name)
  assert.match(STALE_DESTINATION_MESSAGE, /tidak ditemukan/)
})

test("daftar grup tidak diketahui tidak dianggap sebagai grup hilang", () => {
  // `null` = belum terhubung atau fetch gagal. Pilihan tersimpan tetap utuh.
  const display = destinationDisplay(FOLLOWS_DEFAULT, DEFAULT_SET, null)

  assert.notEqual(display.kind, "STALE")
  assert.equal(display.label, GURU.name)
})

test("tujuan yang belum dipilih dilaporkan sebagai belum dipilih", () => {
  assert.equal(destinationDisplay(FOLLOWS_DEFAULT, NO_DEFAULT, []).kind, "MISSING")
})

// ── Pengaktifan otomatis ────────────────────────────────────────────────────

test("default kosong: otomatis tidak boleh diaktifkan", () => {
  const block = automaticBlockFor(FOLLOWS_DEFAULT, NO_DEFAULT)

  assert.equal(block, "NO_DEFAULT")
  assert.match(AUTOMATIC_BLOCK_MESSAGES.NO_DEFAULT, /Pilih grup tujuan terlebih dahulu/)
})

test("mode override tetapi override kosong: otomatis tidak boleh diaktifkan", () => {
  const block = automaticBlockFor({ mode: "OVERRIDE", jid: null, name: null }, DEFAULT_SET)

  // Default terisi, tetapi laporan ini tidak memakainya.
  assert.equal(block, "NO_OVERRIDE")
})

test("tujuan sah: otomatis boleh diaktifkan", () => {
  assert.equal(automaticBlockFor(FOLLOWS_DEFAULT, DEFAULT_SET), null)
  assert.equal(automaticBlockFor(OVERRIDES, NO_DEFAULT), null)
})

// ── Satu resolver untuk kedua jalur kirim ───────────────────────────────────

const SERVER = "lib/server-whatsapp.ts"
const ROUTE = "app/api/whatsapp/configuration/route.ts"

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("pengiriman terjadwal dan manual memakai resolver yang sama", () => {
  const server = read(SERVER)

  // Keduanya melewati sendWhatsAppMessage, dan di sanalah satu-satunya
  // pemanggilan resolveDestination berada. Dua jalur yang menghitung tujuan
  // sendiri-sendiri pasti berbeda suatu saat, dan bedanya baru ketahuan setelah
  // pesan mendarat di grup yang salah.
  assert.equal(server.split("resolveDestination(").length - 1, 1)
  assert.match(server, /export async function sendWhatsAppMessage/)
})

test("tujuan tidak dikonfigurasi dilaporkan SKIPPED, bukan melempar", () => {
  const server = read(SERVER)

  // Scheduler tidak boleh mati hanya karena satu jenis pesan belum punya
  // tujuan, dan tidak boleh mengirim ke grup sembarang.
  assert.match(server, /reason: "NO_TARGET"/)
  assert.match(server, /reason: "INVALID_TARGET"/)
})

test("penjagaan otomatis dijalankan server, bukan hanya UI", () => {
  const route = read(ROUTE)

  assert.match(route, /automaticBlockFor\(/)
  assert.match(route, /AUTOMATIC_BLOCK_MESSAGES\[block\]/)
})

test("tujuan dipilih dengan JID, bukan dengan nama", () => {
  const route = read(ROUTE)

  // Menerima nama berarti menerjemahkan ulang setiap kali menyimpan.
  assert.match(route, /refine\(isGroupJid/)
  assert.ok(!/targetGroupName: z\.string/.test(route))
})

test("mengubah konfigurasi menuntut izin kelola, bukan izin baca", () => {
  const route = read(ROUTE)

  assert.match(route, /requireWhatsAppConnectionManager\(\)/)
  // Izin baca hanya untuk GET.
  assert.equal(route.split("requireWhatsAppViewer()").length - 1, 1)
})
