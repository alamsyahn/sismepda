/**
 * Halaman WhatsApp Otomatis: batas bundel, navigasi, dan penurunan hak.
 *
 * Yang dijaga di sini adalah kegagalan yang tidak terlihat sampai `next build`
 * atau sampai seseorang tanpa hak membuka halaman.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

import { mainNav } from "../lib/nav"
import { isKnownPermission } from "../lib/rbac-permissions"
import { CONNECTION_STATE_LABELS } from "../lib/whatsapp-transport"

const ROOT = process.cwd()

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

/** Buang komentar agar assertion memeriksa kode, bukan prosa penjelas. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const PAGE = "app/whatsapp/page.tsx"
const PANEL = "components/whatsapp/whatsapp-panel.tsx"

test("panel klien tidak mengimpor modul server", () => {
  const panel = codeOnly(read(PANEL))

  // lib/server-*.ts mengimpor lib/prisma.ts, yang menarik `pg`. Mengimpor
  // NILAI dari sana ke komponen klien memecahkan `next build` dengan pesan
  // "Can't resolve 'util/types'", dan di dev hanya tampak sebagai 500 yang
  // menyesatkan.
  assert.ok(
    !/from "@\/lib\/server-/.test(panel),
    "komponen klien tidak boleh mengimpor lib/server-*",
  )
  assert.ok(
    !/from "@\/lib\/prisma"/.test(panel),
    "komponen klien tidak boleh mengimpor Prisma",
  )
  assert.ok(
    !/whatsapp-baileys/.test(panel),
    "Baileys tidak boleh sampai ke bundel klien",
  )
})

test("panel adalah komponen klien", () => {
  assert.match(read(PANEL), /^"use client"/)
})

test("halaman menentukan hak di server dan menurunkannya sebagai prop", () => {
  const page = codeOnly(read(PAGE))

  assert.match(page, /requireWhatsAppViewer\(\)/)
  assert.match(page, /can\("whatsapp\.connection\.manage"\)/)
  assert.match(page, /can\("whatsapp\.send"\)/)
  assert.match(page, /canManageConnection=\{/)
  assert.match(page, /canSend=\{/)

  // Klien tidak boleh menebak haknya sendiri dari peran atau dari sesi.
  const panel = codeOnly(read(PANEL))
  assert.ok(
    !/useSession|session\?\./.test(panel),
    "panel tidak boleh menyimpulkan hak dari sesi di browser",
  )
})

test("halaman mengarahkan ulang, bukan melempar, saat hak tidak cukup", () => {
  const page = codeOnly(read(PAGE))
  assert.match(page, /ForbiddenError/)
  assert.match(page, /UnauthorizedError/)
  assert.match(page, /redirect\("\/login"\)/)
})

test("navigasi memuat WhatsApp Otomatis dengan permission yang terdaftar", () => {
  const entries: { title: string; href?: string; permissions?: readonly string[] }[] = []
  for (const entry of mainNav) {
    if ("type" in entry && entry.type === "group") entries.push(...entry.children)
    else entries.push(entry as { title: string; href?: string; permissions?: readonly string[] })
  }

  const item = entries.find((entry) => entry.href === "/whatsapp")
  assert.ok(item, "menu /whatsapp harus ada")
  assert.deepEqual(item?.permissions, ["whatsapp.read"])
  for (const key of item?.permissions ?? []) {
    assert.ok(isKnownPermission(key), `${key} harus terdaftar di registry`)
  }
})

test("menu dijaga izin baca, bukan izin kelola", () => {
  // Menu yang menuntut izin kelola akan menyembunyikan halaman dari staf yang
  // memang hanya perlu memantau status dan histori.
  const entries: { href?: string; permissions?: readonly string[] }[] = []
  for (const entry of mainNav) {
    if ("type" in entry && entry.type === "group") entries.push(...entry.children)
    else entries.push(entry as { href?: string; permissions?: readonly string[] })
  }
  const item = entries.find((entry) => entry.href === "/whatsapp")
  assert.ok(!item?.permissions?.includes("whatsapp.connection.manage"))
  assert.ok(!item?.permissions?.includes("whatsapp.send"))
})

test("setiap status koneksi punya label bahasa Indonesia", () => {
  // Status mentah seperti WAITING_QR tidak boleh sampai ke layar admin.
  for (const [state, label] of Object.entries(CONNECTION_STATE_LABELS)) {
    assert.ok(label.length > 0, `${state} harus punya label`)
    assert.notEqual(label, state, `${state} tidak boleh ditampilkan mentah`)
  }

  const panel = read(PANEL)
  assert.match(panel, /CONNECTION_STATE_LABELS/)
})

test("tombol aksi hanya dirender bagi pemegang haknya", () => {
  const panel = codeOnly(read(PANEL))

  assert.match(panel, /canManageConnection \?/)
  assert.match(panel, /canSend \?/)
})

test("QR hanya diambil oleh pemegang izin kelola koneksi", () => {
  const panel = codeOnly(read(PANEL))

  // Endpoint QR sudah menolak pemanggil tanpa hak, tetapi menariknya terus
  // menerus dari layar setiap penonton hanya menghasilkan 403 berulang.
  assert.match(panel, /if \(!canManageConnection \|\| status\?\.state !== "WAITING_QR"\)/)
})

// --- pemulihan pairing QR -----------------------------------------------------
//
// Enam kegagalan di bawah ini semuanya pernah terjadi bersamaan dan tampak
// identik dari layar admin: "Terputus, alasan jaringan". Masing-masing dikunci
// terpisah agar perbaikannya tidak diam-diam kembali.

const ADAPTER = "lib/whatsapp-baileys.mts"
const WORKER = "scripts/whatsapp-worker.mts"
const QR_ROUTE = "app/api/whatsapp/qr/route.ts"
const WORKER_CLIENT = "lib/server-whatsapp-worker-client.ts"

test("adapter memakai versi WA Web, bukan versi metadata Baileys", () => {
  const adapter = codeOnly(read(ADAPTER))

  // `fetchLatestBaileysVersion` membaca metadata repositori Baileys, yang bisa
  // tertinggal dari yang benar-benar dilayani WhatsApp; handshake lalu ditolak
  // sebelum QR terbit.
  assert.match(adapter, /fetchLatestWaWebVersion\(\)/)
  assert.ok(
    !/fetchLatestBaileysVersion/.test(adapter),
    "versi harus diambil dari WA Web, bukan dari metadata Baileys",
  )

  // Versi tidak boleh dipatok keras: WhatsApp menaikkannya tanpa pemberitahuan.
  assert.ok(
    !/version:\s*\[\s*\d+/.test(adapter),
    "versi WA tidak boleh di-hardcode",
  )
})

test("identitas browser tetap WEB, bukan desktop", () => {
  const adapter = codeOnly(read(ADAPTER))

  // Subplatform desktop (WIN32/DARWIN) dilaporkan ditolak dengan 428 sebelum
  // QR terbit. Hanya identitas web yang merupakan jalur pairing QR didukung.
  assert.match(adapter, /Browsers\.ubuntu\("SISMEPDA"\)/)
  assert.ok(!/Browsers\.windows/.test(adapter), "identitas Windows Desktop ditolak WhatsApp")
  assert.ok(!/Browsers\.macOS/.test(adapter), "identitas macOS Desktop ditolak WhatsApp")
})

test("status putus tetap dapat didiagnosis dari log", () => {
  const adapter = codeOnly(read(ADAPTER))

  // Tanpa angka status mentah di log, 428/408/401 tidak dapat dibedakan dari
  // luar dan setiap kegagalan tampak sebagai gangguan jaringan.
  assert.match(adapter, /status=\$\{statusCode/)
  assert.match(adapter, /kategori=\$\{code\}/)
  assert.match(adapter, /state_sebelumnya=\$\{previousState\}/)
})

test("408 sebelum QR tidak dilaporkan sebagai gangguan jaringan", () => {
  const adapter = codeOnly(read(ADAPTER))

  // `connectionLost` dan `timedOut` SAMA-SAMA 408 di Baileys. Mencocokkan
  // lewat DisconnectReason membuat handshake yang gagal dilaporkan sebagai
  // masalah jaringan — persis keluhan yang memicu perbaikan ini.
  assert.match(adapter, /function describeDisconnect\(statusCode: number \| undefined, hadQr: boolean\)/)
  assert.match(adapter, /hadQr\s*$/m)
  assert.ok(
    !/case DisconnectReason\.connectionLost/.test(adapter),
    "pemetaan harus atas angka mentah, karena nilai enum bertabrakan",
  )

  // 428 harus punya kalimat sendiri, terpisah dari kalimat jaringan.
  assert.match(adapter, /case 428:/)
  assert.match(adapter, /HANDSHAKE_FAILED/)
})

test("QR dikirim sebagai gambar, bukan string mentah", () => {
  const route = codeOnly(read(QR_ROUTE))
  const panel = codeOnly(read(PANEL))

  // Payload mentah tidak dapat dipindai WhatsApp dan mudah tersalin dari
  // tangkapan layar; rendering berhenti di server.
  assert.match(route, /QRCode\.toDataURL/)
  assert.match(route, /qrImage/)
  assert.ok(!/qr: status\.qr/.test(route), "payload QR mentah tidak boleh dikirim ke browser")

  assert.match(panel, /data\.qrImage/)
  assert.match(panel, /<img/)
  assert.ok(
    !/<code[^>]*>\s*\{qr\}/.test(panel),
    "QR tidak boleh dirender sebagai teks",
  )

  // Label instruksi pairing harus ada agar admin tahu menu mana yang dibuka.
  assert.match(panel, /Perangkat tertaut/)
  assert.match(panel, /Tautkan perangkat/)
})

test("daftar grup tidak diminta sebelum CONNECTED", () => {
  const worker = codeOnly(read(WORKER))
  const client = codeOnly(read(WORKER_CLIENT))

  // Produksi membanjiri log dengan NOT_CONNECTED karena grup diminta pada
  // setiap muat halaman, jauh sebelum sesi terbentuk.
  assert.match(client, /workerGroups/)
  assert.match(client, /state !== "CONNECTED"/)

  // Worker menjawabnya sebagai keadaan wajar (409), bukan kegagalan 500.
  assert.match(worker, /code: "NOT_CONNECTED"/)
  assert.match(worker, /409/)
})

test("tidak ada QR, kredensial, atau token yang masuk log", () => {
  const adapter = read(ADAPTER)
  const worker = read(WORKER)

  for (const [name, source] of [["adapter", adapter], ["worker", worker]] as const) {
    const logged = [...source.matchAll(/console\.(log|error|warn)\(([\s\S]*?)\n\s*\)/g)]
      .map((match) => match[2])
      .join("\n")

    assert.ok(!/\bqr\b(?!_pernah)/.test(logged), `${name} tidak boleh mencatat payload QR`)
    assert.ok(!/creds|auth|TOKEN|token/.test(logged), `${name} tidak boleh mencatat kredensial`)
  }
})
