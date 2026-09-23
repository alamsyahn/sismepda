/**
 * Mention guru yang sedang mengajar pada pengingat "Belum Semua Rekap".
 *
 * YANG DIJAGA BERKAS INI
 *
 * 1. POSISI TAG MILIK ADMIN. Mention muncul persis di tempat
 *    `{{tag_guru_pengajar}}` ditulis, dan hilang sepenuhnya bila tidak ditulis.
 * 2. TEMPLATE ADALAH SUMBER KEBENARAN METADATA. JID hanya ikut terkirim bila
 *    teksnya memang menyebut guru itu.
 * 3. DI LUAR JAM PELAJARAN TIDAK ADA GURU. Istirahat, kegiatan, dan jam kosong
 *    menghasilkan tag kosong — bukan guru jam sebelumnya, bukan wali kelas.
 * 4. NOMOR YANG TIDAK DAPAT DIPAKAI TIDAK MENGGAGALKAN PESAN.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { normalizeIndonesianPhone } from "@/lib/phone-number"
import type { CurrentSlotResult, TimeSlot } from "@/lib/schedule-time"
import { currentSlot } from "@/lib/schedule-time"
import type { WhatsAppReportClass } from "@/lib/whatsapp-report"
import { buildTemplateContext } from "@/lib/whatsapp-template-context"
import { SAMPLE_CONTEXT } from "@/lib/whatsapp-template-sample"
import { defaultTemplate } from "@/lib/whatsapp-template-defaults"
import {
  CLASS_ITEM_PLACEHOLDERS,
  ITEM_PLACEHOLDERS,
  renderMessage,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-template"
import { TEACHER_TAG_PLACEHOLDER, teacherTagsFor } from "@/lib/whatsapp-teacher-tag"

// --- data bantu ------------------------------------------------------------

function pendingClass(id: string, name: string, unfilled: number): WhatsAppReportClass {
  return {
    id,
    name,
    grade: name.startsWith("VII ") ? "VII" : "VIII",
    submitted: false,
    homeroomName: "Bu Ani",
    studentCount: unfilled,
    students: Array.from({ length: unfilled }, (_, index) => ({
      id: `${id}-s${index}`,
      name: `Siswa ${index}`,
      status: null,
      note: null,
    })),
  }
}

const CLASSES = [
  pendingClass("c7a", "VII A", 28),
  pendingClass("c7b", "VII B", 5),
  pendingClass("c8a", "VIII A", 30),
]

const JID_A = "628111111111@s.whatsapp.net"
const JID_B = "628222222222@s.whatsapp.net"

/** 7A dan 7B punya guru berjalan; 8A tidak. */
const TAGS = new Map<string, readonly string[]>([
  ["c7a", [JID_A]],
  ["c7b", [JID_B]],
])

function contextWithTags(tags: ReadonlyMap<string, readonly string[]> = TAGS) {
  return buildTemplateContext({
    dateLabel: "Rabu, 16 September 2026",
    slot: "08:00",
    schoolName: "SMPN 1",
    classes: CLASSES,
    teacherTags: tags,
  })
}

function templateWith(format: string): WhatsAppTemplate {
  return {
    body: "{{daftar_kelas_belum_rekap}}",
    items: { daftar_kelas_belum_rekap: { format, separator: "NEWLINE" } },
  }
}

function lessonSlot(period: number, start: number, end: number): TimeSlot {
  return {
    id: `p${period}`,
    position: period,
    kind: "PELAJARAN",
    name: `Jam ke-${period}`,
    startMinute: start,
    endMinute: end,
    ascPeriod: period,
  }
}

const DAY_SLOTS: readonly TimeSlot[] = [
  lessonSlot(1, 7 * 60, 7 * 60 + 40),
  lessonSlot(2, 7 * 60 + 40, 8 * 60 + 20),
  {
    id: "istirahat",
    position: 3,
    kind: "ISTIRAHAT",
    name: "Istirahat 1",
    startMinute: 8 * 60 + 20,
    endMinute: 8 * 60 + 40,
    ascPeriod: null,
  },
  {
    id: "apel",
    position: 4,
    kind: "KEGIATAN",
    name: "Apel",
    startMinute: 8 * 60 + 40,
    endMinute: 9 * 60,
    ascPeriod: null,
  },
]

const LESSON: CurrentSlotResult = currentSlot(DAY_SLOTS, 8 * 60)

// --- A. VARIABLE / FORMATTER ----------------------------------------------

test("A-1. {{tag_guru_pengajar}} di akhir item → mention muncul di akhir", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} (kurang {{jumlah_siswa_belum_diisi}} anak) {{tag_guru_pengajar}}"),
    contextWithTags(),
  )
  assert.equal(
    result.text,
    [
      "1. 7A (kurang 28 anak) @628111111111",
      "2. 7B (kurang 5 anak) @628222222222",
      "3. 8A (kurang 30 anak)",
    ].join("\n"),
  )
})

test("A-2. {{tag_guru_pengajar}} sebelum nama kelas → mention ikut berpindah", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{tag_guru_pengajar}} — {{nama_kelas}} — kurang {{jumlah_siswa_belum_diisi}}"),
    contextWithTags(),
  )
  assert.equal(
    result.text,
    ["@628111111111 — 7A — kurang 28", "@628222222222 — 7B — kurang 5", "— 8A — kurang 30"].join(
      "\n",
    ),
  )
})

test("A-2b. tag di tengah baris tetap menghasilkan JID yang benar", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} {{tag_guru_pengajar}} (kurang {{jumlah_siswa_belum_diisi}} anak)"),
    contextWithTags(),
  )
  assert.equal(
    result.text,
    [
      "1. 7A @628111111111 (kurang 28 anak)",
      "2. 7B @628222222222 (kurang 5 anak)",
      "3. 8A (kurang 30 anak)",
    ].join("\n"),
  )
  assert.deepEqual(result.mentions, [JID_A, JID_B])
})

test("A-3. template tanpa {{tag_guru_pengajar}} → tanpa mention teks maupun metadata", () => {
  // INI ATURAN POKOKNYA: sistem boleh tahu siapa yang sedang mengajar, tetapi
  // memanggilnya tanpa menyebutnya di dalam teks berarti mengirim notifikasi
  // pribadi atas kalimat yang tidak pernah menyebut namanya.
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} (kurang {{jumlah_siswa_belum_diisi}} anak)"),
    contextWithTags(),
  )
  assert.equal(
    result.text,
    ["1. 7A (kurang 28 anak)", "2. 7B (kurang 5 anak)", "3. 8A (kurang 30 anak)"].join("\n"),
  )
  assert.deepEqual(result.mentions, [])
  assert.ok(!result.text.includes("@62"))
})

test("A-4. format item lama tanpa variabel baru tetap dirender apa adanya", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} — {{wali_kelas}}"),
    contextWithTags(),
  )
  assert.equal(result.text, "1. 7A — Bu Ani\n2. 7B — Bu Ani\n3. 8A — Bu Ani")
  assert.deepEqual(result.mentions, [])
})

test("A-4b. konteks tanpa data jadwal tetap merender daftar, tag menjadi kosong", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} {{tag_guru_pengajar}}"),
    buildTemplateContext({
      dateLabel: "Rabu, 16 September 2026",
      slot: "08:00",
      schoolName: "SMPN 1",
      classes: CLASSES,
    }),
  )
  assert.equal(result.text, "1. 7A\n2. 7B\n3. 8A")
  assert.deepEqual(result.mentions, [])
})

test("A-5. variabel baru terdaftar sehingga muncul di editor dan lolos validasi", () => {
  assert.ok(TEACHER_TAG_PLACEHOLDER in CLASS_ITEM_PLACEHOLDERS)
  assert.ok(TEACHER_TAG_PLACEHOLDER in ITEM_PLACEHOLDERS.daftar_kelas_belum_rekap)
})

test("A-5b. pratinjau memakai data contoh dan tidak pernah membangun JID", () => {
  const preview = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} (kurang {{jumlah_siswa_belum_diisi}} anak) {{tag_guru_pengajar}}"),
    SAMPLE_CONTEXT,
  )
  assert.equal(
    preview.text,
    [
      "1. 7A (kurang 28 anak) @628123456789",
      "2. 7B (kurang 5 anak) @628987654321",
      "3. 8A (kurang 30 anak)",
    ].join("\n"),
  )
  assert.deepEqual(preview.mentions, [])

  // Menghapus variabelnya juga menghapus tag dari pratinjau.
  const without = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} (kurang {{jumlah_siswa_belum_diisi}} anak)"),
    SAMPLE_CONTEXT,
  )
  assert.ok(!without.text.includes("@62"))
})

test("A-6. template bawaan memakai format item yang baru", () => {
  assert.equal(
    defaultTemplate("MISSING_PENDING").items.daftar_kelas_belum_rekap?.format,
    "{{no}}. {{nama_kelas}} (kurang {{jumlah_siswa_belum_diisi}} anak) {{tag_guru_pengajar}}",
  )
})

test("A-7. pemisah baris kosong tetap bekerja bersama tag", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    {
      body: "{{daftar_kelas_belum_rekap}}",
      items: {
        daftar_kelas_belum_rekap: {
          format: "{{nama_kelas}} {{tag_guru_pengajar}}",
          separator: "BLANK_LINE",
        },
      },
    },
    contextWithTags(),
  )
  assert.equal(result.text, "7A @628111111111\n\n7B @628222222222\n\n8A")
})

// --- B. JADWAL -------------------------------------------------------------

test("B-6. sedang pembelajaran dan guru punya nomor → tag tersedia", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [{ classId: "c7a", teacherId: "t1", phone: "08111111111" }],
  })
  assert.deepEqual([...tags.get("c7a")!], [JID_A])
})

test("B-7. sedang istirahat → tag kosong", () => {
  const tags = teacherTagsFor({
    current: currentSlot(DAY_SLOTS, 8 * 60 + 30),
    teachers: [{ classId: "c7a", teacherId: "t1", phone: "08111111111" }],
  })
  assert.equal(tags.size, 0)
})

test("B-8. sedang kegiatan (apel) → tag kosong", () => {
  const tags = teacherTagsFor({
    current: currentSlot(DAY_SLOTS, 8 * 60 + 50),
    teachers: [{ classId: "c7a", teacherId: "t1", phone: "08111111111" }],
  })
  assert.equal(tags.size, 0)
})

test("B-9a. di luar jam sekolah → tag kosong", () => {
  const tags = teacherTagsFor({
    current: currentSlot(DAY_SLOTS, 6 * 60),
    teachers: [{ classId: "c7a", teacherId: "t1", phone: "08111111111" }],
  })
  assert.equal(tags.size, 0)
})

test("B-9b. tidak ada penempatan pada slot berjalan → kelas itu tanpa tag", () => {
  const tags = teacherTagsFor({ current: LESSON, teachers: [] })
  assert.equal(tags.get("c7a"), undefined)
})

test("B-9c. slot terisi tanpa guru yang terpetakan → tag kosong", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [{ classId: "c7a", teacherId: null, phone: "08111111111" }],
  })
  assert.equal(tags.size, 0)
})

test("B-10. guru tanpa nomor → tag kosong, kelas lain tidak terpengaruh", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [
      { classId: "c7a", teacherId: "t1", phone: null },
      { classId: "c7b", teacherId: "t2", phone: "08222222222" },
    ],
  })
  assert.equal(tags.get("c7a"), undefined)
  assert.deepEqual([...tags.get("c7b")!], [JID_B])
})

test("B-11. kelas berbeda pada waktu yang sama mendapat gurunya masing-masing", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [
      { classId: "c7a", teacherId: "t1", phone: "08111111111" },
      { classId: "c7b", teacherId: "t2", phone: "08222222222" },
    ],
  })
  assert.deepEqual([...tags.get("c7a")!], [JID_A])
  assert.deepEqual([...tags.get("c7b")!], [JID_B])
})

test("B-12. dua guru pada kelas dan slot yang sama → dua mention, tanpa duplikat", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [
      { classId: "c7a", teacherId: "t1", phone: "08111111111" },
      { classId: "c7a", teacherId: "t2", phone: "08222222222" },
      { classId: "c7a", teacherId: "t3", phone: "+628111111111" },
    ],
  })
  assert.deepEqual([...tags.get("c7a")!], [JID_A, JID_B])
})

// --- C. NOMOR --------------------------------------------------------------

test("C-12..14. tiga bentuk nomor yang sama menghasilkan satu JID", () => {
  for (const raw of ["08111111111", "+628111111111", "628111111111", "0811-111-1111"]) {
    const normalized = normalizeIndonesianPhone(raw)
    assert.ok(normalized.valid, raw)
    assert.equal(normalized.whatsapp, "628111111111")
    const tags = teacherTagsFor({
      current: LESSON,
      teachers: [{ classId: "c7a", teacherId: "t1", phone: raw }],
    })
    assert.deepEqual([...tags.get("c7a")!], [JID_A], raw)
  }
})

test("C-15. nomor tidak sah dilewati tanpa menggagalkan penyusunan pesan", () => {
  const tags = teacherTagsFor({
    current: LESSON,
    teachers: [
      { classId: "c7a", teacherId: "t1", phone: "bukan nomor" },
      { classId: "c7b", teacherId: "t2", phone: "1234" },
      { classId: "c8a", teacherId: "t3", phone: "08222222222" },
    ],
  })
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{no}}. {{nama_kelas}} {{tag_guru_pengajar}}"),
    contextWithTags(tags),
  )
  assert.equal(result.text, "1. 7A\n2. 7B\n3. 8A @628222222222")
  assert.deepEqual(result.mentions, [JID_B])
})

// --- D. WHATSAPP -----------------------------------------------------------

test("D-16. setiap mention pada teks punya padanan di metadata, dan sebaliknya", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{nama_kelas}} {{tag_guru_pengajar}}"),
    contextWithTags(),
  )
  const inText = [...result.text.matchAll(/@(\d+)/g)].map((match) => `${match[1]}@s.whatsapp.net`)
  assert.deepEqual([...new Set(inText)].sort(), [...result.mentions].sort())
})

test("D-18. guru yang sama pada dua kelas hanya sekali di metadata", () => {
  const result = renderMessage(
    "MISSING_PENDING",
    templateWith("{{nama_kelas}} {{tag_guru_pengajar}}"),
    contextWithTags(
      new Map([
        ["c7a", [JID_A]],
        ["c7b", [JID_A]],
      ]),
    ),
  )
  // Teks mengikuti template apa adanya: dua baris memang menyebut guru itu.
  assert.equal(result.text, "7A @628111111111\n7B @628111111111\n8A")
  assert.deepEqual(result.mentions, [JID_A])
})

test("D-19. kondisi lain tanpa daftar kelas tetap tersusun tanpa mention", () => {
  const result = renderMessage(
    "MISSING_COMPLETE",
    defaultTemplate("MISSING_COMPLETE"),
    contextWithTags(),
  )
  assert.match(result.text, /Seluruh kelas telah mengisi absensi\./)
  assert.deepEqual(result.mentions, [])
})
