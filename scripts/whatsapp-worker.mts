/**
 * Worker WhatsApp — proses persistent, terpisah dari Next.js.
 *
 * MENGAPA PROSES TERPISAH
 *
 * Baileys memerlukan WebSocket long-lived dan stateful. Next.js route handler
 * dapat dijalankan ulang, dibekukan, atau diparalelkan kapan saja oleh runtime;
 * membuka soket di sana berarti membuat koneksi baru berulang kali dan cepat
 * membuat akun WhatsApp diblokir. Karena itu soket hidup HANYA di sini, dan
 * aplikasi web berbicara dengannya lewat HTTP internal.
 *
 * Worker TIDAK diekspos ke internet: ia hanya mendengarkan di jaringan internal
 * Docker, dan dilindungi token bersama.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

// IMPOR RELATIF, BUKAN ALIAS `@/`.
//
// Worker adalah modul ESM sejati (`.mts`). Itu wajib: Baileys 7 bergantung pada
// `whatsapp-rust-bridge` yang ESM-only, dan begitu satu berkas dalam rantai
// impor berbentuk `.ts`, tsx memuat seluruh rantai sebagai CommonJS — resolusi
// paket itu lalu gagal dengan ERR_PACKAGE_PATH_NOT_EXPORTED.
//
// Alias `@/` tidak dipetakan tsx pada jalur ESM, sehingga jalur relatif dengan
// ekstensi `.mjs`/`.js` (gaya NodeNext) adalah satu-satunya bentuk yang
// ter-resolve baik di lokal maupun di dalam container.
import { resolveHoliday } from "../lib/holiday-rules.js"
import { readHolidayRules } from "../lib/server-holidays.js"
import { readSchoolTimeZone } from "../lib/server-school-time-zone.js"
import { schoolMinutesOfDay, todayInSchoolTimeZone } from "../lib/school-date.js"
import { BaileysWhatsAppTransport } from "../lib/whatsapp-baileys.mjs"
import { readConfigurations, sendWhatsAppMessage } from "../lib/server-whatsapp.js"
import {
  LOCK_HEARTBEAT_MS,
  acquireSessionLock,
  releaseSessionLock,
  touchSessionLock,
} from "../lib/whatsapp-session-lock.js"
import { resolveSessionRoot } from "../lib/whatsapp-session-root.js"
import { dueSlots } from "../lib/whatsapp-slots.js"
import { resolveTargetGroup } from "../lib/whatsapp-target.js"

const PORT = Number(process.env.WHATSAPP_WORKER_PORT ?? 3100)
const TOKEN = process.env.WHATSAPP_WORKER_TOKEN ?? ""
/** Interval pemeriksaan jadwal. Satu menit cukup: slot berbutir menit. */
const TICK_MS = 60_000

const sessionRoot = resolveSessionRoot(process.env)
const transport = new BaileysWhatsAppTransport({ sessionDir: sessionRoot.path })
const ownerId = `${process.pid}-${Date.now().toString(36)}`

let ticking = false

/**
 * Satu putaran pemeriksaan jadwal.
 *
 * Seluruh penjagaan (aktif/nonaktif, libur, idempotensi) berada di
 * `sendWhatsAppMessage`, bukan di sini: scheduler hanya menentukan KAPAN
 * bertanya, bukan boleh-tidaknya mengirim.
 */
async function tick(): Promise<void> {
  // Tanpa penjaga ini, tick yang lambat dapat bertumpuk dengan tick berikutnya.
  if (ticking) return
  ticking = true
  try {
    const timeZone = await readSchoolTimeZone()
    const now = new Date()
    const date = todayInSchoolTimeZone(now, timeZone)

    // Libur diperiksa sekali di sini agar hari libur tidak menyentuh query
    // laporan sama sekali; sendWhatsAppMessage tetap memeriksanya sendiri.
    const rules = await readHolidayRules()
    if (resolveHoliday(date, rules).isHoliday) return

    // Jadwal dibaca ulang setiap putaran: admin dapat menyunting jamnya kapan
    // saja, dan perubahan itu harus berlaku tanpa me-restart worker.
    const configurations = await readConfigurations()
    const schedule = configurations.map((row) => ({ type: row.type, slots: row.slots }))

    for (const { type, slot } of dueSlots(schedule, schoolMinutesOfDay(now, timeZone))) {
      const outcome = await sendWhatsAppMessage(transport, { type, slot, trigger: "SCHEDULED" })
      if (outcome.status === "FAILED") {
        console.error(`[whatsapp] ${type} ${slot} gagal: ${outcome.code}`)
      }
    }
  } catch (error) {
    // Kegagalan satu putaran tidak boleh mematikan worker: putaran berikutnya
    // akan mencoba lagi, dan koneksi WhatsApp tetap hidup.
    console.error("[whatsapp] putaran jadwal gagal", error)
  } finally {
    ticking = false
  }
}

// --- HTTP internal ----------------------------------------------------------

function unauthorized(request: IncomingMessage): boolean {
  if (!TOKEN) return true
  const header = request.headers.authorization ?? ""
  return header !== `Bearer ${TOKEN}`
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(payload)
}

const server = createServer((request, response) => {
  void (async () => {
    if (unauthorized(request)) {
      send(response, 401, { error: "Tidak diizinkan." })
      return
    }

    const url = new URL(request.url ?? "/", "http://worker")
    try {
      switch (`${request.method} ${url.pathname}`) {
        case "GET /status":
          send(response, 200, await transport.getStatus())
          return

        case "POST /connect":
          await transport.connect()
          send(response, 200, await transport.getStatus())
          return

        case "POST /reconnect":
          await transport.reconnect()
          send(response, 200, await transport.getStatus())
          return

        case "POST /relogin":
          // Sesi lama dibuang lalu QR baru diminta dalam satu langkah. Tanpa
          // endpoint ini, admin dengan sesi tidak sah harus menekan dua tombol
          // berurutan dan yang pertama terlihat seperti tindakan destruktif
          // tanpa hasil.
          await transport.relogin()
          send(response, 200, await transport.getStatus())
          return

        case "POST /logout":
          await transport.logout()
          send(response, 200, await transport.getStatus())
          return

        case "GET /groups": {
          // Daftar grup hanya ada setelah sesi terbentuk. Menanyakannya saat
          // belum terhubung bukan kegagalan sistem, melainkan keadaan yang
          // wajar — karena itu ia dijawab 409 dengan kode yang jelas, bukan
          // dilempar menjadi 500 yang membanjiri log dengan stack trace.
          const status = await transport.getStatus()
          if (status.state !== "CONNECTED") {
            send(response, 409, { code: "NOT_CONNECTED", state: status.state, groups: [] })
            return
          }
          send(response, 200, { groups: await transport.listGroups() })
          return
        }

        case "POST /resolve-target": {
          const body = await readJson(request)
          const name = typeof body.name === "string" ? body.name : undefined
          const status = await transport.getStatus()
          if (status.state !== "CONNECTED") {
            send(response, 409, { code: "NOT_CONNECTED", state: status.state })
            return
          }
          send(response, 200, resolveTargetGroup(await transport.listGroups(), name))
          return
        }

        case "POST /send": {
          const body = await readJson(request)
          const type = body.type
          const slot = body.slot
          if (typeof type !== "string" || typeof slot !== "string") {
            send(response, 400, { error: "Jenis pesan dan slot wajib diisi." })
            return
          }
          const outcome = await sendWhatsAppMessage(transport, {
            type: type as never,
            slot,
            trigger: "MANUAL",
            initiatedById: typeof body.initiatedById === "string" ? body.initiatedById : null,
          })
          send(response, 200, outcome)
          return
        }

        default:
          send(response, 404, { error: "Rute tidak ditemukan." })
      }
    } catch (error) {
      console.error("[whatsapp] permintaan gagal", error)
      // Detail teknis tidak pernah dikembalikan; ia tinggal di log server.
      send(response, 500, { error: "Terjadi kesalahan pada layanan WhatsApp." })
    }
  })()
})

// --- siklus hidup proses ----------------------------------------------------

if (!TOKEN) {
  // Tanpa token, siapa pun di jaringan Docker dapat mengirim pesan atas nama
  // sekolah. Menolak start lebih baik daripada berjalan tanpa penjaga.
  console.error("[whatsapp] WHATSAPP_WORKER_TOKEN belum diatur; worker berhenti.")
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`[whatsapp] worker mendengarkan pada porta ${PORT}`)
  console.log(`[whatsapp] sesi: ${sessionRoot.path} (${sessionRoot.source})`)
})

// SATU PEMILIK SESI, DIJAGA LINTAS PROSES.
//
// Kredensial Baileys hanya boleh dipakai satu soket. Worker kedua yang memuat
// direktori sesi yang sama membuka soket kedua dengan identitas perangkat yang
// sama; WhatsApp mengambil alih sesi lalu mengeluarkan perangkat dari daftar
// tertaut beberapa menit kemudian. Adapter menjaga hal ini di dalam satu
// proses; kunci ini menjaganya antar proses.
const lock = acquireSessionLock(sessionRoot.path, { ownerId })
if (lock.status === "HELD_BY_OTHER") {
  console.error(
    `[whatsapp] sesi ${sessionRoot.path} sedang dipegang worker lain ` +
      `(detak ${Math.round(lock.ageMs / 1000)} detik lalu); worker ini berhenti agar tidak ada dua soket.`,
  )
  process.exit(1)
}
if (lock.status === "TAKEN_OVER") {
  console.warn("[whatsapp] kunci sesi milik proses sebelumnya sudah basi dan diambil alih.")
}

const lockTimer = setInterval(() => touchSessionLock(sessionRoot.path, ownerId), LOCK_HEARTBEAT_MS)
lockTimer.unref?.()

// Menyambung saat start: inilah yang membuat worker pulih sendiri setelah
// container restart atau VPS reboot, tanpa ada yang membuka SSH.
void transport.connect().catch((error) => {
  console.error("[whatsapp] gagal menyambung saat start", error)
})

const timer = setInterval(() => void tick(), TICK_MS)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[whatsapp] menerima ${signal}, mematikan dengan rapi`)
  clearInterval(timer)
  clearInterval(lockTimer)
  server.close()
  // Menutup soket TANPA logout: sesi harus bertahan agar restart berikutnya
  // tidak menuntut pemindaian QR ulang.
  await transport.shutdown()
  // Kunci dilepas supaya pengganti tidak perlu menunggu kunci menjadi basi.
  releaseSessionLock(sessionRoot.path, ownerId)
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
