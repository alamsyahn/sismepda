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
