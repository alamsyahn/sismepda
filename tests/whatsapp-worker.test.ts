/**
 * Worker WhatsApp: batas arsitektur dan kontrak deployment.
 *
 * Perilaku pengiriman yang bergantung database diuji lewat integrasi; berkas
 * ini menjaga janji-janji yang tidak boleh rusak diam-diam saat kode diubah.
 */
import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
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

// --- batas autentikasi worker ----------------------------------------------

/**
 * Resolusi satu specifier impor menjadi berkas sumber di repo.
 *
 * Meniru cara tsx memuat worker: alias `@/` dipetakan ke akar, dan ekstensi
 * `.js`/`.mjs` gaya NodeNext ditukar ke sumber `.ts`/`.mts` yang sebenarnya.
 * Mengembalikan `null` untuk paket node_modules.
 */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2))
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec)
  else return null

  const stripped = base.replace(/\.(js|mjs|cjs)$/, "")
  for (const candidate of [
    stripped + ".ts",
    stripped + ".mts",
    stripped + ".tsx",
    base + ".ts",
    base + ".mts",
    base + ".tsx",
    resolve(base, "index.ts"),
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Seluruh berkas repo dan paket eksternal yang tertarik dari satu entry point. */
function importGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [resolve(ROOT, entry)]

  while (queue.length > 0) {
    const file = queue.shift()!
    const key = relative(ROOT, file).replace(/\\/g, "/")
    if (files.has(key)) continue
    files.add(key)

    const source = readFileSync(file, "utf8")
    const specifiers: string[] = []
    for (const pattern of [
      /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
      /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    ]) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source))) specifiers.push(match[1])
    }

    for (const specifier of specifiers) {
      const target = resolveSpecifier(specifier, file)
      if (target) queue.push(target)
      else packages.add(specifier)
    }
  }
  return { files, packages }
}

test("graf impor worker tidak menarik autentikasi pengguna", () => {
  // BUG YANG DICEGAH: worker produksi crash-loop dengan
  // `Cannot find module '@/auth'` karena rantai
  // whatsapp-worker.mts → server-whatsapp.ts → server-whatsapp-report.ts
  // → rbac-access.ts → @/auth. Worker latar tidak punya request, cookie,
  // atau sesi; `auth.ts` bahkan tidak ikut disalin ke image worker.
  //
  // Diperiksa dengan menelusuri graf impor sebenarnya secara transitif, bukan
  // grep satu berkas: bug aslinya berada empat tingkat di bawah worker dan
  // tidak akan terlihat dari isi `whatsapp-worker.mts` saja.
  const { files, packages } = importGraph(WORKER_PATH)

  assert.ok(files.size > 10, "penelusuran graf harus benar-benar berjalan")
  assert.ok(
    files.has("lib/server-whatsapp.ts"),
    "graf harus memuat layer server WhatsApp yang dipakai scheduler",
  )

  for (const forbidden of ["auth.ts", "lib/rbac-access.ts", "lib/page-guards.ts"]) {
    assert.ok(
      !files.has(forbidden),
      `worker latar tidak boleh menarik ${forbidden}: ia tidak punya sesi pengguna`,
    )
  }
  for (const specifier of packages) {
    assert.ok(
      !specifier.includes("next-auth") && specifier !== "@/auth",
      `worker latar tidak boleh menarik paket autentikasi (${specifier})`,
    )
  }
})

test("fungsi data laporan WhatsApp dapat dipakai tanpa sesi", () => {
  // Fungsi query harus bebas otorisasi agar dapat dipanggil worker latar.
  const report = codeOnly(read("lib/server-whatsapp-report.ts"))
  assert.ok(
    report.includes("export async function readWhatsAppReportClasses"),
    "fungsi data-only harus bernama read... agar sifatnya eksplisit",
  )
  for (const guard of [
    "requirePermission",
    "requireUser",
    "getAuthorizationContext",
    "auth()",
  ]) {
    assert.ok(
      !report.includes(guard),
      `fungsi data tidak boleh memanggil ${guard}: worker latar tidak punya sesi`,
    )
  }

  // Jalur worker memakai fungsi data-only itu, bukan wrapper berizin.
  const server = codeOnly(read("lib/server-whatsapp.ts"))
  assert.ok(server.includes("readWhatsAppReportClasses(toPrismaDate(date))"))
  assert.ok(
    !server.includes("whatsapp-access"),
    "layer yang dipakai worker tidak boleh mengimpor modul guard",
  )
})

test("laporan WhatsApp di web tetap menuntut permission", () => {
  // Pemisahan auth/data tidak boleh membuat laporan dapat dibaca tanpa izin.
  const access = codeOnly(read("lib/whatsapp-access.ts"))
  const wrapper = access.slice(access.indexOf("export async function getWhatsAppReportClasses"))
  assert.ok(wrapper.length > 0, "wrapper berizin untuk web harus ada")
  assert.ok(
    wrapper.includes('requirePermission("reports.whatsapp.read.all")'),
    "wrapper web harus menuntut reports.whatsapp.read.all",
  )
  assert.ok(
    wrapper.indexOf('requirePermission("reports.whatsapp.read.all")') <
      wrapper.indexOf("readWhatsAppReportClasses"),
    "permission harus diperiksa SEBELUM query dijalankan",
  )

  // Halaman web memakai wrapper berizin, bukan fungsi data mentah.
  const page = codeOnly(read("app/laporan-whatsapp/page.tsx"))
  assert.ok(page.includes('from "@/lib/whatsapp-access"'))
  assert.ok(
    !page.includes("readWhatsAppReportClasses"),
    "surface web tidak boleh memanggil fungsi data tanpa otorisasi",
  )
  assert.ok(page.includes('requirePagePermission("reports.whatsapp.read.all")'))
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

test("konstanta jaringan dan jalur sesi cocok dengan overlay", () => {
  // Konstanta yang menyimpang dari overlay membuat test jaringan di atas
  // memeriksa nama yang tidak ada, sehingga lulus tanpa menjamin apa pun.
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes(`${production.whatsappEgressNetwork}:`))
  assert.ok(overlay.includes(`WHATSAPP_SESSION_DIR: ${production.whatsappSessionPath}`))
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

// --- jaringan ---------------------------------------------------------------

/**
 * Buang komentar YAML agar assertion memeriksa konfigurasi, bukan prosa.
 *
 * Komentar overlay ini panjang dan menyebut istilah yang juga dicari assertion
 * ("internal: true", nama jaringan), sehingga pencarian pada teks mentah bisa
 * lulus hanya karena membaca penjelasan.
 */
function configOnly(source: string): string {
  // CRLF dinormalkan lebih dulu: assertion di bawah mengandalkan batas baris,
  // dan checkout Windows menghasilkan akhir baris yang membuat pola meleset.
  const normalized = source.split("\r\n").join("\n")
  return normalized.replace(/^\s*#.*$/gm, "").replace(/\s+#.*$/gm, "")
}

/**
 * Baris-baris milik satu blok bertingkat dua (service atau jaringan).
 *
 * Pemindaian dilakukan per baris, bukan lewat offset string: indentasi adalah
 * satu-satunya penanda batas blok di YAML, dan pencocokan berbasis offset
 * mudah meleset pada baris kosong sisa komentar.
 */
function blockLines(source: string, name: string): string[] {
  const lines = configOnly(source).split("\n")
  const start = lines.findIndex((line) => line.startsWith(`  ${name}:`))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {0,2}\S/.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Daftar jaringan sebuah service, baik bentuk inline `[a, b]` maupun blok. */
function serviceNetworks(overlay: string, service: string): string[] {
  const lines = blockLines(overlay, service)
  const inlineIndex = lines.findIndex((line) => /^\s*networks:\s*\[/.test(line))
  if (inlineIndex !== -1) {
    const inline = lines[inlineIndex].match(/\[([^\]]+)\]/)
    return inline ? inline[1].split(",").map((name) => name.trim()) : []
  }
  const blockIndex = lines.findIndex((line) => /^\s*networks:\s*$/.test(line))
  if (blockIndex === -1) return []
  const names: string[] = []
  for (const line of lines.slice(blockIndex + 1)) {
    const item = line.match(/^\s*-\s*(\S+)/)
    if (!item) break
    names.push(item[1])
  }
  return names
}

test("worker berada di jaringan database DAN jaringan egress", () => {
  // Regresi produksi: worker hanya tersambung ke `database`, yang dibuat
  // `internal: true`. Container di jaringan internal tidak punya default route
  // keluar, sehingga setiap resolusi DNS gagal dengan EAI_AGAIN dan Baileys
  // tidak pernah mencapai web.whatsapp.com — handshake ditutup 408 sebelum QR.
  const networks = serviceNetworks(read("compose.whatsapp.yaml"), production.whatsappService)
  assert.ok(
    networks.includes("database"),
    "tanpa jaringan database, worker kehilangan PostgreSQL dan tidak dapat dijangkau app",
  )
  assert.ok(
    networks.includes(production.whatsappEgressNetwork),
    "tanpa jaringan egress, worker tidak memiliki DNS/internet dan pairing selalu gagal",
  )
})

test("jaringan egress tidak internal", () => {
  // `internal: true` di sini akan mengembalikan persis bug yang diperbaiki:
  // jaringan kedua ada, tetapi tetap tanpa jalan keluar.
  const scoped = blockLines(read("compose.whatsapp.yaml"), production.whatsappEgressNetwork).join("\n")
  assert.match(scoped, /driver:\s*bridge/, "jaringan egress harus bridge biasa")
  assert.ok(
    !/internal:\s*true/.test(scoped),
    "jaringan egress yang internal tidak memberi egress apa pun",
  )
})

test("overlay tidak membuat jaringan database menghadap internet", () => {
  // Cara 'memperbaiki' yang salah: menjadikan `database` non-internal. Itu
  // memberi jalur internet kepada PostgreSQL, bukan hanya kepada worker.
  const config = configOnly(read("compose.whatsapp.yaml"))
  assert.ok(
    !/^\s*database:/m.test(config.slice(config.indexOf("\nnetworks:"))),
    "overlay tidak boleh mendeklarasikan ulang jaringan database",
  )
  assert.ok(!/internal:\s*false/.test(config), "isolasi database tidak boleh dilonggarkan")
})

test("jaringan egress hanya dipakai worker", () => {
  // Menyambungkan app atau database ke jaringan egress memperluas permukaan
  // tanpa alasan; hanya worker yang perlu memulai koneksi keluar.
  const overlay = read("compose.whatsapp.yaml")
  for (const service of ["app", "db", "migrate"]) {
    assert.ok(
      !serviceNetworks(overlay, service).includes(production.whatsappEgressNetwork),
      `${service} tidak boleh berada di jaringan egress`,
    )
  }
})

test("worker tidak ditempelkan ke jaringan reverse proxy", () => {
  // Proxy adalah jalur MASUK. Worker tidak melayani trafik publik, jadi
  // menaruhnya di sana hanya mendekatkannya pada permukaan yang terekspos.
  const networks = serviceNetworks(read("compose.whatsapp.yaml"), production.whatsappService)
  assert.ok(!networks.some((name) => /proxy|edge/.test(name)))
})

test("egress tidak berubah menjadi porta yang terekspos", () => {
  // Jaringan bridge hanya memberi NAT keluar; yang membuka jalur masuk adalah
  // `ports:`. Keduanya diperiksa bersama agar egress tidak dijadikan alasan
  // untuk mempublikasikan porta worker.
  const config = configOnly(read("compose.whatsapp.yaml"))
  assert.ok(!/^\s*ports:/m.test(config))
  assert.ok(!/expose:/.test(config))
})

test("volume sesi tetap terpasang setelah perubahan jaringan", () => {
  // Perubahan jaringan tidak boleh mengorbankan persistensi sesi: sesi yang
  // hilang memaksa pemindaian QR ulang pada setiap deploy.
  const overlay = read("compose.whatsapp.yaml")
  assert.ok(overlay.includes(`whatsapp_session:${production.whatsappSessionPath}`))
  assert.ok(overlay.includes(`name: ${production.whatsappSessionVolume}`))
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
    server.includes("readWhatsAppReportClasses"),
    "query kedua akan membuat angka di grup berbeda dari angka di layar",
  )
  // Halaman web membaca lewat wrapper berizin yang membungkus fungsi yang sama,
  // sehingga keduanya tetap satu sumber data meski batas otorisasinya berbeda.
  const access = codeOnly(read("lib/whatsapp-access.ts"))
  assert.ok(access.includes("readWhatsAppReportClasses"))
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
