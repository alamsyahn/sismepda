/**
 * Regresi untuk perbaikan modul Jadwal:
 *
 *  1. penerapan kandidat impor aSc (per baris dan massal),
 *  2. pencarian pada pemilih yang dapat diketik,
 *  3. pemetaan hari — setiap hari membaca konfigurasinya sendiri,
 *  4. aturan nama Data Master Mata Pelajaran.
 *
 * Seluruhnya menguji FUNGSI MURNI, tanpa database dan tanpa peramban,
 * mengikuti konvensi test proyek. Di lapisan inilah bug-bug tersebut hidup:
 * "kandidat menimpa pemetaan manual", "pencarian hanya startsWith", dan
 * "semua hari jatuh ke Senin" semuanya adalah salah logika, bukan salah SQL.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  applicableCandidateId,
  bulkCandidateApplications,
  buildMappingPlan,
  normalizePersonName,
  type InternalEntity,
  type MappingPlan,
} from "../lib/asc-mapping"
import { filterBySearchQuery, matchesSearchQuery, normalizeSearchText } from "../lib/entity-search"
import { findProfileDay, orderedDays, resolveSlotForDayPeriod, type ProfileDay } from "../lib/schedule-time"
import { ALL_WEEKDAYS, scheduleDayFromSchoolDate, scheduleDayLabel } from "../lib/schedule-constants"
import { normalizeSubjectName, subjectNameProblem } from "../lib/subject-constants"

// --- A. penerapan kandidat -------------------------------------------------

const TEACHERS: InternalEntity[] = [
  { id: "t-alamsyah", name: "Bpk. Muhammad Nur Alamsyah, S.Pd" },
  { id: "t-nurvita", name: "Nurvita Fitri Salvia, S.Pd" },
  { id: "t-aviana", name: "Aviana Trisepti Rusdiana, S.Pd" },
]

function planFor(
  externals: readonly { externalId: string; name: string }[],
  existing: ReadonlyMap<string, InternalEntity> = new Map(),
): MappingPlan {
  return buildMappingPlan(externals, existing, TEACHERS, { normalize: normalizePersonName })
}

test("kandidat diterapkan ketika nama hanya berbeda tanda baca gelar", () => {
  // Kasus nyata dari berkas aSc: "S.Pd." versus "S.Pd".
  const plan = planFor([{ externalId: "11E6AAC746FDA997", name: "Aviana Trisepti Rusdiana, S.Pd." }])
  const [row] = plan.rows

  assert.equal(applicableCandidateId(row), "t-aviana")
})

test("baris yang sudah dipetakan tidak pernah menghasilkan penerapan kandidat", () => {
  const existing = new Map([["ID-1", TEACHERS[1]]])
  const plan = planFor([{ externalId: "ID-1", name: "Aviana Trisepti Rusdiana, S.Pd." }], existing)
  const [row] = plan.rows

  // Meski namanya jelas mengarah ke Aviana, pemetaan manual ke Nurvita menang:
  // penerapan kandidat tidak boleh menimpa keputusan yang sudah diambil admin.
  assert.equal(row.mappedId, "t-nurvita")
  assert.equal(applicableCandidateId(row), null)
})

test("nama tanpa kandidat tidak menghasilkan penerapan", () => {
  const plan = planFor([{ externalId: "ID-X", name: "Entah Siapa" }])
  assert.equal(applicableCandidateId(plan.rows[0]), null)
})

test("kandidat ambigu tidak pernah diterapkan otomatis", () => {
  // Dua entitas internal dengan nama yang sama setelah normalisasi: tidak ada
  // dasar untuk memilih salah satunya, jadi sistem harus diam.
  const kembar: InternalEntity[] = [
    { id: "a", name: "Siti Aminah, S.Pd" },
    { id: "b", name: "Siti Aminah S.Pd." },
  ]
  const plan = buildMappingPlan([{ externalId: "ID-K", name: "Siti Aminah, S.Pd." }], new Map(), kembar, {
    normalize: normalizePersonName,
  })

  assert.equal(applicableCandidateId(plan.rows[0]), null)
})

test("penerapan massal hanya menyentuh baris yang aman", () => {
  const existing = new Map([["ID-SUDAH", TEACHERS[0]]])
  const plan = planFor(
    [
      { externalId: "ID-SUDAH", name: "Nurvita Fitri Salvia, S.Pd" },
      { externalId: "ID-AMAN", name: "Aviana Trisepti Rusdiana, S.Pd." },
      { externalId: "ID-ASING", name: "Nama Yang Tidak Ada" },
    ],
    existing,
  )

  const applications = bulkCandidateApplications(plan)

  assert.deepEqual(
    applications.map((item) => item.externalId),
    ["ID-AMAN"],
  )
  assert.equal(applications[0].internalId, "t-aviana")
})

test("penerapan massal membawa externalName agar pemetaan tetap berbasis ID aSc", () => {
  const plan = planFor([{ externalId: "ID-AMAN", name: "Aviana Trisepti Rusdiana, S.Pd." }])
  const [application] = bulkCandidateApplications(plan)

  // Yang disimpan adalah pasangan ID; nama hanya ikut sebagai keterangan.
  assert.equal(application.externalId, "ID-AMAN")
  assert.equal(application.internalId, "t-aviana")
  assert.equal(application.externalName, "Aviana Trisepti Rusdiana, S.Pd.")
})

test("penerapan massal pada rencana tanpa kandidat menghasilkan daftar kosong", () => {
  const plan = planFor([{ externalId: "ID-ASING", name: "Nama Yang Tidak Ada" }])
  assert.deepEqual(bulkCandidateApplications(plan), [])
})

// --- B. pencarian pemilih --------------------------------------------------

const NAMES = TEACHERS.map((teacher) => teacher.name)

test("pencarian bersifat substring, bukan hanya awalan", () => {
  const hits = filterBySearchQuery(NAMES, "alam", (name) => name)
  assert.deepEqual(hits, ["Bpk. Muhammad Nur Alamsyah, S.Pd"])
})

test("satu kata dapat menemukan beberapa nama", () => {
  const hits = filterBySearchQuery(NAMES, "nur", (name) => name)
  assert.deepEqual(hits, ["Bpk. Muhammad Nur Alamsyah, S.Pd", "Nurvita Fitri Salvia, S.Pd"])
})

test("pencarian tidak memedulikan besar kecil huruf", () => {
  assert.deepEqual(
    filterBySearchQuery(NAMES, "ALAM", (name) => name),
    filterBySearchQuery(NAMES, "alam", (name) => name),
  )
})

test("gelar, titik, dan koma tidak merusak pencarian", () => {
  assert.ok(matchesSearchQuery("Bpk. Muhammad Nur Alamsyah, S.Pd", "s.pd"))
  assert.ok(matchesSearchQuery("Bpk. Muhammad Nur Alamsyah, S.Pd", "muhammad, alamsyah"))
})

test("urutan kata tidak wajib sama", () => {
  assert.ok(matchesSearchQuery("Bpk. Muhammad Nur Alamsyah, S.Pd", "alamsyah muhammad"))
})

test("spasi berlebih diperlakukan wajar", () => {
  assert.ok(matchesSearchQuery("Nurvita Fitri Salvia, S.Pd", "  nurvita   fitri  "))
  assert.equal(normalizeSearchText("  Bpk.  Muhammad  "), "bpk muhammad")
})

test("kueri kosong mengembalikan seluruh pilihan", () => {
  assert.deepEqual(filterBySearchQuery(NAMES, "", (name) => name), NAMES)
  assert.deepEqual(filterBySearchQuery(NAMES, "   ", (name) => name), NAMES)
})

test("kueri yang tidak cocok mengembalikan daftar kosong", () => {
  assert.deepEqual(filterBySearchQuery(NAMES, "zzzz", (name) => name), [])
})

// --- C. pemetaan hari ------------------------------------------------------

/** Profil uji: tiap hari sengaja diberi jam mulai berbeda agar tertukar terlihat. */
function profileDays(): ProfileDay[] {
  return [1, 2, 3, 4, 5, 6].map((day) => ({
    id: `day-${day}`,
    day,
    position: day,
    slots: [
      {
        id: `slot-${day}`,
        position: 1,
        kind: "PELAJARAN" as const,
        name: `Jam ke-1 ${scheduleDayLabel(day)}`,
        // Menit mulai unik per hari: inilah penanda hari mana yang terbaca.
        startMinute: 7 * 60 + day,
        endMinute: 7 * 60 + 40 + day,
        ascPeriod: 1,
      },
    ],
  }))
}

test("setiap hari Senin sampai Sabtu membaca konfigurasi hari itu sendiri", () => {
  const days = profileDays()

  for (const day of [1, 2, 3, 4, 5, 6]) {
    const found = findProfileDay(days, day)
    assert.ok(found, `hari ${day} tidak ditemukan`)
    assert.equal(found.day, day)
    // Bug aslinya: apa pun harinya, yang terbaca adalah Senin (menit 421).
    assert.equal(found.slots[0].startMinute, 7 * 60 + day)
  }
})

test("tidak ada hari yang diam-diam jatuh ke Senin", () => {
  const days = profileDays()
  const starts = [1, 2, 3, 4, 5, 6].map((day) => findProfileDay(days, day)?.slots[0].startMinute)

  assert.equal(new Set(starts).size, 6)
})

test("nomor jam diselesaikan per hari, bukan dari satu daftar generik", () => {
  const days = profileDays()

  for (const day of [1, 2, 3, 4, 5, 6]) {
    const slot = resolveSlotForDayPeriod(days, day, 1)
    assert.ok(slot)
    assert.equal(slot.startMinute, 7 * 60 + day)
  }
})

test("hari yang tidak terkonfigurasi mengembalikan null, bukan struktur Senin", () => {
  // Minggu tidak ada di profil uji. Mengembalikan Senin di sini persis bug
  // yang dilaporkan: kolom berlabel satu hari menampilkan kegiatan hari lain.
  assert.equal(findProfileDay(profileDays(), 7), null)
  assert.equal(resolveSlotForDayPeriod(profileDays(), 7, 1), null)
})

test("nomor jam yang tidak dikenal suatu hari tidak dipinjam dari hari lain", () => {
  const base = profileDays()
  // Hanya Sabtu yang punya jam ke-9.
  const days = base.map((day) =>
    day.day === 6
      ? {
          ...day,
          slots: [
            ...day.slots,
            {
              id: "slot-6-9",
              position: 2,
              kind: "PELAJARAN" as const,
              name: "Jam ke-9 Sabtu",
              startMinute: 13 * 60,
              endMinute: 13 * 60 + 40,
              ascPeriod: 9,
            },
          ],
        }
      : day,
  )

  assert.ok(resolveSlotForDayPeriod(days, 6, 9))
  assert.equal(resolveSlotForDayPeriod(days, 1, 9), null)
})

test("urutan hari mengikuti nomor hari, bukan urutan penyimpanan", () => {
  const shuffled = [...profileDays()].reverse()
  assert.deepEqual(
    orderedDays(shuffled).map((item) => item.day),
    [1, 2, 3, 4, 5, 6],
  )
})

test("label hari cocok dengan nomor harinya", () => {
  assert.equal(scheduleDayLabel(1), "Senin")
  assert.equal(scheduleDayLabel(4), "Kamis")
  assert.equal(scheduleDayLabel(6), "Sabtu")
})

test("tanggal sekolah dipetakan ke nomor hari yang benar", () => {
  // 2026-09-14 adalah Senin, 2026-09-17 Kamis, 2026-09-19 Sabtu.
  // Nilai tanggal-saja harus bebas zona waktu: hasilnya tidak boleh bergeser
  // hanya karena mesin yang menjalankan test berada di luar Asia/Jakarta.
  assert.equal(scheduleDayFromSchoolDate("2026-09-14"), 1)
  assert.equal(scheduleDayFromSchoolDate("2026-09-17"), 4)
  assert.equal(scheduleDayFromSchoolDate("2026-09-19"), 6)
})

test("Minggu bukan hari sekolah", () => {
  assert.equal(scheduleDayFromSchoolDate("2026-09-20"), null)
})

test("seluruh hari dalam katalog memiliki label", () => {
  for (const day of ALL_WEEKDAYS) {
    assert.equal(typeof scheduleDayLabel(day), "string")
    assert.notEqual(scheduleDayLabel(day), "")
  }
})

// --- D. Data Master Mata Pelajaran ----------------------------------------

test("nama mata pelajaran dirapikan sebelum disimpan", () => {
  assert.equal(normalizeSubjectName("  Bahasa   Indonesia "), "Bahasa Indonesia")
})

test("nama mata pelajaran kosong ditolak", () => {
  assert.ok(subjectNameProblem("   "))
})

test("nama mata pelajaran yang wajar diterima", () => {
  assert.equal(subjectNameProblem("Ilmu Pengetahuan Alam"), null)
})

test("nama mata pelajaran terlalu panjang ditolak", () => {
  assert.ok(subjectNameProblem("x".repeat(200)))
})

test("mata pelajaran dapat dicari dengan pemilih yang sama", () => {
  const subjects = ["Bahasa Indonesia", "Bahasa Inggris", "Matematika"]
  assert.deepEqual(filterBySearchQuery(subjects, "bahasa", (name) => name), [
    "Bahasa Indonesia",
    "Bahasa Inggris",
  ])
})
