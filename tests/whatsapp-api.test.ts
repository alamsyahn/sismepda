/**
 * API WhatsApp: otorisasi dan jejak audit.
 *
 * Yang dijaga di sini adalah janji-janji yang tidak terlihat oleh tsc maupun
 * lint: bahwa setiap endpoint menuntut izin yang setara dengan konsekuensinya,
 * bahwa kode QR tidak bocor ke pemegang izin baca, dan bahwa setiap aksi
 * meninggalkan jejak.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

import { PERMISSIONS, isKnownPermission, validateRegistry } from "../lib/rbac-permissions"

const ROOT = process.cwd()

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

/** Buang komentar agar assertion memeriksa kode, bukan prosa penjelas. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const STATUS_ROUTE = "app/api/whatsapp/route.ts"
const CONNECTION_ROUTE = "app/api/whatsapp/connection/route.ts"
const QR_ROUTE = "app/api/whatsapp/qr/route.ts"
const SEND_ROUTE = "app/api/whatsapp/send/route.ts"
const CONFIG_ROUTE = "app/api/whatsapp/configuration/route.ts"

test("registry permission tetap valid setelah penambahan WhatsApp", () => {
  assert.deepEqual(validateRegistry(), [])
})

test("tiga permission WhatsApp terdaftar dan terpisah", () => {
  for (const key of ["whatsapp.read", "whatsapp.connection.manage", "whatsapp.send"]) {
    assert.ok(isKnownPermission(key), `${key} harus terdaftar`)
  }
})

test("kelola koneksi dan kirim ditandai sensitif, membaca tidak", () => {
  const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]))

  // Memutus koneksi menghentikan seluruh pengiriman otomatis sampai ada yang
  // memindai QR lagi; mengirim menghasilkan pesan nyata yang tak bisa ditarik.
  assert.equal(byKey.get("whatsapp.connection.manage")?.sensitive, true)
  assert.equal(byKey.get("whatsapp.send")?.sensitive, true)

  // Melihat status tidak mengubah apa pun, jadi menandainya sensitif hanya
  // akan melemahkan arti penanda itu pada permission yang benar-benar berbahaya.
  assert.notEqual(byKey.get("whatsapp.read")?.sensitive, true)
})

test("kirim dan kelola koneksi bergantung pada izin baca", () => {
  const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]))
  assert.ok(byKey.get("whatsapp.connection.manage")?.dependsOn?.includes("whatsapp.read"))
  assert.ok(byKey.get("whatsapp.send")?.dependsOn?.includes("whatsapp.read"))
})

test("setiap endpoint menuntut izin yang setara dengan konsekuensinya", () => {
  assert.match(codeOnly(read(STATUS_ROUTE)), /requireWhatsAppViewer\(\)/)
  assert.match(codeOnly(read(CONNECTION_ROUTE)), /requireWhatsAppConnectionManager\(\)/)
  assert.match(codeOnly(read(SEND_ROUTE)), /requireWhatsAppSender\(\)/)

  // QR dijaga izin KELOLA, bukan izin baca: memindainya menautkan perangkat
  // mana pun ke akun WhatsApp sekolah.
  assert.match(codeOnly(read(QR_ROUTE)), /requireWhatsAppConnectionManager\(\)/)

  const config = codeOnly(read(CONFIG_ROUTE))
  assert.match(config, /requireWhatsAppViewer\(\)/)
  assert.match(config, /requireWhatsAppConnectionManager\(\)/)
})

test("tidak ada endpoint WhatsApp yang hanya memeriksa login", () => {
  for (const route of [STATUS_ROUTE, CONNECTION_ROUTE, QR_ROUTE, SEND_ROUTE, CONFIG_ROUTE]) {
    const source = codeOnly(read(route))
    assert.ok(
      !/requireUser\(\)/.test(source),
      `${route} harus menuntut permission, bukan sekadar sesi login`,
    )
    // Nama role tidak pernah diperiksa langsung; keputusan selalu lewat evaluator.
    assert.ok(
      !/system_admin|role\s*===/.test(source),
      `${route} tidak boleh memeriksa nama role`,
    )
  }
})

test("kode QR tidak ikut dalam payload status maupun aksi koneksi", () => {
  for (const route of [STATUS_ROUTE, CONNECTION_ROUTE]) {
    assert.match(
      codeOnly(read(route)),
      /withoutQr\(/,
      `${route} harus membuang QR sebelum mengembalikan status`,
    )
  }
})

test("setiap aksi yang mengubah keadaan meninggalkan jejak audit", () => {
  for (const route of [CONNECTION_ROUTE, SEND_ROUTE, CONFIG_ROUTE]) {
    assert.match(
      codeOnly(read(route)),
      /recordAuditLog\(/,
      `${route} harus mencatat ke jejak audit`,
    )
  }
})

test("endpoint yang hanya membaca tidak menulis audit", () => {
  // Mencatat setiap pembacaan akan menenggelamkan jejak audit yang justru
  // dipakai untuk menelusuri perubahan.
  for (const route of [STATUS_ROUTE, QR_ROUTE]) {
    assert.ok(
      !/recordAuditLog\(/.test(codeOnly(read(route))),
      `${route} tidak perlu menulis audit`,
    )
  }
})

test("kirim manual tidak meminjam slot jadwal", () => {
  const source = codeOnly(read(SEND_ROUTE))

  // Satu jenis pesan bisa punya beberapa slot (08:00 dan 10:00). Meminjam
  // salah satunya membuat kiriman manual tampak seperti kiriman terjadwal di
  // kartu jadwal dan histori.
  assert.match(source, /MANUAL_SLOT/)
  assert.ok(
    !/definition\.slots\[0\]|slots\[0\]/.test(source),
    "slot manual tidak boleh diambil dari daftar slot jadwal",
  )
})

test("worker memaksa trigger MANUAL, tidak mempercayai body", () => {
  const worker = codeOnly(read("scripts/whatsapp-worker.mts"))

  // Bila trigger diambil dari body, pemanggil bisa menyamar sebagai kiriman
  // terjadwal dan menulis idempotencyKey yang memblokir jadwal hari itu.
  assert.match(worker, /trigger:\s*"MANUAL"/)
  assert.ok(
    !/trigger:\s*body\.trigger/.test(worker),
    "trigger tidak boleh berasal dari body permintaan",
  )
})

test("nama grup ambigu tidak mungkin terjadi: tujuan dipilih dengan JID", () => {
  const source = codeOnly(read(CONFIG_ROUTE))

  // Dahulu tujuan diisi dengan MENGETIK nama grup, sehingga route harus
  // menolak nama kembar (409 AMBIGUOUS). Sekarang admin memilih dari daftar
  // dan yang dikirim adalah JID, jadi kelas kesalahan itu hilang di sumbernya
  // — bukan ditangani, melainkan tidak dapat terjadi.
  assert.match(source, /refine\(isGroupJid/)
  assert.ok(
    !/AMBIGUOUS/.test(source),
    "penyelesaian nama grup seharusnya sudah tidak ada di route konfigurasi",
  )
})

test("jam jadwal yang masuk lewat API selalu dinormalisasi ulang di server", () => {
  const source = codeOnly(read(CONFIG_ROUTE))

  // Jam kini memang dapat disunting admin — dahulu tes ini melarangnya, karena
  // jadwal hidup sebagai konstanta di kode. Yang tersisa untuk dijaga adalah
  // batasnya: klien bukan penjaga. Permintaan dapat datang tanpa melewati
  // layar, jadi format, duplikat, dan urutan diperiksa ulang di sini.
  assert.ok(source.includes("normalizeSlots("), "server wajib menormalisasi jam")
  assert.ok(source.includes("slotsErrorMessage("), "penolakan harus dapat dibaca admin")
})
