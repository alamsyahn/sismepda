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
import {
  CONNECTION_STATE_DESCRIPTIONS,
  CONNECTION_STATE_LABELS,
  classifyDisconnect,
  errorMessageFor,
  type WhatsAppStatus,
} from "../lib/whatsapp-transport"

const ROOT = process.cwd()

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

/** Buang komentar agar assertion memeriksa kode, bukan prosa penjelas. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Argumen setiap pemanggilan console.*, dipotong dengan menghitung kurung.
 *
 * Versi regex non-greedy sebelumnya berhenti pada `\n)` PERTAMA, yang untuk
 * pemanggilan multi-baris menelan sisa berkas menjadi satu "argumen" raksasa.
 * Akibatnya pemeriksaan kebocoran di bawah ini lulus karena alasan yang salah
 * dan tidak akan pernah menunjuk baris yang benar.
 */
function consoleCalls(source: string): string[] {
  const calls: string[] = []
  const opener = /console\.(?:log|error|warn)\(/g
  while (opener.exec(source) !== null) {
    let index = opener.lastIndex
    let depth = 1
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === "(") depth += 1
      else if (char === ")") depth -= 1
      index += 1
    }
    calls.push(source.slice(opener.lastIndex, index - 1))
  }
  return calls
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
const TRANSPORT = "lib/whatsapp-transport.ts"

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
  // Field dicatat lewat `logEvent`, yang merangkai pasangan kunci=nilai dengan
  // stempel waktu. Yang dikunci adalah kehadiran field-nya, bukan bentuk
  // template literal tertentu.
  assert.match(adapter, /logEvent\("koneksi_tertutup", \{/)
  assert.match(adapter, /status: statusCode/)
  assert.match(adapter, /kategori: policy\.category/)
  assert.match(adapter, /state_sebelumnya: previousState/)
  assert.match(adapter, /this\.now\(\)\.toISOString\(\)/, "log tanpa stempel waktu tidak dapat dipasangkan dengan keluhan")
})

test("408 sebelum QR tidak dilaporkan sebagai gangguan jaringan", () => {

  // `connectionLost` dan `timedOut` SAMA-SAMA 408 di Baileys. Mencocokkan
  // lewat DisconnectReason membuat handshake yang gagal dilaporkan sebagai
  // masalah jaringan — persis keluhan yang memicu perbaikan ini.
  // Kebijakannya kini fungsi murni yang diekspor, jadi diuji dengan
  // memanggilnya — bukan dengan mencocokkan bentuk sumbernya.
  const sebelumQr = classifyDisconnect(408, false)
  assert.equal(sebelumQr.category, "HANDSHAKE_FAILED", "408 sebelum QR adalah handshake gagal")

  const setelahQr = classifyDisconnect(408, true)
  assert.equal(setelahQr.category, "NETWORK", "408 setelah QR memang gangguan jaringan")

  // 428 harus punya kategori sendiri, terpisah dari kalimat jaringan.
  assert.equal(classifyDisconnect(428, false).category, "HANDSHAKE_FAILED")
  assert.notEqual(sebelumQr.reason, setelahQr.reason, "dua sebab berbeda tidak boleh satu kalimat")

  const transport = codeOnly(read(TRANSPORT))
  assert.ok(
    !/case DisconnectReason\.connectionLost/.test(transport),
    "pemetaan harus atas angka mentah, karena nilai enum bertabrakan",
  )
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
    for (const call of consoleCalls(source)) {
      assert.ok(!/\bqr\b(?!_pernah)/i.test(call), `${name} mencatat payload QR: ${call}`)
      assert.ok(!/\bcreds\b|authState|\bkeys\b/.test(call), `${name} mencatat kredensial: ${call}`)
      // Nama variabel token boleh disebut ("WHATSAPP_WORKER_TOKEN belum
      // diatur"); yang terlarang adalah menginterpolasi NILAInya.
      assert.ok(!/\$\{[^}]*(TOKEN|token)[^}]*\}/.test(call), `${name} mencatat nilai token: ${call}`)
    }
  }
})

// ---------------------------------------------------------------------------
// Regresi: kontrak `lastError` tunggal dari worker sampai UI
//
// Bug yang ditangkap: panel mendeklarasikan `lastError: string | null` sendiri
// sementara kontrak bersama sudah `{ code, message }`. React menerima object
// sebagai child dan seluruh halaman /whatsapp gagal dimuat.
// ---------------------------------------------------------------------------

test("panel menurunkan tipe status dari kontrak bersama, bukan menulis ulang", () => {
  const panel = codeOnly(read(PANEL))

  // Inti perbaikan: satu sumber kebenaran. Definisi manual boleh melenceng
  // tanpa terdeteksi tsc; turunan dari WhatsAppStatus tidak bisa.
  assert.match(
    panel,
    /type StatusPayload = Omit<WhatsAppStatus, "qr">/,
    "StatusPayload harus diturunkan dari WhatsAppStatus",
  )
  assert.ok(
    !/lastError:\s*string\s*\|\s*null/.test(panel),
    "lastError tidak boleh dideklarasi ulang sebagai string",
  )
})

test("panel merender field string dari lastError, bukan objectnya", () => {
  const panel = codeOnly(read(PANEL))

  assert.match(panel, /status\.lastError\.message/, "message harus dirender")

  // `{status.lastError}` di dalam JSX adalah bentuk yang membuat React melempar
  // "Objects are not valid as a React child".
  assert.ok(
    !/\{\s*status\.lastError\s*\}/.test(panel),
    "lastError tidak boleh dirender sebagai object",
  )
})

test("kode error tersedia bagi admin, tapi bukan informasi utama", () => {
  const panel = codeOnly(read(PANEL))

  // Kode tetap ada — tanpa itu keluhan tidak dapat ditelusuri — tetapi
  // tempatnya di bagian detail teknis, bukan di kalimat utama.
  assert.match(panel, /status\?\.lastError\?\.code/)
  assert.match(panel, /<details/, "detail teknis harus dapat dilipat")
  assert.match(panel, /Detail teknis/)
})

test("keadaan koneksi dijelaskan dengan bahasa manusia", () => {
  const panel = codeOnly(read(PANEL))

  // Enum internal seperti LOGGED_OUT tidak boleh menjadi yang dibaca admin
  // lebih dulu; ia hanya boleh muncul di bagian detail teknis.
  assert.match(panel, /CONNECTION_STATE_DESCRIPTIONS\[state\]/)

  for (const [state, description] of Object.entries(CONNECTION_STATE_DESCRIPTIONS)) {
    assert.ok(description.trim().length > 0, `${state} tanpa penjelasan`)
    assert.ok(!/[A-Z_]{4,}/.test(description), `${state} membocorkan istilah internal: ${description}`)
  }
})

test("tombol koneksi ditentukan kebijakan, bukan ternary di JSX", () => {
  const panel = codeOnly(read(PANEL))

  // Keluhan aslinya: Hubungkan, Sambung ulang, dan Keluar tampil bersamaan
  // sehingga admin harus menebak. Daftar tombol kini berasal dari satu fungsi
  // murni yang diuji terpisah.
  assert.match(panel, /connectionActionsFor\(state, status\?\.sessionExists \?\? false\)/)
  assert.match(panel, /actions\.map\(/)
  assert.ok(
    !/runConnectionAction\("connect"\)/.test(panel),
    "tombol tidak boleh dipasang mati di JSX",
  )
})

test("fallback worker tak terjangkau memakai kontrak lastError yang sama", () => {
  const route = codeOnly(read("app/api/whatsapp/route.ts"))

  assert.match(route, /code:\s*"WORKER_UNREACHABLE"/)
  assert.match(route, /message:\s*errorMessageFor\("WORKER_UNREACHABLE"\)/)

  // Bentuk lama: lastError sebagai kalimat tunggal.
  assert.ok(
    !/lastError:\s*(`|")/.test(route),
    "lastError tidak boleh berupa string literal",
  )
})

test("fallback worker tak terjangkau tidak membocorkan detail exception", () => {
  const route = codeOnly(read("app/api/whatsapp/route.ts"))

  // error.message bisa memuat ECONNREFUSED beserta host/porta internal.
  assert.ok(
    !/error\.message/.test(route),
    "pesan exception mentah tidak boleh dikirim ke browser",
  )
  assert.ok(!/error\.stack/.test(route), "stack trace tidak boleh dikirim ke browser")
})

test("setiap state status memakai bentuk lastError yang sama", () => {
  // Kontraknya satu tipe untuk semua state, jadi tidak ada cabang yang bisa
  // mengirim string pada satu state dan object pada state lain.
  for (const state of [
    "CONNECTING",
    "WAITING_QR",
    "CONNECTED",
    "DISCONNECTED",
    "LOGGED_OUT",
    "ERROR",
  ] as const) {
    const status: WhatsAppStatus = {
      state,
      phoneNumber: null,
      displayName: null,
      connectedSince: null,
      lastDisconnectedAt: null,
      lastDisconnectReason: null,
      lastDisconnectCategory: null,
      lastError:
        state === "ERROR" ? { code: "HANDSHAKE_FAILED", message: errorMessageFor("HANDSHAKE_FAILED") } : null,
      sessionExists: false,
      qr: null,
      lastHeartbeatAt: null,
    }

    assert.ok(state in CONNECTION_STATE_LABELS, `${state} harus punya label`)
    if (status.lastError) {
      assert.equal(typeof status.lastError.code, "string")
      assert.equal(typeof status.lastError.message, "string")
    }
  }
})

test("pesan lastError selalu kalimat kanonik, bukan teks bebas", () => {
  // Kalimat berasal dari ERROR_MESSAGES sehingga tidak mungkin memuat detail
  // teknis; inilah alasan menampilkannya di browser aman.
  for (const code of ["WORKER_UNREACHABLE", "HANDSHAKE_FAILED", "NETWORK"] as const) {
    const message = errorMessageFor(code)
    assert.ok(message.length > 0)
    assert.ok(!/Error:|at \w+ \(|ECONNREFUSED|\bstack\b/.test(message))
  }
})
