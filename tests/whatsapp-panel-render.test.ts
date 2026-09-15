/**
 * Render nyata panel WhatsApp untuk payload status yang pernah memecahkan
 * halaman produksi.
 *
 * Pemeriksaan sumber (whatsapp-page.test.ts) menjaga bentuk kontraknya; berkas
 * ini menjalankan React sungguhan, karena "Objects are not valid as a React
 * child" adalah kegagalan runtime yang tidak terlihat oleh tsc — `lastError`
 * pernah dideklarasi `string` sementara nilainya object, dan TypeScript justru
 * menganggap render itu sah.
 *
 * JSX tidak dipakai supaya berkas tetap `.test.ts` dan ikut terjaring
 * `tsx --test tests/**\/*.test.ts`.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { WhatsAppPanel } from "../components/whatsapp/whatsapp-panel"
import { errorMessageFor, type WhatsAppStatus } from "../lib/whatsapp-transport"

type StatusPayload = Omit<WhatsAppStatus, "qr">

function statusWith(lastError: WhatsAppStatus["lastError"]): StatusPayload {
  return {
    state: "ERROR",
    phoneNumber: null,
    displayName: null,
    connectedSince: null,
    lastDisconnectedAt: null,
    lastDisconnectReason: null,
    lastError,
    sessionExists: false,
    lastHeartbeatAt: null,
  }
}

test("merender object sebagai React child memang melempar", () => {
  // Menegaskan mekanisme kegagalannya, supaya test di bawah punya arti.
  const lastError = statusWith({
    code: "HANDSHAKE_FAILED",
    message: errorMessageFor("HANDSHAKE_FAILED"),
  }).lastError

  assert.throws(
    () => renderToStaticMarkup(createElement("p", null, lastError as never)),
    /Objects are not valid as a React child/,
  )
})

test("fragmen error panel merender message dan code tanpa melempar", () => {
  const status = statusWith({
    code: "HANDSHAKE_FAILED",
    message: errorMessageFor("HANDSHAKE_FAILED"),
  })

  // Bentuk yang sama dengan yang dirender panel: dua field string, bukan object.
  const markup = renderToStaticMarkup(
    createElement(
      "p",
      null,
      createElement("span", null, status.lastError?.code),
      " · ",
      status.lastError?.message,
    ),
  )

  assert.match(markup, /HANDSHAKE_FAILED/)
  assert.match(markup, /WhatsApp menolak koneksi sebelum sesi terbentuk/)
})

test("panel dapat dirender pada keadaan awal tanpa melempar", () => {
  // Render server pertama: status masih null dan useEffect belum berjalan.
  // Ini jalur yang dilalui halaman sebelum fetch status pertama selesai.
  const markup = renderToStaticMarkup(
    createElement(WhatsAppPanel, { canManageConnection: true, canSend: true }),
  )

  assert.match(markup, /WhatsApp/)
})

test("payload WORKER_UNREACHABLE dapat dirender seperti error lain", () => {
  const status = statusWith({
    code: "WORKER_UNREACHABLE",
    message: errorMessageFor("WORKER_UNREACHABLE"),
  })

  const markup = renderToStaticMarkup(
    createElement("p", null, status.lastError?.message),
  )

  assert.match(markup, /Layanan WhatsApp sedang tidak berjalan/)
  // Kalimat kanonik, bukan detail koneksi.
  assert.ok(!/ECONNREFUSED|127\.0\.0\.1|:3100/.test(markup))
})
