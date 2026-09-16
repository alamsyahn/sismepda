/**
 * Template pesan WhatsApp: rendering, pemilihan kondisi, dan validasi.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Teks pesan otomatis kini data milik admin, bukan konstanta. Yang harus dijaga
 * karena itu bukan lagi "bunyi pesannya begini", melainkan aturan yang membuat
 * pesan tetap benar apa pun isinya: kondisi mana yang memilih template mana,
 * placeholder apa yang sah, dan bahwa isi data tidak pernah ikut diperlakukan
 * sebagai template.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import type { WhatsAppReportClass } from "@/lib/whatsapp-report"
import {
  MAX_BODY_LENGTH,
  renderCollection,
  renderTemplate,
  templateErrorMessage,
  validateTemplate,
  validateText,
  allowedPlaceholders,
  collectionsFor,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-template"
import { DEFAULT_TEMPLATES, defaultTemplate } from "@/lib/whatsapp-template-defaults"
import {
  absentStudentRows,
  buildTemplateContext,
  pendingClassRows,
  templateKeyFor,
} from "@/lib/whatsapp-template-context"
import {
  customizedKeys,
  effectiveTemplate,
  parseStoredTemplates,
  serializeTemplates,
} from "@/lib/whatsapp-template-store"

type StudentSpec = {
  id: string
  name: string
  status: WhatsAppReportClass["students"][number]["status"]
  note?: string | null
}

function classOf(
  name: string,
  submitted: boolean,
  students: StudentSpec[],
  homeroomName: string | null = null,
): WhatsAppReportClass {
  return {
    id: `c-${name}`,
    name,
    grade: "VII",
    submitted,
    homeroomName,
    studentCount: students.length,
    students: students.map((student) => ({ ...student, note: student.note ?? null })),
  }
}

const COMPLETE = classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }])
const PENDING = classOf("VII B", false, [])

// --- 1-4: rendering dasar ---------------------------------------------------

test("placeholder scalar ter-render", () => {
  const output = renderTemplate(
    "MISSING_COMPLETE",
    { body: "Halo {{nama_sekolah}} pada {{tanggal}}", items: {} },
    { scalars: { nama_sekolah: "SMPN 1", tanggal: "16 September 2026" }, collections: {} },
  )
  assert.equal(output, "Halo SMPN 1 pada 16 September 2026")
})

test("template multiline mempertahankan setiap baris", () => {
  const body = "baris satu\nbaris dua\n\nbaris empat"
  const output = renderTemplate("MISSING_COMPLETE", { body, items: {} }, {
    scalars: {},
    collections: {},
  })
  assert.equal(output, body)
})

test("emoji bertahan apa adanya", () => {
  const output = renderTemplate(
    "MISSING_COMPLETE",
    { body: "⚠️ *PENGINGAT* 📅 {{tanggal}}", items: {} },
    { scalars: { tanggal: "16 September 2026" }, collections: {} },
  )
  assert.equal(output, "⚠️ *PENGINGAT* 📅 16 September 2026")
})

test("format WhatsApp tidak diubah penyusun pesan", () => {
  // Penyusun hanya mengganti placeholder; ia tidak boleh punya pendapat tentang
  // tanda bintang atau garis bawah, karena itu sintaks milik WhatsApp.
  const body = "*tebal* _miring_ ~coret~ ```kode```"
  const output = renderTemplate("MISSING_COMPLETE", { body, items: {} }, {
    scalars: {},
    collections: {},
  })
  assert.equal(output, body)
})

// --- 5: placeholder tak dikenal --------------------------------------------

test("placeholder tak dikenal terdeteksi beserta namanya", () => {
  const errors = validateText("Sakit: {{jumlah_sakitt}}", allowedPlaceholders("ABSENT_PRESENT"), MAX_BODY_LENGTH)
  assert.equal(errors.length, 1)
  assert.deepEqual(errors[0], { kind: "UNKNOWN_PLACEHOLDER", name: "jumlah_sakitt" })
  assert.equal(templateErrorMessage(errors[0]), "Variabel tidak dikenal: {{jumlah_sakitt}}")
})

test("placeholder koleksi hanya sah pada template yang memang memilikinya", () => {
  // `daftar_siswa_tidak_hadir` tidak berarti apa-apa pada pengingat rekap.
  assert.equal(allowedPlaceholders("MISSING_PENDING").has("daftar_kelas_belum_rekap"), true)
  assert.equal(allowedPlaceholders("MISSING_PENDING").has("daftar_siswa_tidak_hadir"), false)
  assert.equal(collectionsFor("ABSENT_NONE").length, 0)
})

test("template bawaan seluruhnya lolos validasinya sendiri", () => {
  // Menjaga agar teks bawaan tidak pernah memakai variabel yang tidak terdaftar.
  for (const key of ["MISSING_PENDING", "MISSING_COMPLETE", "ABSENT_PRESENT", "ABSENT_NONE"] as const) {
    assert.deepEqual(validateTemplate(key, DEFAULT_TEMPLATES[key]), [], key)
  }
})

test("template kosong dan terlalu panjang ditolak", () => {
  const allowed = allowedPlaceholders("MISSING_COMPLETE")
  assert.deepEqual(validateText("   ", allowed, MAX_BODY_LENGTH), [{ kind: "EMPTY_BODY" }])
  const long = "x".repeat(MAX_BODY_LENGTH + 1)
  assert.deepEqual(validateText(long, allowed, MAX_BODY_LENGTH), [
    { kind: "TOO_LONG", limit: MAX_BODY_LENGTH },
  ])
})

// --- 6: fallback ke bawaan --------------------------------------------------

test("tanpa template tersimpan, yang dipakai adalah bawaan", () => {
  const stored = parseStoredTemplates(null)
  assert.deepEqual(stored, {})
  assert.deepEqual(effectiveTemplate("MISSING_PENDING", stored), defaultTemplate("MISSING_PENDING"))
})

test("template tersimpan yang rusak tidak membungkam kondisi lain", () => {
  // Hanya satu kondisi yang rusak; tiga sisanya harus tetap terkirim.
  const stored = parseStoredTemplates({
    MISSING_PENDING: { body: "Salah {{tidak_ada}}", items: {} },
    MISSING_COMPLETE: { body: "Beres {{tanggal}}", items: {} },
  })
  assert.equal(stored.MISSING_PENDING, undefined)
  assert.equal(stored.MISSING_COMPLETE?.body, "Beres {{tanggal}}")
  assert.deepEqual(effectiveTemplate("MISSING_PENDING", stored), defaultTemplate("MISSING_PENDING"))
})

test("JSON yang bentuknya sama sekali asing diperlakukan sebagai belum disunting", () => {
  assert.deepEqual(parseStoredTemplates("bukan objek"), {})
  assert.deepEqual(parseStoredTemplates(42), {})
  assert.deepEqual(parseStoredTemplates({ MISSING_PENDING: { body: 7 } }), {})
})

test("reset menyimpan NULL, bukan salinan template bawaan", () => {
  // Salinan bawaan akan membeku: perbaikan teks bawaan pada rilis berikutnya
  // tidak akan pernah sampai ke baris yang terlanjur tersalin.
  assert.equal(serializeTemplates({}), null)
  const custom = { MISSING_COMPLETE: { body: "Beres", items: {} } }
  assert.deepEqual(serializeTemplates(custom), custom)
  assert.deepEqual(customizedKeys(custom), ["MISSING_COMPLETE"])
})

// --- 7-10: koleksi kelas ----------------------------------------------------

const THREE_PENDING = [
  classOf("VII A", false, [], "Bu Ani"),
  classOf("VII B", false, [], "Pak Budi"),
  classOf("VIII A", false, [], "Bu Sari"),
]

test("daftar_kelas_belum_rekap memakai template item", () => {
  const rows = pendingClassRows(THREE_PENDING)
  const output = renderCollection("{{no}}. *{{nama_kelas}}* — {{wali_kelas}}", "NEWLINE", rows)
  assert.equal(output, "1. *7A* — Bu Ani\n2. *7B* — Pak Budi\n3. *8A* — Bu Sari")
})

test("penomoran {{no}} mengikuti urutan item, mulai dari satu", () => {
  const rows = pendingClassRows(THREE_PENDING)
  assert.deepEqual(
    rows.map((_, index) => index + 1),
    [1, 2, 3],
  )
  const output = renderCollection("{{no}}", "NEWLINE", rows)
  assert.equal(output, "1\n2\n3")
})

test("pemisah baris kosong benar-benar menghasilkan baris kosong", () => {
  const rows = pendingClassRows(THREE_PENDING.slice(0, 2))
  assert.equal(renderCollection("{{nama_kelas}}", "NEWLINE", rows), "7A\n7B")
  assert.equal(renderCollection("{{nama_kelas}}", "BLANK_LINE", rows), "7A\n\n7B")
})

test("kelas tanpa wali ditampilkan sebagai tanda hubung, bukan kosong", () => {
  const rows = pendingClassRows([classOf("VII A", false, [], null)])
  assert.equal(rows[0].wali_kelas, "-")
})

test("kelas tersimpan sebagian ikut terdaftar beserta jumlah yang belum diisi", () => {
  const partial = classOf("VII A", true, [
    { id: "s1", name: "Ahmad", status: null },
    { id: "s2", name: "Budi", status: null },
  ])
  const rows = pendingClassRows([partial])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].jumlah_siswa_belum_diisi, "2")
})

// --- 11-12: koleksi siswa ---------------------------------------------------

const ABSENT_CLASSES = [
  classOf("VII A", true, [
    { id: "s1", name: "Ahmad", status: "SAKIT", note: "Demam" },
    { id: "s2", name: "Budi", status: "IZIN", note: "Acara keluarga" },
  ]),
  classOf("VII B", true, [{ id: "s3", name: "Dewi", status: "ALFA" }]),
]

test("daftar_siswa_tidak_hadir memakai template item beserta status dan keterangan", () => {
  const rows = absentStudentRows(ABSENT_CLASSES)
  const output = renderCollection(
    "{{no}}. *{{nama_siswa}}* — {{nama_kelas}}\n   {{status}} — {{keterangan}}",
    "BLANK_LINE",
    rows,
  )
  assert.equal(
    output,
    "1. *Ahmad* — 7A\n   SAKIT — Demam\n\n2. *Budi* — 7A\n   IZIN — Acara keluarga\n\n3. *Dewi* — 7B\n   ALFA — -",
  )
})

test("baris dikelompokkan menurut status, menggantikan bagian per status pesan lama", () => {
  const rows = absentStudentRows([
    classOf("VII A", true, [
      { id: "s1", name: "Alfa satu", status: "ALFA" },
      { id: "s2", name: "Sakit satu", status: "SAKIT" },
      { id: "s3", name: "Izin satu", status: "IZIN" },
      { id: "s4", name: "Dispen satu", status: "DISPENSASI" },
    ]),
  ])
  assert.deepEqual(
    rows.map((row) => row.status),
    ["SAKIT", "IZIN", "ALFA", "DISPENSASI"],
  )
})

test("siswa tanpa status tidak pernah dihitung tidak hadir", () => {
  // `null` berarti datanya belum masuk, bukan siswa itu tidak hadir.
  const rows = absentStudentRows([classOf("VII A", false, [{ id: "s1", name: "Ahmad", status: null }])])
  assert.deepEqual(rows, [])
})

// --- 13-16: pemilihan kondisi ----------------------------------------------

test("masih ada kelas belum rekap memilih template A", () => {
  assert.equal(templateKeyFor("ATTENDANCE_MISSING", [COMPLETE, PENDING]), "MISSING_PENDING")
})

test("seluruh kelas selesai memilih template B", () => {
  assert.equal(templateKeyFor("ATTENDANCE_MISSING", [COMPLETE]), "MISSING_COMPLETE")
})

test("ada siswa tidak hadir memilih template C", () => {
  assert.equal(templateKeyFor("ATTENDANCE_ABSENT", ABSENT_CLASSES), "ABSENT_PRESENT")
})

test("tidak ada siswa tidak hadir memilih template D", () => {
  const allPresent = classOf("VII A", true, [])
  assert.equal(templateKeyFor("ATTENDANCE_ABSENT", [allPresent]), "ABSENT_NONE")
})

test("kondisi tidak tertukar antara dua jenis laporan", () => {
  // Kelas yang belum merekap TIDAK boleh membuat rekap kehadiran mengira ada
  // siswa tidak hadir, dan sebaliknya.
  assert.equal(templateKeyFor("ATTENDANCE_ABSENT", [PENDING]), "ABSENT_NONE")
  assert.equal(templateKeyFor("ATTENDANCE_MISSING", ABSENT_CLASSES), "MISSING_COMPLETE")
})

// --- konteks ----------------------------------------------------------------

test("angka pada konteks konsisten dengan daftar yang dirender", () => {
  const context = buildTemplateContext({
    dateLabel: "16 September 2026",
    slot: "08:00",
    schoolName: "SMPN 1",
    classes: [...ABSENT_CLASSES, PENDING],
  })
  assert.equal(context.scalars.waktu, "08.00")
  assert.equal(context.scalars.jumlah_kelas, "3")
  assert.equal(context.scalars.jumlah_kelas_belum_rekap, "1")
  assert.equal(context.scalars.jumlah_kelas_sudah_rekap, "2")
  assert.equal(context.scalars.jumlah_tidak_hadir, "3")
  assert.equal(context.scalars.jumlah_sakit, "1")
  assert.equal(context.scalars.jumlah_izin, "1")
  assert.equal(context.scalars.jumlah_alfa, "1")
  assert.equal(context.scalars.jumlah_dispensasi, "0")
  assert.equal(context.collections.daftar_siswa_tidak_hadir?.length, 3)
})

test("isi data tidak pernah diperlakukan sebagai template", () => {
  // Nama yang kebetulan mengandung `{{...}}` harus tercetak apa adanya.
  // Penggantian berulang akan memindai ulang teks yang baru disisipkan dan
  // menerjemahkannya — ini yang menjaga hal itu tidak terjadi.
  const nasty = classOf("VII A", true, [
    { id: "s1", name: "{{jumlah_sakit}}", status: "SAKIT", note: "{{tanggal}}" },
  ])
  const context = buildTemplateContext({
    dateLabel: "16 September 2026",
    slot: "12:00",
    schoolName: "SMPN 1",
    classes: [nasty],
  })
  const template: WhatsAppTemplate = {
    body: "{{daftar_siswa_tidak_hadir}}",
    items: {
      daftar_siswa_tidak_hadir: { format: "{{nama_siswa}} {{keterangan}}", separator: "NEWLINE" },
    },
  }
  const output = renderTemplate("ABSENT_PRESENT", template, context)
  assert.equal(output, "{{jumlah_sakit}} {{tanggal}}")
})

test("pesan lengkap dari template bawaan tetap berbentuk seperti sebelumnya", () => {
  const context = buildTemplateContext({
    dateLabel: "16 September 2026",
    slot: "08:00",
    schoolName: "SMPN 1",
    classes: THREE_PENDING,
  })
  const output = renderTemplate("MISSING_PENDING", defaultTemplate("MISSING_PENDING"), context)
  assert.match(output, /^\*REKAP ABSENSI\*/)
  assert.match(output, /16 September 2026 • 08\.00 WIB/)
  assert.match(output, /1\. 7A\n2\. 7B\n3\. 8A/)
  assert.match(output, /Total: 3 kelas\./)
})
