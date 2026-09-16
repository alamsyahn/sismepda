/**
 * Penyimpanan sesi WhatsApp dan batas arsitektur.
 *
 * Yang dijaga berkas ini bukan fitur, melainkan dua janji keamanan: sesi tidak
 * pernah masuk Git, dan Baileys tidak pernah ikut terbawa ke dalam proses
 * Next.js.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  DEVELOPMENT_SESSION_DIRECTORY,
  resolveSessionRoot,
} from "@/lib/whatsapp-session-root"

function read(path: string): string {
  return readFileSync(path, "utf8")
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
const ADAPTER_PATH = "lib/whatsapp-baileys.mts"

// --- lokasi sesi ------------------------------------------------------------

test("tanpa konfigurasi, sesi memakai direktori pengembangan yang di-ignore Git", () => {
  const decision = resolveSessionRoot({})
  assert.equal(decision.path, DEVELOPMENT_SESSION_DIRECTORY)
  assert.equal(decision.source, "default")
})

test("WHATSAPP_SESSION_DIR selalu menang atas peran database", () => {
  const decision = resolveSessionRoot({
    WHATSAPP_SESSION_DIR: "/app/whatsapp-session",
    SISMEPDA_DB_ROLE: "local",
  })
  assert.equal(decision.path, "/app/whatsapp-session")
  assert.equal(decision.source, "configured")
})

test("local dan prodclone tidak pernah berbagi satu sesi", () => {
  const local = resolveSessionRoot({ SISMEPDA_DB_ROLE: "local" })
  const prodclone = resolveSessionRoot({ SISMEPDA_DB_ROLE: "prodclone" })
  assert.notEqual(local.path, prodclone.path)
  assert.equal(local.source, "role-default")
})

test("peran yang tidak dikenali tidak diam-diam menjadi local", () => {
  const decision = resolveSessionRoot({ SISMEPDA_DB_ROLE: "production" })
  assert.equal(decision.path, DEVELOPMENT_SESSION_DIRECTORY)
  assert.equal(decision.role, null)
})

// --- janji keamanan ---------------------------------------------------------

test("direktori sesi masuk .gitignore", () => {
  const gitignore = read(".gitignore")
  assert.ok(
    gitignore.includes(`${DEVELOPMENT_SESSION_DIRECTORY}/`),
    "kredensial WhatsApp dapat ter-commit tanpa aturan ignore",
  )
})

test("status yang dikirim ke browser tidak punya tempat untuk isi kredensial", () => {
  const source = codeOnly(read("lib/whatsapp-transport.ts"))
  // `sessionExists` boolean adalah batasnya: keberadaan, bukan isi.
  assert.ok(source.includes("sessionExists: boolean"))
  for (const forbidden of ["creds", "authState", "signalKey", "noiseKey", "privateKey"]) {
    assert.ok(
      !source.includes(forbidden),
      `tipe status membuka jalan kebocoran kredensial lewat ${forbidden}`,
    )
  }
})

test("hanya adapter yang mengimpor Baileys", () => {
  const transport = codeOnly(read("lib/whatsapp-transport.ts"))
  assert.ok(
    !transport.includes("@whiskeysockets/baileys"),
    "batas transport kehilangan gunanya bila ikut mengimpor Baileys",
  )
  const adapter = codeOnly(read(ADAPTER_PATH))
  assert.ok(adapter.includes("@whiskeysockets/baileys"))
})

test("logika pesan dan jadwal tetap murni dari pustaka WhatsApp", () => {
  for (const path of [
    "lib/whatsapp-messages.ts",
    "lib/whatsapp-schedule.ts",
    "lib/whatsapp-slots.ts",
    "lib/whatsapp-target.ts",
  ]) {
    const source = codeOnly(read(path))
    assert.ok(!source.includes("baileys"), `${path} seharusnya tidak tahu soal Baileys`)
    assert.ok(!source.includes("@prisma/client"), `${path} seharusnya tetap murni`)
  }
})

test("Baileys dipatok pada versi persis, bukan rentang", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }
  const version = pkg.dependencies["@whiskeysockets/baileys"]
  assert.ok(version, "Baileys tidak terdaftar sebagai dependency")
  assert.ok(
    /^\d+\.\d+\.\d+/.test(version),
    `Baileys adalah pustaka rekayasa balik yang sering breaking; patok persis, bukan "${version}"`,
  )
})

test("pustaka yang diimpor langsung dideklarasikan, bukan diwarisi dari Baileys", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }
  const adapter = read(ADAPTER_PATH)
  for (const dependency of ["@hapi/boom", "pino"]) {
    if (adapter.includes(`from "${dependency}"`)) {
      assert.ok(
        pkg.dependencies[dependency],
        `${dependency} diimpor langsung tetapi hanya tersedia sebagai dependensi transitif`,
      )
    }
  }
})

test("adapter membungkam logger Baileys agar isi pesan tidak masuk log container", () => {
  const adapter = read(ADAPTER_PATH)
  assert.ok(adapter.includes("logger:"), "socket Baileys tanpa logger eksplisit mencetak seluruh protokol")
})

test("logout menghapus sesi dari disk, bukan sekadar menutup soket", () => {
  const adapter = codeOnly(read(ADAPTER_PATH))

  // Mekanisme penghapusannya kini di `whatsapp-session-store` — bebas Baileys
  // sehingga dapat diuji langsung (lihat tests/whatsapp-logout.test.ts).
  // Yang dijaga di sini: adapter benar-benar memanggilnya saat logout.
  assert.ok(adapter.includes("discardSessionCredentials"), "reset sesi tidak benar-benar mereset")

  const logout = adapter.slice(adapter.indexOf("async logout()"))
  assert.ok(
    logout.slice(0, logout.indexOf("\n  }")).includes("discardCredentials"),
    "logout harus membuang kredensial, bukan hanya menutup soket",
  )
})
