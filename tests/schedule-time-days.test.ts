/**
 * Struktur waktu PER HARI dan semantik salinan template.
 *
 * Yang dikunci di sini adalah properti domainnya, bukan detail penyimpanan:
 * sebuah hari berdiri sendiri, dan setiap "terapkan/salin/simpan sebagai
 * template" menghasilkan SALINAN yang tidak dapat direembeti perubahan
 * sumbernya. Logika salin sengaja berupa fungsi murni (`snapshotSlots`)
 * supaya sifat itu dapat diuji tanpa database — di lapisan inilah bug
 * "ternyata masih referensi" akan muncul, bukan di SQL-nya.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { readFileSync } from "node:fs"

import {
  DEFAULT_TIME_SLOTS,
  knownPeriodsAcrossDays,
  findProfileDay,
  orderedDays,
  representativeSlots,
  resolveSlotForDayPeriod,
  snapshotSlots,
  validateTimeStructure,
  type TimeSlot,
  type TimeSlotInput,
} from "../lib/schedule-time"

let seq = 0
/** Baris dengan id unik, meniru baris yang sudah tersimpan di database. */
function row(partial: Partial<TimeSlot> & { position: number }): TimeSlot {
  seq += 1
  return {
    id: `slot-${seq}`,
    kind: "PELAJARAN",
    name: `Jam ke-${partial.position}`,
    startMinute: 7 * 60,
    endMinute: 7 * 60 + 40,
    ascPeriod: partial.position,
    ...partial,
  }
}

/** Sebuah hari beserta barisnya, seperti yang dikembalikan lapisan data. */
function day(dayNumber: number, slots: TimeSlot[]) {
  return { id: `day-${dayNumber}`, day: dayNumber, position: dayNumber, slots }
}

/** Menerapkan salinan ke sebuah hari, persis seperti yang dilakukan server. */
function applySnapshot(target: { slots: TimeSlot[] }, source: readonly TimeSlot[]): void {
  target.slots = snapshotSlots(source).map((slot, index) => ({ ...slot, id: `new-${index}` }))
}

const SENIN = [
  row({ position: 1, ascPeriod: 1, startMinute: 7 * 60, endMinute: 7 * 60 + 40 }),
  row({ position: 2, ascPeriod: 2, startMinute: 7 * 60 + 40, endMinute: 8 * 60 + 20 }),
  row({ position: 3, kind: "ISTIRAHAT", name: "Istirahat", ascPeriod: null, startMinute: 8 * 60 + 20, endMinute: 8 * 60 + 40 }),
  row({ position: 4, ascPeriod: 3, startMinute: 8 * 60 + 40, endMinute: 9 * 60 + 20 }),
]

const JUMAT = [
  row({ position: 1, ascPeriod: 1, startMinute: 7 * 60, endMinute: 7 * 60 + 30 }),
  row({ position: 2, ascPeriod: 2, startMinute: 7 * 60 + 30, endMinute: 8 * 60 }),
]

test("satu profil dapat mempunyai struktur berbeda untuk Senin dan Jumat", () => {
  const days = [day(1, SENIN), day(5, JUMAT)]

  assert.equal(findProfileDay(days, 1)?.slots.length, 4)
  assert.equal(findProfileDay(days, 5)?.slots.length, 2)
  // Hari yang tidak dikonfigurasi tidak dikarang menjadi hari lain.
  assert.equal(findProfileDay(days, 6), null)
})

test("period yang sama boleh mempunyai jam berbeda antarhari", () => {
  const days = [day(1, SENIN), day(5, JUMAT)]

  const seninP1 = resolveSlotForDayPeriod(days, 1, 1)
  const jumatP1 = resolveSlotForDayPeriod(days, 5, 1)

  assert.equal(seninP1?.endMinute, 7 * 60 + 40)
  assert.equal(jumatP1?.endMinute, 7 * 60 + 30)
  assert.notEqual(seninP1?.endMinute, jumatP1?.endMinute)
})

test("resolver menolak period yang tidak ada pada hari itu, bukan mengambilnya dari hari lain", () => {
  const days = [day(1, SENIN), day(5, JUMAT)]

  // Jam ke-3 hanya ada pada Senin. Jumat harus menjawab "tidak ada",
  // bukan meminjam jam Senin.
  assert.ok(resolveSlotForDayPeriod(days, 1, 3))
  assert.equal(resolveSlotForDayPeriod(days, 5, 3), null)
  // Hari yang belum dikonfigurasi sama sekali juga tidak meminjam dari siapa pun.
  assert.equal(resolveSlotForDayPeriod(days, 6, 1), null)
})

test("himpunan period profil adalah gabungan seluruh hari", () => {
  const days = [day(1, SENIN), day(5, JUMAT)]
  assert.deepEqual([...knownPeriodsAcrossDays(days)].sort(), [1, 2, 3])
})

test("salinan struktur hari tidak membawa identitas baris sumber", () => {
  const copy = snapshotSlots(SENIN)

  assert.equal(copy.length, SENIN.length)
  for (const slot of copy as (TimeSlotInput & { id?: string })[]) {
    assert.equal(slot.id, undefined, "baris salinan tidak boleh membawa id sumber")
  }
  // Urutan dirapatkan menjadi 1..n.
  assert.deepEqual(copy.map((slot) => slot.position), [1, 2, 3, 4])
  // Isi yang penting tetap sama, termasuk pemetaan period aSc.
  assert.deepEqual(
    copy.map((slot) => slot.ascPeriod),
    [1, 2, null, 3],
  )
})

test("template dibuat dari sebuah hari adalah snapshot, dan hari yang berubah tidak mengubahnya", () => {
  const senin = day(1, [...SENIN])
  const template = { name: "Reguler Senin–Kamis", slots: snapshotSlots(senin.slots) }

  senin.slots = [...senin.slots, row({ position: 5, ascPeriod: 4 })]

  assert.equal(template.slots.length, 4, "template tidak boleh ikut bertambah")
  assert.equal(senin.slots.length, 5)
})

test("terapkan template menimpa hari tujuan dengan salinan, tanpa menyentuh hari lain", () => {
  const selasa = day(2, [])
  const rabu = day(3, [...SENIN])
  const template = { name: "Reguler", slots: SENIN }

  applySnapshot(selasa, template.slots)

  assert.equal(selasa.slots.length, 4)
  assert.equal(rabu.slots.length, 4, "hari lain tidak boleh tersentuh")
  // Baris hari tujuan adalah baris baru, bukan baris template.
  for (const slot of selasa.slots) {
    assert.ok(!template.slots.some((source) => source.id === slot.id))
  }
})

test("mengedit template setelah diterapkan tidak mengubah hari yang sudah dibuat", () => {
  const selasa = day(2, [])
  const template = { name: "Reguler", slots: snapshotSlots(SENIN) }

  applySnapshot(selasa, template.slots.map((slot, index) => ({ ...slot, id: `t-${index}` })))
  const before = selasa.slots.map((slot) => slot.endMinute)

  // Template diedit habis-habisan.
  template.slots = snapshotSlots(JUMAT)

  assert.deepEqual(selasa.slots.map((slot) => slot.endMinute), before)
  assert.equal(selasa.slots.length, 4)
})

test("menghapus template tidak menghapus atau mengubah hari yang pernah memakainya", () => {
  const selasa = day(2, [])
  let template: { name: string; slots: TimeSlotInput[] } | null = {
    name: "Reguler",
    slots: snapshotSlots(SENIN),
  }

  applySnapshot(selasa, template.slots.map((slot, index) => ({ ...slot, id: `t-${index}` })))
  template = null

  assert.equal(template, null)
  assert.equal(selasa.slots.length, 4, "hari tujuan harus tetap utuh")
  assert.ok(resolveSlotForDayPeriod([selasa], 2, 1))
})

test("salin Senin ke Selasa menghasilkan salinan independen dua arah", () => {
  const senin = day(1, [...SENIN])
  const selasa = day(2, [])

  applySnapshot(selasa, senin.slots)
  assert.equal(selasa.slots.length, 4)

  // Sumber berubah setelah penyalinan.
  senin.slots = [row({ position: 1, ascPeriod: 1, startMinute: 6 * 60, endMinute: 6 * 60 + 30 })]

  assert.equal(selasa.slots.length, 4, "hari tujuan tidak boleh ikut berubah")
  assert.equal(resolveSlotForDayPeriod([selasa], 2, 1)?.startMinute, 7 * 60)
  assert.equal(resolveSlotForDayPeriod([senin], 1, 1)?.startMinute, 6 * 60)
})

test("salinan tetap lolos validasi struktur yang sama dengan penyuntingan manual", () => {
  // Apply/copy tidak boleh menjadi pintu belakang yang menghasilkan data korup.
  assert.deepEqual(validateTimeStructure(snapshotSlots(SENIN)), [])
  assert.deepEqual(validateTimeStructure(snapshotSlots(JUMAT)), [])

  const rusak = [
    row({ position: 1, ascPeriod: 1, startMinute: 8 * 60, endMinute: 7 * 60 }),
  ]
  assert.ok(validateTimeStructure(snapshotSlots(rusak)).length > 0)
})

test("period ganda dalam satu hari tetap ditolak setelah disalin", () => {
  const ganda = [
    row({ position: 1, ascPeriod: 1 }),
    row({ position: 2, ascPeriod: 1, startMinute: 8 * 60, endMinute: 8 * 60 + 40 }),
  ]
  assert.ok(validateTimeStructure(snapshotSlots(ganda)).length > 0)
})

test("hari diurutkan menurut posisi, bukan menurut kemunculan data", () => {
  const days = [day(5, JUMAT), day(1, SENIN)]
  assert.deepEqual(orderedDays(days).map((item) => item.day), [1, 5])
})

test("struktur wakil untuk tampilan lintas-hari diambil dari hari terkonfigurasi pertama", () => {
  // Grid sepekan butuh kerangka baris; hari kosong tidak boleh membuatnya hilang.
  const days = [day(1, []), day(2, SENIN)]
  assert.equal(representativeSlots(days).length, 4)
  assert.equal(representativeSlots([day(1, [])]).length, 0)
})

test("data existing tetap terbaca: struktur bawaan sah sebagai isi satu hari", () => {
  // Backfill migrasi memindahkan struktur profil lama menjadi struktur
  // Senin–Sabtu. Bentuk yang dipindahkan harus lolos validasi yang sama.
  const slots = DEFAULT_TIME_SLOTS.map((slot, index) => ({ ...slot, id: `d${index}` }))
  assert.deepEqual(validateTimeStructure(snapshotSlots(slots)), [])

  const days = [1, 2, 3, 4, 5, 6].map((number) => day(number, slots))
  for (const number of [1, 2, 3, 4, 5, 6]) {
    assert.ok(resolveSlotForDayPeriod(days, number, 1), `hari ${number} kehilangan jam ke-1`)
  }
})

test("migrasi per-hari bersifat expand-backfill, bukan destruktif", () => {
  // Menjaga janji operasional: migrasi tidak boleh menghapus tabel/kolom waktu
  // yang masih memegang data, dan setiap profil harus memperoleh hari.
  const sql = readFileSync(
    "prisma/migrations/20260917150000_schedule_time_per_day_and_templates/migration.sql",
    "utf8",
  ).toUpperCase()

  assert.ok(!/DROP\s+TABLE\s+"?SCHEDULETIMESLOT/.test(sql), "tabel slot tidak boleh di-drop")
  assert.ok(!/DELETE\s+FROM\s+"?SCHEDULETIMESLOT/.test(sql), "slot existing tidak boleh dihapus")
  assert.ok(sql.includes("INSERT INTO \"SCHEDULEPROFILEDAY\"".toUpperCase()), "hari harus di-backfill")
})

test("route waktu menegakkan permission kelola, bukan nama role", () => {
  const source = readFileSync("app/api/jadwal/waktu/route.ts", "utf8")
  const templateSource = readFileSync("app/api/jadwal/waktu/template/route.ts", "utf8")

  // Baca cukup dengan izin baca; semua mutasi menuntut izin kelola.
  assert.match(source, /GET[\s\S]*?requireSchedulePermission\("schedule\.own\.read"\)/)
  for (const text of [source, templateSource]) {
    for (const method of ["PUT", "POST", "DELETE"]) {
      const block = new RegExp(`export async function ${method}[\\s\\S]*?requireSchedulePermission\\("schedule\\.time\\.manage"\\)`)
      if (text.includes(`export async function ${method}`)) {
        assert.match(text, block, `${method} harus menuntut schedule.time.manage`)
      }
    }
    assert.ok(!/role\s*===\s*"/.test(text), "otorisasi tidak boleh dari nama role")
  }
})
