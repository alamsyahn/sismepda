/**
 * Panel WhatsApp: kartu pesan, urutan, penjagaan, dan pesan manual.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Panel pernah merender daftar jenis pesan bawaan yang ditulis di kode klien.
 * Sejak kartu pesan tersimpan di basis data, daftar seperti itu berarti kartu
 * buatan admin tidak pernah muncul di layar meskipun sudah tersimpan dan sudah
 * dijadwalkan worker — kegagalan yang tidak menimbulkan error apa pun.
 *
 * Pemeriksaan dilakukan atas sumber panel, sejalan dengan
 * whatsapp-destination-panel.test.ts: yang dijaga adalah keputusan kondisional
 * yang bergantung pada state klien, sehingga tidak terlihat oleh render statis.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(
  new URL("../components/whatsapp/whatsapp-panel.tsx", import.meta.url),
  "utf8",
)

test("kartu dirender dari data server, bukan dari daftar jenis di kode klien", () => {
  // Inilah pencegah regresinya: begitu perulangan kembali memakai konstanta
  // jenis pesan, kartu manual dan kartu buatan admin lenyap dari layar.
  assert.match(source, /\{messages\.map\(\(message, index\) => \{/)
  assert.ok(!/WHATSAPP_SCHEDULE\.map/.test(source))
})

test("urutan kartu mengikuti server, tidak disusun ulang di browser", () => {
  // Tidak ada sort di klien: `sortOrder` yang tersimpan adalah satu-satunya
  // penentu urutan, agar layar sama setelah refresh maupun restart.
  assert.ok(!/messages\.sort|\[\.\.\.messages\]\.sort/.test(source))
  assert.match(source, /setMessages\(data\.messages \?\? \[\]\)/)
})

test("tombol naik/turun mengirim perintah geser, bukan urutan lengkap", () => {
  // Perintah relatif membuat dua admin yang menyusun ulang bersamaan tidak
  // saling menimpa; urutan akhir selalu dihitung server.
  assert.match(source, /body: JSON\.stringify\(\{ messageId: message\.id, direction \}\)/)
  assert.match(source, /void moveCard\(message, "UP"\)/)
  assert.match(source, /void moveCard\(message, "DOWN"\)/)
})

test("kartu teratas dan terbawah tidak dapat digeser keluar batas", () => {
  assert.match(source, /disabled=\{busy !== null \|\| index === 0\}/)
  assert.match(source, /disabled=\{busy !== null \|\| index === messages\.length - 1\}/)
})

test("status slot dicocokkan lewat messageId, bukan jenis pesan", () => {
  // Kartu buatan admin tidak punya jenis; mencocokkan lewat `type` membuat
  // badge jadwalnya selalu kosong.
  assert.match(source, /schedule\.filter\(\(row\) => row\.messageId === message\.id\)/)
})

test("penjagaan hari aktif tersimpan per kartu", () => {
  assert.match(
    source,
    /body: JSON\.stringify\(\{ messageId: message\.id, requireAttendanceActivity: required \}\)/,
  )
  assert.match(source, /checked=\{message\.requireAttendanceActivity\}/)
})

test("penjagaan hari aktif dijelaskan kepada admin", () => {
  assert.match(
    source,
    /Jika aktif, pesan otomatis tidak dikirim pada hari ketika tidak ada aktivitas absensi sekolah\./,
  )
})

test("kartu manual tidak menampilkan jadwal maupun toggle otomatis", () => {
  // Pesan manual tidak pernah dikirim penjadwal; menampilkan jadwal untuknya
  // menjanjikan perilaku yang tidak ada.
  assert.match(source, /\{canManageConnection && !isManual \? \(/)
  assert.match(source, /\{isManual \? null : canManageConnection \? \(/)
})

test("pesan manual dikirim persis seperti yang diketik, tanpa awalan", () => {
  // Badan permintaan hanya membawa teks apa adanya. Awalan seperti "PESAN
  // MANUAL" akan mengubah isi yang dibaca guru di grup.
  assert.match(
    source,
    /body: JSON\.stringify\(\{ messageId: message\.id, \.\.\.\(text === undefined \? \{\} : \{ text \}\) \}\)/,
  )
  assert.ok(!/PESAN MANUAL|Pesan dari admin/.test(source))
})

test("textarea baru dikosongkan setelah server memastikan terkirim", () => {
  // Mengosongkan lebih awal akan menghapus naskah yang baru ditulis admin
  // ketika pengiriman gagal, dan teks itu tidak dapat dikembalikan.
  assert.match(source, /if \(data\.status === "SENT"\) \{/)
  assert.match(source, /setManualText\(\(current\) => \(\{ \.\.\.current, \[message\.id\]: "" \}\)\)/)
})

test("pengiriman manual meminta konfirmasi lebih dulu", () => {
  assert.match(source, /setManualConfirm\(message\)/)
  assert.match(source, /Kirim pesan manual\?/)
})

test("tombol kirim manual mati saat teks kosong atau tujuan belum sah", () => {
  assert.match(
    source,
    /busy !== null \|\| !destinationReady \|\| draft\.trim\(\)\.length === 0/,
  )
})

test("keadaan belum terhubung dinyatakan pada kartu manual", () => {
  assert.match(
    source,
    /WhatsApp belum terhubung\. Hubungkan perangkat sebelum mengirim pesan\./,
  )
})

test("penyunting template hanya untuk kartu bawaan", () => {
  // Kartu buatan admin memakai templatenya sendiri; penyunting bawaan
  // mensyaratkan jenis pesan yang tidak dimiliki kartu tersebut.
  assert.match(source, /\{canManageConnection && message\.builtinType \? \(/)
})

test("riwayat menampilkan judul kartu, dengan cadangan untuk data lama", () => {
  assert.match(source, /row\.message\?\.title \?\?/)
})

test("perubahan kartu selalu memakai id, bukan jenis pesan", () => {
  // Jenis tidak dapat mengidentifikasi kartu buatan admin, dan judul dapat
  // berubah; id adalah satu-satunya identitas yang stabil.
  assert.ok(!/JSON\.stringify\(\{ type,/.test(source))
  assert.match(source, /body: JSON\.stringify\(\{ messageId: message\.id, enabled \}\)/)
  assert.match(source, /body: JSON\.stringify\(\{ messageId: message\.id, slots: normalized\.slots \}\)/)
})
