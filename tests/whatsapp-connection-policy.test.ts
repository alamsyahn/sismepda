/**
 * Kebijakan koneksi WhatsApp: mesin keadaan, sambung ulang, dan tombol.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Insiden yang memicunya: nomor berhasil tertaut, lalu beberapa menit kemudian
 * berubah menjadi "keluar" dengan alasan sesi dikeluarkan dari daftar perangkat
 * tertaut. Dua sebab yang mungkin — kredensial mati yang terus disambung ulang,
 * dan dua soket yang memakai satu kredensial — keduanya adalah keputusan MURNI
 * yang dapat dikunci tanpa menyentuh jaringan maupun Baileys.
 *
 * Yang diuji di sini hanya kebijakan. Adapter yang menerapkannya berbicara
 * dengan WhatsApp sungguhan dan tidak dapat diuji tanpa akun.
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  acquireSessionLock,
  isLockStale,
  releaseSessionLock,
  touchSessionLock,
  LOCK_FILE_NAME,
  LOCK_STALE_MS,
  type SessionLockRecord,
} from "../lib/whatsapp-session-lock"
import {
  CONNECTION_STATE_DESCRIPTIONS,
  classifyDisconnect,
  connectionActionsFor,
  type WhatsAppConnectionState,
} from "../lib/whatsapp-transport"

// ---------------------------------------------------------------------------
// Kategori putus: satu angka status, satu kesimpulan
// ---------------------------------------------------------------------------

test("sesi yang dikeluarkan dari perangkat tertaut menuntut login ulang", () => {
  // Inilah kejadian 16 Sep 2026: 401 setelah beberapa menit tertaut.
  const policy = classifyDisconnect(401, true)

  assert.equal(policy.category, "LOGGED_OUT")
  assert.equal(policy.nextState, "LOGGED_OUT")
  assert.equal(policy.reconnect, false, "kredensial mati tidak boleh disambung ulang")
  assert.equal(policy.requiresNewLogin, true)
})

test("sesi yang diambil alih koneksi lain tidak disambung ulang otomatis", () => {
  // 440 berarti kredensial yang sama dipakai di tempat lain. Menyambung ulang
  // di sini membuat dua soket saling merebut satu sesi sampai WhatsApp
  // mengakhirinya dengan 401 — persis pola "tertaut lalu hilang".
  const policy = classifyDisconnect(440, true)

  assert.equal(policy.category, "CONNECTION_REPLACED")
  assert.equal(policy.reconnect, false, "menyambung ulang justru memperburuk perebutan sesi")
  assert.equal(policy.requiresNewLogin, false, "kredensialnya sendiri masih sah")
})

test("restart yang diminta WhatsApp disambung ulang segera", () => {
  const policy = classifyDisconnect(515, true)

  assert.equal(policy.category, "RESTART_REQUIRED")
  assert.equal(policy.reconnect, true)
  assert.equal(policy.immediate, true, "menunda backoff di sini hanya memperlama pemulihan")
  assert.equal(policy.requiresNewLogin, false)
})

test("berkas sesi rusak dihitung sebagai sesi tidak sah, bukan gangguan sesaat", () => {
  const policy = classifyDisconnect(500, true)

  assert.equal(policy.category, "BAD_SESSION")
  assert.equal(policy.reconnect, false)
  assert.equal(policy.requiresNewLogin, true)
})

test("putus tanpa status dianggap gangguan jaringan yang dapat pulih", () => {
  const policy = classifyDisconnect(undefined, true)

  assert.equal(policy.reconnect, true, "putus jaringan biasa harus pulih sendiri")
  assert.equal(policy.requiresNewLogin, false)
})

test("setiap kategori putus punya kalimat yang dapat dibaca admin", () => {
  for (const status of [401, 403, 408, 411, 428, 429, 440, 500, 503, 515, undefined]) {
    const policy = classifyDisconnect(status, true)
    assert.ok(policy.reason.trim().length > 0, `status ${status} tanpa alasan`)
    assert.ok(
      !/[A-Z_]{4,}/.test(policy.reason),
      `status ${status} membocorkan istilah internal: ${policy.reason}`,
    )
  }
})

test("hanya kategori yang benar-benar pulih sendiri yang menyalakan sambung ulang", () => {
  // Kunci silang: kebijakan yang menuntut login ulang TIDAK BOLEH sekaligus
  // meminta sambung ulang. Kombinasi itulah yang menghasilkan percobaan tanpa
  // akhir memakai kredensial mati.
  for (const status of [401, 403, 408, 411, 428, 429, 440, 500, 503, 515, undefined]) {
    const policy = classifyDisconnect(status, true)
    if (policy.requiresNewLogin) {
      assert.equal(policy.reconnect, false, `status ${status} menyambung ulang sesi tidak sah`)
    }
  }
})

// ---------------------------------------------------------------------------
// Tombol kontekstual
// ---------------------------------------------------------------------------

const SEMUA_STATE: WhatsAppConnectionState[] = [
  "UNPAIRED",
  "CONNECTING",
  "WAITING_QR",
  "CONNECTED",
  "DISCONNECTED",
  "LOGGED_OUT",
  "ERROR",
]

test("Hubungkan dan Sambungkan ulang tidak pernah muncul bersamaan", () => {
  // Keluhan aslinya: tiga tombol sekaligus, sehingga admin harus menebak mana
  // yang benar. Keduanya berarti hal berbeda dan tidak pernah benar bersamaan.
  for (const state of SEMUA_STATE) {
    for (const sessionExists of [true, false]) {
      const actions = connectionActionsFor(state, sessionExists)
      const names = actions.map((action) => action.action)
      assert.ok(
        !(names.includes("connect") && names.includes("reconnect")),
        `${state} (sesi ${sessionExists}) menawarkan connect dan reconnect sekaligus`,
      )
    }
  }
})

test("belum ditautkan hanya menawarkan Hubungkan", () => {
  const actions = connectionActionsFor("UNPAIRED", false)

  assert.deepEqual(actions.map((action) => action.action), ["connect"])
  assert.match(actions[0]!.label, /Hubungkan/)
})

test("sedang menghubungkan menampilkan tombol yang tidak dapat ditekan", () => {
  const actions = connectionActionsFor("CONNECTING", false)

  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.disabled, true, "aksi ganda saat menghubungkan membuka soket kedua")
})

test("terhubung hanya menawarkan jalan keluar", () => {
  const actions = connectionActionsFor("CONNECTED", true)

  assert.deepEqual(actions.map((action) => action.action), ["logout"])
})

test("putus sementara dengan kredensial sah menawarkan Sambungkan ulang", () => {
  const actions = connectionActionsFor("DISCONNECTED", true)
  const names = actions.map((action) => action.action)

  assert.ok(names.includes("reconnect"))
  assert.ok(!names.includes("connect"))
})

test("putus tanpa kredensial menawarkan penautan baru, bukan sambung ulang", () => {
  // Tanpa kredensial di disk, "sambungkan ulang" tidak punya apa pun untuk
  // disambung dan hanya menghasilkan kegagalan yang membingungkan.
  const actions = connectionActionsFor("DISCONNECTED", false)
  const names = actions.map((action) => action.action)

  assert.ok(names.includes("connect"))
  assert.ok(!names.includes("reconnect"))
})

test("sesi tidak sah HANYA menawarkan login ulang", () => {
  // Menawarkan "Sambungkan ulang" di sini adalah jebakan: ia tidak akan pernah
  // berhasil, karena kredensialnya sudah dicabut WhatsApp.
  for (const sessionExists of [true, false]) {
    const actions = connectionActionsFor("LOGGED_OUT", sessionExists)
    assert.deepEqual(actions.map((action) => action.action), ["relogin"])
    assert.match(actions[0]!.label, /Login ulang/)
  }
})

test("setiap keadaan menawarkan sedikitnya satu jalan ke depan", () => {
  // Layar tanpa tombol adalah jalan buntu: admin tidak punya cara memulihkan
  // koneksi selain membuka SSH.
  for (const state of SEMUA_STATE) {
    for (const sessionExists of [true, false]) {
      const actions = connectionActionsFor(state, sessionExists)
      assert.ok(actions.length > 0, `${state} (sesi ${sessionExists}) tidak punya tombol`)
    }
  }
})

test("label tombol memakai bahasa manusia, bukan enum internal", () => {
  for (const state of SEMUA_STATE) {
    for (const action of connectionActionsFor(state, true)) {
      assert.ok(action.label.trim().length > 0, `${state} punya tombol tanpa label`)
      assert.ok(action.busyLabel.trim().length > 0, `${state} punya tombol tanpa label sibuk`)
      assert.ok(!/[A-Z_]{4,}/.test(action.label), `${state} membocorkan enum: ${action.label}`)
    }
  }
})

test("setiap keadaan punya penjelasan untuk admin", () => {
  for (const state of SEMUA_STATE) {
    const description = CONNECTION_STATE_DESCRIPTIONS[state]
    assert.ok(description.trim().length > 0, `${state} tanpa penjelasan`)
  }
})

// ---------------------------------------------------------------------------
// Kunci pemilik sesi: satu kredensial, satu soket
// ---------------------------------------------------------------------------

function sessionDir(): string {
  return mkdtempSync(join(tmpdir(), "sismepda-wa-"))
}

function bacaKunci(dir: string): SessionLockRecord {
  return JSON.parse(readFileSync(join(dir, LOCK_FILE_NAME), "utf8")) as SessionLockRecord
}

test("proses pertama mendapat kepemilikan sesi", () => {
  const dir = sessionDir()
  try {
    const decision = acquireSessionLock(dir, { ownerId: "worker-a" })

    assert.equal(decision.status, "ACQUIRED")
    assert.equal(bacaKunci(dir).ownerId, "worker-a")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("proses kedua ditolak selama pemilik pertama masih berdetak", () => {
  // Inilah penjaga inti terhadap "tertaut lalu hilang": worker kedua yang
  // memuat direktori sesi yang sama akan membuka soket kedua dengan identitas
  // perangkat yang sama, dan WhatsApp mengakhiri keduanya.
  const dir = sessionDir()
  try {
    const now = new Date("2026-09-16T07:13:00.000Z")
    acquireSessionLock(dir, { ownerId: "worker-a", now })

    const kedua = acquireSessionLock(dir, {
      ownerId: "worker-b",
      now: new Date(now.getTime() + 5_000),
    })

    assert.equal(kedua.status, "HELD_BY_OTHER")
    if (kedua.status !== "HELD_BY_OTHER") return
    assert.equal(kedua.holder.ownerId, "worker-a")
    assert.equal(bacaKunci(dir).ownerId, "worker-a", "pemilik tidak boleh berpindah diam-diam")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("kunci milik proses yang sudah mati diambil alih, bukan memblokir selamanya", () => {
  // Container yang dimatikan paksa tidak sempat melepas kuncinya. Sesi yang
  // terkunci permanen sama tidak berfungsinya dengan sesi yang direbut dua
  // proses, jadi kunci basi harus dapat diambil alih.
  const dir = sessionDir()
  try {
    const now = new Date("2026-09-16T07:13:00.000Z")
    acquireSessionLock(dir, { ownerId: "worker-mati", now })

    const pengganti = acquireSessionLock(dir, {
      ownerId: "worker-baru",
      now: new Date(now.getTime() + LOCK_STALE_MS + 1_000),
    })

    assert.equal(pengganti.status, "TAKEN_OVER")
    assert.equal(bacaKunci(dir).ownerId, "worker-baru")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("detak memperpanjang kepemilikan tanpa mengganti pemilik", () => {
  const dir = sessionDir()
  try {
    const mulai = new Date("2026-09-16T07:13:00.000Z")
    acquireSessionLock(dir, { ownerId: "worker-a", now: mulai })

    const kemudian = new Date(mulai.getTime() + 30_000)
    touchSessionLock(dir, "worker-a", kemudian)

    const record = bacaKunci(dir)
    assert.equal(record.ownerId, "worker-a")
    assert.equal(record.heartbeatAt, kemudian.toISOString())
    assert.equal(record.startedAt, mulai.toISOString(), "waktu mulai tidak boleh ikut bergeser")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("detak dari proses yang bukan pemilik diabaikan", () => {
  // Worker yang kalah tidak boleh merebut kembali kunci lewat detak; itu akan
  // menghasilkan dua proses yang sama-sama merasa menjadi pemilik.
  const dir = sessionDir()
  try {
    const now = new Date("2026-09-16T07:13:00.000Z")
    acquireSessionLock(dir, { ownerId: "worker-a", now })

    touchSessionLock(dir, "worker-b", new Date(now.getTime() + 10_000))

    assert.equal(bacaKunci(dir).ownerId, "worker-a")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("melepas kunci hanya boleh dilakukan pemiliknya", () => {
  const dir = sessionDir()
  try {
    acquireSessionLock(dir, { ownerId: "worker-a" })

    releaseSessionLock(dir, "worker-b")
    assert.ok(existsSync(join(dir, LOCK_FILE_NAME)), "proses lain tidak boleh melepas kunci")

    releaseSessionLock(dir, "worker-a")
    assert.ok(!existsSync(join(dir, LOCK_FILE_NAME)), "pemilik harus melepas kuncinya saat berhenti")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("kunci yang rusak tidak memblokir worker baru", () => {
  // Berkas terpotong akibat container mati saat menulis tidak boleh membuat
  // sesi tidak dapat dipakai selamanya.
  const dir = sessionDir()
  try {
    writeFileSync(join(dir, LOCK_FILE_NAME), "{bukan json", "utf8")

    const decision = acquireSessionLock(dir, { ownerId: "worker-a" })

    assert.equal(decision.status, "ACQUIRED")
    assert.equal(bacaKunci(dir).ownerId, "worker-a")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("kunci tanpa stempel detak yang sah dianggap basi", () => {
  assert.equal(
    isLockStale(
      { ownerId: "x", pid: 1, startedAt: "", heartbeatAt: "bukan tanggal" },
      new Date(),
    ),
    true,
  )
})
