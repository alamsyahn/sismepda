/**
 * Worker WhatsApp: batas arsitektur dan kontrak deployment.
 *
 * Perilaku pengiriman yang bergantung database diuji lewat integrasi; berkas
 * ini menjaga janji-janji yang tidak boleh rusak diam-diam saat kode diubah.
 */
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

import {
  production,
  productionComposeFiles,
  remoteActivateScript,
  remotePreflightScript,
} from "@/lib/deployment"

/** Test dijalankan dari akar repo; jalur dibuat eksplisit agar tidak rapuh. */
const ROOT = process.cwd()

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

/** Buang komentar agar assertion memeriksa kode, bukan prosa penjelas. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Lokasi berkas diuji lewat konstanta, bukan literal yang tersebar: berkas ini
 * WAJIB berekstensi ESM (mts), dan menuliskan jalurnya berkali-kali membuat
 * perubahan ekstensi berikutnya kembali tercecer di banyak assertion.
 */
const WORKER_PATH = "scripts/whatsapp-worker.mts"

// --- batas proses -----------------------------------------------------------

test("Next.js tidak pernah mengimpor Baileys secara langsung", () => {
  // Route handler dapat dijalankan ulang kapan saja; membuka soket di sana
  // berarti koneksi WhatsApp baru berkali-kali.
  const client = codeOnly(read("lib/server-whatsapp-worker-client.ts"))
  assert.ok(!client.includes("whatsapp-baileys"))
  assert.ok(!client.includes("@whiskeysockets/baileys"))

  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(!server.includes("@whiskeysockets/baileys"))
  assert.ok(
    server.includes("transport: WhatsAppTransport"),
    "layer server harus menerima transport, bukan membuatnya sendiri",
  )
})

test("hanya worker yang membuat instance transport Baileys", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("new BaileysWhatsAppTransport"))
})

// --- keamanan worker --------------------------------------------------------

test("worker dan adapter Baileys adalah modul ESM sejati", () => {
  // Baileys 7 bergantung pada `whatsapp-rust-bridge` yang ESM-only. Jika salah
  // satu berkas dalam rantai impor ini kembali menjadi `.ts`, tsx memuat
  // seluruh rantai sebagai CommonJS dan worker mati saat start dengan
  // ERR_PACKAGE_PATH_NOT_EXPORTED — kegagalan runtime yang tidak akan
  // tertangkap oleh tsc maupun lint.
  assert.ok(
    existsSync(resolve(ROOT, WORKER_PATH)),
    `${WORKER_PATH} harus ada dengan ekstensi ESM`,
  )
  assert.ok(
    existsSync(resolve(ROOT, "lib/whatsapp-baileys.mts")),
    "adapter Baileys harus berekstensi .mts",
  )
  assert.ok(
    !existsSync(resolve(ROOT, "scripts/whatsapp-worker.ts")) &&
      !existsSync(resolve(ROOT, "lib/whatsapp-baileys.ts")),
    "varian .ts tidak boleh hidup kembali berdampingan",
  )

  // Rantai ESM tidak boleh memakai alias `@/`: tsx tidak memetakannya pada
  // jalur ESM, sehingga impor gagal walau tsc menerimanya.
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(
    !/from "@\//.test(worker),
    "worker harus memakai impor relatif, bukan alias @/",
  )
})

test("script npm worker menunjuk berkas .mts yang benar", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>
  }
  const script = pkg.scripts["whatsapp:worker:local"]
  assert.ok(script, "script whatsapp:worker:local harus terdaftar")
  assert.ok(
    script.includes(WORKER_PATH),
    "script npm harus menunjuk berkas worker yang sebenarnya ada",
  )
})

test("worker menolak start tanpa token", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(
    worker.includes("process.exit(1)"),
    "worker tanpa token dapat dikendalikan siapa pun di jaringan Docker",
  )
  assert.ok(worker.includes("WHATSAPP_WORKER_TOKEN"))
})

test("setiap permintaan ke worker diperiksa tokennya", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("unauthorized(request)"))
  assert.ok(worker.includes("Bearer ${TOKEN}"))
})

test("worker tidak membocorkan detail teknis ke pemanggil", () => {
  const worker = read(WORKER_PATH)
  assert.ok(worker.includes("Terjadi kesalahan pada layanan WhatsApp."))
})

// --- kontrak deployment -----------------------------------------------------

test("compose produksi menjalankan berkas worker ESM yang benar-benar ada", () => {
  // BUG YANG DICEGAH: overlay pernah menjalankan `scripts/whatsapp-worker.ts`
  // sementara berkas yang ada hanya `.mts`. Container keluar seketika, service
  // tidak pernah mendengarkan porta 3100, dan UI melaporkan "Worker WhatsApp
  // tidak dapat dihubungi" — kegagalan yang tidak tertangkap tsc maupun lint
  // karena compose bukan TypeScript.
  const overlay = read("compose.whatsapp.yaml")
  const command = overlay.match(/command:\s*(.+)/)?.[1]
  assert.ok(command, "overlay harus menetapkan command worker")

  const script = command.match(/scripts\/whatsapp-worker\.m?ts/)?.[0]
  assert.ok(script, "command worker harus menunjuk berkas worker")
  assert.equal(script, WORKER_PATH, "command harus menunjuk varian .mts")
  assert.ok(
    existsSync(resolve(ROOT, script)),
    `berkas yang dijalankan compose (${script}) harus benar-benar ada di repo`,
  )
})

test("tidak ada berkas yang menunjuk varian .ts worker", () => {
  // Dicek lintas berkas, bukan hanya di compose: satu rujukan `.ts` yang
  // tertinggal di mana pun akan menghidupkan kembali bug yang sama.
  for (const path of ["compose.whatsapp.yaml", "package.json", "Dockerfile"]) {
    assert.ok(
      !/scripts\/whatsapp-worker\.ts\b/.test(read(path)),
      `${path} masih menunjuk scripts/whatsapp-worker.ts yang tidak ada`,
    )
  }
})

test("worker dibangun dari stage image yang memang punya tsx", () => {
  // `runner` adalah build standalone Next tanpa tsx; menjalankan worker di sana
  // gagal walau nama berkasnya benar.
  const overlay = read("compose.whatsapp.yaml")
  assert.match(overlay, /target:\s*migrator/)

  const dockerfile = read("Dockerfile")
  const migrator = dockerfile.slice(
    dockerfile.indexOf("AS migrator"),
    dockerfile.indexOf("AS runner"),
  )
  assert.ok(migrator.includes("COPY scripts"), "stage migrator harus memuat scripts/")
  assert.ok(migrator.includes("COPY lib"), "worker mengimpor lib/ secara relatif")
})

test("overlay WhatsApp ikut dalam setiap perintah compose produksi", () => {
  // BUG YANG DICEGAH: overlay ada di Git tetapi tidak pernah diteruskan ke
  // `docker compose`, sehingga service worker tidak pernah dibuat di produksi
  // dan app selalu melaporkan worker tak dapat dihubungi.
  assert.equal(productionComposeFiles.includes(production.whatsappComposeFile), true)
  assert.equal(productionComposeFiles[0], production.composeFile)
  assert.match(remotePreflightScript(), /if test -f compose\.whatsapp\.yaml/)
})

test("aktivasi menaikkan worker tanpa menyentuh service lain", () => {
  const activate = remoteActivateScript()
  assert.match(activate, /up -d whatsapp-worker/)
  // `up -d` tanpa argumen akan ikut membuat ulang database milik deploy.yaml.
  assert.ok(
    !/up -d\s*<\/dev\/null/.test(activate),
    "aktivasi harus menyebut service secara eksplisit",
  )
})

test("preflight melaporkan token worker tanpa membocorkan nilainya", () => {
  const preflight = remotePreflightScript()
  assert.match(preflight, /WHATSAPP_TOKEN=/)
  assert.match(preflight, /echo present \|\| echo absent/)
  // Yang dicetak hanya ADA/TIDAK; nilai token tidak pernah masuk log deploy.
  assert.ok(
    !/echo "?\$WHATSAPP_WORKER_TOKEN/.test(preflight),
    "nilai token tidak boleh pernah dicetak",
  )
})

test("nama service dan volume sesi konsisten antara overlay dan kontrak deploy", () => {
  // Konstanta yang menyimpang diam-diam membuat deploy menaikkan service yang
  // tidak ada, atau memeriksa volume yang salah.
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes(`${production.whatsappService}:`))
  assert.ok(overlay.includes(`name: ${production.whatsappSessionVolume}`))
})

test("worker punya service compose sendiri dengan restart otomatis", () => {
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes("whatsapp-worker:"))
  assert.ok(
    overlay.includes("restart: unless-stopped"),
    "tanpa restart otomatis, worker tidak hidup lagi setelah reboot VPS",
  )
})

test("sesi worker berada di volume bernama, bukan writable layer container", () => {
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes("whatsapp_session:/app/whatsapp-session"))
  assert.ok(
    overlay.includes("name: sismepda_whatsapp_session"),
    "volume tanpa nama eksplisit dapat berganti diam-diam dan memaksa pairing ulang",
  )
})

test("jalur sesi di environment cocok dengan titik mount", () => {
  const overlay = read("compose.whatsapp.yaml")
  const envMatch = overlay.match(/WHATSAPP_SESSION_DIR:\s*(\S+)/)
  const mountMatch = overlay.match(/whatsapp_session:(\S+)/)
  assert.ok(envMatch && mountMatch)
  assert.equal(envMatch![1], mountMatch![1], "sesi akan ditulis ke luar volume")
})

test("worker tidak diekspos ke host", () => {
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(
    !/^\s*ports:/m.test(overlay),
    "mengekspos worker berarti membuka kendali akun WhatsApp sekolah",
  )
})

test("app menjangkau worker lewat nama service internal", () => {
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes("WHATSAPP_WORKER_URL: http://whatsapp-worker:3100"))
})

test("overlay tidak menyentuh volume media maupun database", () => {
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(!overlay.includes("sismepda_media_data"))
  assert.ok(!overlay.includes("postgresql"))
})

// --- siklus hidup -----------------------------------------------------------

test("worker menyambung sendiri saat start", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("transport.connect()"))
})

test("shutdown menutup soket TANPA menghapus sesi", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("SIGTERM"), "container stop mengirim SIGTERM")
  assert.ok(worker.includes("transport.shutdown()"))
  const shutdownSection = worker.slice(worker.indexOf("async function shutdown"))
  assert.ok(
    !shutdownSection.includes("logout()"),
    "shutdown yang me-logout memaksa pemindaian QR setiap kali deploy",
  )
})

test("putaran jadwal yang gagal tidak mematikan worker", () => {
  const worker = codeOnly(read(WORKER_PATH))
  const tickBody = worker.slice(worker.indexOf("async function tick"), worker.indexOf("function unauthorized"))
  assert.ok(tickBody.includes("catch"), "satu kegagalan akan menghentikan seluruh penjadwalan")
  assert.ok(tickBody.includes("finally"))
})

test("scheduler tidak menumpuk putaran yang saling bertindih", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("if (ticking) return"))
})

// --- aturan pengiriman ------------------------------------------------------

test("idempotensi dijaga database, bukan variabel memori", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(server.includes("isUniqueViolation"))
  assert.ok(server.includes("P2002"), "kode pelanggaran unik Prisma adalah penjaga sesungguhnya")
  assert.ok(server.includes('reason: "ALREADY_SENT"'))
})

test("hanya pengiriman terjadwal yang memakai idempotency key", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(
    server.includes('request.trigger === "SCHEDULED" ? idempotencyKeyFor'),
    "kirim manual harus tetap bisa diulang operator",
  )
})

test("hari libur hanya membatalkan jadwal, bukan pengiriman manual", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  const holidaySection = server.slice(server.indexOf("readHolidayRules"))
  assert.ok(server.includes('if (request.trigger === "SCHEDULED") {'))
  assert.ok(holidaySection.includes('reason: "HOLIDAY"'))
})

test("toggle nonaktif menghentikan jadwal", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(server.includes('reason: "AUTOMATIC_DISABLED"'))
})

test("pengiriman otomatis default TIDAK aktif", () => {
  // Dijaga di level schema, bukan di kode pemanggil: baris konfigurasi yang
  // dibuat jalur mana pun tetap lahir dalam keadaan nonaktif.
  const schema = read("prisma/schema.prisma")
  const model = schema.slice(schema.indexOf("model WhatsAppConfiguration"))
  assert.ok(
    /enabled\s+Boolean\s+@default\(false\)/.test(model),
    "mengirim ke grup sekolah harus keputusan manusia, bukan efek samping migrasi",
  )
})

test("isi pesan disimpan sebagai snapshot di riwayat", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(server.includes("messageText,"), "data absensi berubah setelah pesan dikirim")
})

test("pesan memakai sumber data yang sama dengan halaman laporan", () => {
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(
    server.includes("getWhatsAppReportClasses"),
    "query kedua akan membuat angka di grup berbeda dari angka di layar",
  )
})

test("jadwal memakai zona waktu sekolah, bukan jam container", () => {
  const worker = codeOnly(read(WORKER_PATH))
  assert.ok(worker.includes("readSchoolTimeZone"))
  assert.ok(worker.includes("schoolMinutesOfDay(now, timeZone)"))
})

test("worker terdaftar sebagai perintah CLI berdokumentasi", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
  assert.ok(pkg.scripts["whatsapp:worker:local"])
  const cli = read("lib/development-cli.ts")
  assert.ok(cli.includes('"whatsapp:worker:local"'))
})
