/**
 * Jadwal yang dapat disunting admin dan idempotensi occurrence.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Dua cacat diuji di sini sekaligus, karena keduanya berbagi satu sumber:
 * jadwal yang dahulu hidup sebagai konstanta di kode, dan pengiriman yang
 * dahulu terjadi SEBELUM occurrence-nya diklaim.
 *
 * Cacat kedua membuat pesan terkirim setiap menit: scheduler berdetak tiap
 * menit, slot dianggap jatuh tempo selama masa grace, dan penanda "sudah
 * dikirim" baru ditulis setelah pesan berangkat — sehingga penulis berikutnya
 * tidak pernah menemukan apa pun untuk dihalangi.
 *
 * Tes ini memakai Prisma palsu yang menegakkan UNIQUE seperti PostgreSQL:
 * penulis kedua atas kunci yang sama ditolak. Itulah satu-satunya mekanisme
 * yang tetap benar saat proses restart atau dua worker berjalan bersamaan.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { normalizeSlots, slotsErrorMessage } from "../lib/whatsapp-slot-config.js"
import { dueSlots } from "../lib/whatsapp-slots.js"
import { destinationDisplay } from "../lib/whatsapp-target.js"

// --- 0. urutan pada implementasi sungguhan ---------------------------------

test("sendWhatsAppMessage mengklaim occurrence SEBELUM menyentuh transport", () => {
  // Tes-tes di bawah memakai replika ringkas. Yang satu ini menjaga berkas
  // aslinya, karena keseluruhan cacat ini hanyalah persoalan urutan: menukar
  // dua baris berikut akan mengembalikan pengiriman tiap menit tanpa satu pun
  // tes perilaku menjadi merah.
  const source = readFileSync(new URL("../lib/server-whatsapp.ts", import.meta.url), "utf8")
  const claimAt = source.indexOf('status: "PROCESSING"')
  const sendAt = source.indexOf("transport.sendMessage(")

  assert.ok(claimAt > 0, "klaim PROCESSING tidak ditemukan")
  assert.ok(sendAt > 0, "pemanggilan transport tidak ditemukan")
  assert.ok(claimAt < sendAt, "klaim harus ditulis sebelum pesan dikirim")
})

// --- 1. label grup: nama untuk mata, JID untuk mesin ------------------------

test("JID tersimpan ditampilkan sebagai NAMA grup, bukan sebagai JID", () => {
  const display = destinationDisplay(
    { mode: "OVERRIDE", jid: "120363412289133202@g.us", name: "nama lama" },
    { jid: null, name: null },
    [{ jid: "120363412289133202@g.us", name: "REKAP ABSENSI SISWA" }],
  )

  assert.equal(display.label, "REKAP ABSENSI SISWA")
  // Yang dilihat admin tidak boleh mengandung alamat teknis.
  assert.doesNotMatch(display.label, /@g\.us/)
})

test("nama grup yang berubah di WhatsApp menang atas snapshot lama", () => {
  const display = destinationDisplay(
    { mode: "OVERRIDE", jid: "120363412289133202@g.us", name: "NAMA LAMA" },
    { jid: null, name: null },
    [{ jid: "120363412289133202@g.us", name: "NAMA BARU" }],
  )
  assert.equal(display.label, "NAMA BARU")
})

test("JID yang tidak ada lagi tidak hilang diam-diam, melainkan dijelaskan", () => {
  const display = destinationDisplay(
    { mode: "OVERRIDE", jid: "120363999@g.us", name: null },
    { jid: null, name: null },
    [{ jid: "120363412289133202@g.us", name: "REKAP ABSENSI SISWA" }],
  )

  assert.equal(display.kind, "STALE")
  assert.match(display.label, /tidak ditemukan/i)
  assert.match(display.label, /120363999@g\.us/)
})

test("mode DEFAULT memakai label manusiawi, bukan sentinel teknis", () => {
  const display = destinationDisplay(
    { mode: "DEFAULT", jid: null, name: null },
    { jid: "120363412289133202@g.us", name: "GURU SMPN 2" },
    [{ jid: "120363412289133202@g.us", name: "GURU SMPN 2" }],
  )
  assert.equal(display.kind, "DEFAULT")
  assert.doesNotMatch(display.label, /__default__/)
})

// --- 2. konfigurasi jadwal --------------------------------------------------

test("jam bebas seperti 07:30 dapat disimpan", () => {
  const result = normalizeSlots(["07:30"])
  assert.ok(result.ok)
  assert.deepEqual(result.slots, ["07:30"])
})

test("beberapa jam disimpan sekaligus dan diurutkan menaik", () => {
  const result = normalizeSlots(["11:15", "07:30", "09:45"])
  assert.ok(result.ok)
  assert.deepEqual(result.slots, ["07:30", "09:45", "11:15"])
})

test("jam duplikat ditolak dengan alasan yang dapat dibaca admin", () => {
  const result = normalizeSlots(["08:00", "08:00"])
  assert.ok(!result.ok)
  assert.equal(result.error.code, "DUPLICATE")
  assert.match(slotsErrorMessage(result.error), /08:00/)
})

test("format salah ditolak, termasuk jam tanpa nol di depan", () => {
  for (const bad of ["8:00", "0800", "25:00", "07:60", ""]) {
    const result = normalizeSlots([bad])
    assert.ok(!result.ok, `seharusnya ditolak: ${bad}`)
  }
})

test("daftar kosong sah: itu berarti laporan ini tidak dijadwalkan", () => {
  const result = normalizeSlots([])
  assert.ok(result.ok)
  assert.deepEqual(result.slots, [])
})

// --- 3. jadwal runtime berasal dari konfigurasi -----------------------------

test("scheduler memakai jam hasil suntingan admin, bukan jam bawaan", () => {
  const schedule = [{ messageId: "ATTENDANCE_MISSING", slots: ["07:30"] }]

  assert.deepEqual(dueSlots(schedule, 7 * 60 + 30), [
    { messageId: "ATTENDANCE_MISSING", slot: "07:30" },
  ])
  // 08:00 adalah jam bawaan lama; ia tidak boleh lagi berpengaruh.
  assert.deepEqual(dueSlots(schedule, 8 * 60), [])
})

// --- idempotensi: Prisma palsu yang menegakkan UNIQUE ----------------------

type Row = {
  id: string
  type: string
  schoolDate: string
  scheduledSlot: string
  idempotencyKey: string | null
  status: string
  trigger: string
}

/**
 * Menirukan satu-satunya sifat PostgreSQL yang dipertaruhkan di sini: penulisan
 * kedua atas `idempotencyKey` yang sama gagal, apa pun urutannya.
 */
function createFakeDatabase() {
  const rows: Row[] = []
  let counter = 0

  return {
    rows,
    create(data: Omit<Row, "id">): Row {
      if (data.idempotencyKey !== null && rows.some((row) => row.idempotencyKey === data.idempotencyKey)) {
        const error = new Error("Unique constraint failed") as Error & { code: string }
        error.code = "P2002"
        throw error
      }
      const row: Row = { ...data, id: `log-${++counter}` }
      rows.push(row)
      return row
    },
    update(id: string, status: string): void {
      const row = rows.find((entry) => entry.id === id)
      if (row) row.status = status
    },
  }
}

/**
 * Inti `sendWhatsAppMessage` versi ringkas: KLAIM DULU, BARU KIRIM.
 *
 * Yang ditiru bukan seluruh fungsi, melainkan urutannya — dan urutan itulah
 * yang dahulu salah.
 */
function dispatch(
  database: ReturnType<typeof createFakeDatabase>,
  transport: { send: () => void },
  options: { type: string; date: string; slot: string; trigger: "SCHEDULED" | "MANUAL" },
): "SENT" | "SKIPPED" | "FAILED" {
  const key =
    options.trigger === "SCHEDULED" ? `${options.type}:${options.date}:${options.slot}` : null

  let claim: Row
  try {
    claim = database.create({
      type: options.type,
      schoolDate: options.date,
      scheduledSlot: options.slot,
      idempotencyKey: key,
      status: key ? "PROCESSING" : "SENT",
      trigger: options.trigger,
    })
  } catch {
    return "SKIPPED"
  }

  try {
    transport.send()
  } catch {
    database.update(claim.id, "FAILED")
    return "FAILED"
  }

  database.update(claim.id, "SENT")
  return "SENT"
}

function countSent(database: ReturnType<typeof createFakeDatabase>): number {
  return database.rows.filter((row) => row.status === "SENT").length
}

// --- 3-7. satu occurrence, satu kiriman ------------------------------------

test("tick 09:59 belum mengirim; 10:00 mengirim sekali; 10:01 dan 10:02 tidak menambah", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }
  const schedule = [{ messageId: "ATTENDANCE_MISSING", slots: ["10:00"] }]

  // 09:59 — belum jatuh tempo, scheduler tidak memanggil transport sama sekali.
  assert.deepEqual(dueSlots(schedule, 9 * 60 + 59), [])
  assert.equal(sends, 0)

  for (const minute of [10 * 60, 10 * 60 + 1, 10 * 60 + 2]) {
    for (const due of dueSlots(schedule, minute)) {
      dispatch(database, transport, {
        type: due.messageId as "ATTENDANCE_MISSING",
        date: "2026-09-16",
        slot: due.slot,
        trigger: "SCHEDULED",
      })
    }
  }

  assert.equal(sends, 1)
  assert.equal(countSent(database), 1)
})

test("dua scheduler pada menit yang sama: occurrence tetap terkirim sekali", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }
  const occurrence = {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED" as const,
  }

  const first = dispatch(database, transport, occurrence)
  const second = dispatch(database, transport, occurrence)

  assert.equal(first, "SENT")
  assert.equal(second, "SKIPPED")
  assert.equal(sends, 1)
})

test("setelah restart proses, occurrence yang sudah SENT tidak dikirim ulang", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }
  const occurrence = {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED" as const,
  }

  dispatch(database, transport, occurrence)

  // Restart: seluruh memori hilang. Yang tersisa hanya baris di database —
  // dan justru itulah yang harus cukup.
  let sendsAfterRestart = 0
  const revived = { send: () => void sendsAfterRestart++ }

  assert.equal(dispatch(database, revived, occurrence), "SKIPPED")
  assert.equal(sendsAfterRestart, 0)
  assert.equal(sends, 1)
})

test("besok, slot 10:00 yang sama boleh dikirim lagi", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }

  dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED",
  })
  dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-17",
    slot: "10:00",
    trigger: "SCHEDULED",
  })

  assert.equal(sends, 2)
})

test("dua kategori berbeda pada jam sama masing-masing terkirim sekali", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }

  for (const type of ["ATTENDANCE_MISSING", "ATTENDANCE_ABSENT"]) {
    dispatch(database, transport, { type, date: "2026-09-16", slot: "10:00", trigger: "SCHEDULED" })
    dispatch(database, transport, { type, date: "2026-09-16", slot: "10:00", trigger: "SCHEDULED" })
  }

  assert.equal(sends, 2)
})

// --- 8. manual tidak terkunci oleh occurrence otomatis ----------------------

test("Kirim sekarang tetap bekerja walau occurrence otomatis hari itu sudah terkirim", () => {
  const database = createFakeDatabase()
  let sends = 0
  const transport = { send: () => void sends++ }

  dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED",
  })

  // Admin menekan tombol dua kali; keduanya harus berangkat.
  for (let index = 0; index < 2; index++) {
    const outcome = dispatch(database, transport, {
      type: "ATTENDANCE_MISSING",
      date: "2026-09-16",
      slot: "10:00",
      trigger: "MANUAL",
    })
    assert.equal(outcome, "SENT")
  }

  assert.equal(sends, 3)
})

test("kiriman manual tidak pernah mengklaim occurrence terjadwal", () => {
  const database = createFakeDatabase()
  const transport = { send: () => {} }

  dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "MANUAL",
  })

  // Karena manual tidak memegang kunci, jadwal otomatisnya masih boleh jalan.
  const scheduled = dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED",
  })
  assert.equal(scheduled, "SENT")
})

// --- 9. kegagalan bukan kesuksesan -----------------------------------------

test("transport gagal ditandai FAILED, tidak pernah SENT", () => {
  const database = createFakeDatabase()
  const transport = {
    send: () => {
      throw new Error("jaringan putus")
    },
  }

  const outcome = dispatch(database, transport, {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED",
  })

  assert.equal(outcome, "FAILED")
  assert.equal(countSent(database), 0)
  assert.equal(database.rows[0].status, "FAILED")
})

test("occurrence yang gagal tidak diulang tiap menit", () => {
  const database = createFakeDatabase()
  let attempts = 0
  const transport = {
    send: () => {
      attempts++
      throw new Error("jaringan putus")
    },
  }
  const occurrence = {
    type: "ATTENDANCE_MISSING",
    date: "2026-09-16",
    slot: "10:00",
    trigger: "SCHEDULED" as const,
  }

  dispatch(database, transport, occurrence)
  // Klaim yang gagal TETAP memegang occurrence. Kalau ia dihapus, slot ini akan
  // dicoba ulang setiap menit sepanjang masa grace — kegagalan berubah menjadi
  // banjir percobaan.
  assert.equal(dispatch(database, transport, occurrence), "SKIPPED")
  assert.equal(attempts, 1)
})
