/**
 * Bagian status, daftar per status, dan pengurutan siswa.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Rekap siswa tidak hadir kembali berbentuk berkelompok per status. Bentuk itu
 * hanya benar bila tiga hal dijaga bersama: judul bagian TETAP tercetak
 * walaupun jumlahnya nol, daftar kosong tidak meninggalkan bullet palsu, dan
 * urutan siswa mengikuti kelas secara natural — bukan urutan hasil query.
 *
 * Tes ini sengaja terpisah dari `whatsapp-template.test.ts` yang menjaga aturan
 * umum mesin template (validasi, pemilihan kondisi, keamanan substitusi).
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import type { WhatsAppReportClass } from "@/lib/whatsapp-report"
import {
  ABSENCE_SECTIONS,
  allowedPlaceholders,
  placeholderGroups,
  renderTemplate,
  templateKeysForType,
  validateTemplate,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-template"
import { DEFAULT_TEMPLATES } from "@/lib/whatsapp-template-defaults"
import {
  absentStudentRows,
  buildTemplateContext,
  templateKeyFor,
} from "@/lib/whatsapp-template-context"
import { SAMPLE_CONTEXT } from "@/lib/whatsapp-template-sample"

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
  grade = "VII",
): WhatsAppReportClass {
  return {
    id: `c-${name}`,
    name,
    grade,
    submitted,
    homeroomName: null,
    studentCount: students.length,
    students: students.map((student) => ({ ...student, note: student.note ?? null })),
  }
}

function contextOf(classes: WhatsAppReportClass[]) {
  return buildTemplateContext({
    dateLabel: "Rabu, 16 September 2026",
    slot: "12:00",
    schoolName: "SMPN 1 Contoh",
    classes,
  })
}

/** Merender satu badan template dengan format item bawaan kondisi C. */
function renderBody(body: string, classes: WhatsAppReportClass[]): string {
  const template: WhatsAppTemplate = {
    body,
    items: DEFAULT_TEMPLATES.ABSENT_PRESENT.items,
  }
  return renderTemplate("ABSENT_PRESENT", template, contextOf(classes))
}

const MIXED = [
  classOf("VIII C", true, [
    { id: "s4", name: "Rafi", status: "SAKIT" },
    { id: "s5", name: "Nazwa", status: "ALFA" },
  ], "VIII"),
  classOf("VII A", true, [
    { id: "s1", name: "Ahmad", status: "SAKIT", note: "Demam" },
    { id: "s2", name: "Budi", status: "IZIN" },
  ]),
  classOf("VII B", true, [{ id: "s3", name: "Citra", status: "SAKIT" }]),
]

// --- 1-2: state template kontekstual per jenis otomatisasi ------------------

test("1. jenis 'kelas belum mengisi absensi' hanya mengekspos dua template pengingat", () => {
  assert.deepEqual(templateKeysForType("ATTENDANCE_MISSING"), [
    "MISSING_PENDING",
    "MISSING_COMPLETE",
  ])
})

test("2. jenis 'rekap siswa tidak hadir' hanya mengekspos dua template rekap", () => {
  assert.deepEqual(templateKeysForType("ATTENDANCE_ABSENT"), [
    "ABSENT_PRESENT",
    "ABSENT_NONE",
  ])
})

// --- 3-7: daftar per status -------------------------------------------------

test("3. {{daftar_sakit}} hanya memuat siswa berstatus SAKIT", () => {
  const output = renderBody("{{daftar_sakit}}", MIXED)
  assert.equal(output, "• 7A — Ahmad\n• 7B — Citra\n• 8C — Rafi")
})

test("4. {{daftar_izin}} hanya memuat siswa berstatus IZIN", () => {
  assert.equal(renderBody("{{daftar_izin}}", MIXED), "• 7A — Budi")
})

test("5. {{daftar_alfa}} hanya memuat siswa berstatus ALFA", () => {
  assert.equal(renderBody("{{daftar_alfa}}", MIXED), "• 8C — Nazwa")
})

test("6. {{daftar_dispensasi}} kosong bila tidak ada siswa berstatus itu", () => {
  assert.equal(renderBody("{{daftar_dispensasi}}", MIXED), "")
})

test("7. {{daftar_siswa_tidak_hadir}} tetap berfungsi dan memuat seluruh status", () => {
  const output = renderBody("{{daftar_siswa_tidak_hadir}}", MIXED)
  // Daftar gabungan tetap dikelompokkan: SAKIT → IZIN → ALFA → DISPENSASI.
  assert.equal(
    output,
    [
      "• 7A — Ahmad (SAKIT)",
      "• 7B — Citra (SAKIT)",
      "• 8C — Rafi (SAKIT)",
      "• 7A — Budi (IZIN)",
      "• 8C — Nazwa (ALFA)",
    ].join("\n"),
  )
})

// --- 8: jumlah --------------------------------------------------------------

test("8. jumlah per status dan total sesuai isi daftarnya", () => {
  const { scalars } = contextOf(MIXED)
  assert.equal(scalars.jumlah_sakit, "3")
  assert.equal(scalars.jumlah_izin, "1")
  assert.equal(scalars.jumlah_alfa, "1")
  assert.equal(scalars.jumlah_dispensasi, "0")
  assert.equal(scalars.jumlah_tidak_hadir, "5")
})

// --- 9-12: bagian_* ---------------------------------------------------------

test("9. {{bagian_sakit}} menghasilkan judul, jumlah, lalu daftar", () => {
  assert.equal(
    renderBody("{{bagian_sakit}}", MIXED),
    "*SAKIT — 3*\n• 7A — Ahmad\n• 7B — Citra\n• 8C — Rafi",
  )
})

test("10. {{bagian_izin}} benar", () => {
  assert.equal(renderBody("{{bagian_izin}}", MIXED), "*IZIN — 1*\n• 7A — Budi")
})

test("11. {{bagian_alfa}} benar", () => {
  assert.equal(renderBody("{{bagian_alfa}}", MIXED), "*ALFA — 1*\n• 8C — Nazwa")
})

test("12. {{bagian_dispensasi}} benar bila ada isinya", () => {
  const classes = [classOf("IX A", true, [{ id: "x", name: "Kireina", status: "DISPENSASI" }], "IX")]
  assert.equal(
    renderBody("{{bagian_dispensasi}}", classes),
    "*DISPENSASI — 1*\n• 9A — Kireina",
  )
})

// --- 13-15: status bernilai nol --------------------------------------------

test("13. status bernilai 0 tetap menampilkan judulnya", () => {
  assert.equal(renderBody("{{bagian_dispensasi}}", MIXED), "*DISPENSASI — 0*")
})

test("14. daftar kosong tidak menghasilkan bullet palsu", () => {
  const output = renderBody("{{bagian_dispensasi}}", MIXED)
  assert.ok(!output.includes("•"), "judul tanpa isi tidak boleh memuat bullet")
  assert.ok(!output.endsWith("\n"), "judul tanpa isi tidak boleh menyisakan baris kosong")
})

test("15. seluruh status tetap muncul walaupun semuanya bernilai 0 kecuali satu", () => {
  const classes = [classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }])]
  const output = renderBody(
    "{{bagian_sakit}}\n\n{{bagian_izin}}\n\n{{bagian_alfa}}\n\n{{bagian_dispensasi}}",
    classes,
  )
  assert.equal(
    output,
    ["*SAKIT — 1*", "• 7A — Ahmad", "", "*IZIN — 0*", "", "*ALFA — 0*", "", "*DISPENSASI — 0*"].join(
      "\n",
    ),
  )
})

// --- 16-18: pengurutan ------------------------------------------------------

test("16. siswa diurutkan berdasarkan kelas secara natural, bukan leksikal", () => {
  // Urutan masukan sengaja diacak dan memuat kelas dua digit: urutan leksikal
  // akan menaruh "10A" sebelum "7A".
  const classes = [
    classOf("IX C", true, [{ id: "a", name: "Zaki", status: "SAKIT" }], "IX"),
    classOf("VII B", true, [{ id: "b", name: "Bima", status: "SAKIT" }]),
    classOf("VIII A", true, [{ id: "c", name: "Cakra", status: "SAKIT" }], "VIII"),
    classOf("VII A", true, [{ id: "d", name: "Dina", status: "SAKIT" }]),
  ]
  const rows = absentStudentRows(classes)
  assert.deepEqual(
    rows.map((row) => row.nama_kelas),
    ["7A", "7B", "8A", "9C"],
  )
})

test("17. siswa pada kelas yang sama diurutkan berdasarkan nama", () => {
  const classes = [
    classOf("VII A", true, [
      { id: "a", name: "Zulfa", status: "SAKIT" },
      { id: "b", name: "Adit", status: "SAKIT" },
      { id: "c", name: "Mira", status: "SAKIT" },
    ]),
  ]
  assert.deepEqual(
    absentStudentRows(classes).map((row) => row.nama_siswa),
    ["Adit", "Mira", "Zulfa"],
  )
})

test("18. pengurutan deterministik: masukan berbeda urutan menghasilkan keluaran sama", () => {
  const forward = absentStudentRows(MIXED)
  const reversed = absentStudentRows([...MIXED].reverse())
  assert.deepEqual(
    forward.map((row) => `${row.nama_kelas}-${row.nama_siswa}`),
    reversed.map((row) => `${row.nama_kelas}-${row.nama_siswa}`),
  )
})

// --- 19-20: catatan kelas belum rekap --------------------------------------

test("19. masih ada kelas belum rekap → catatan terisi", () => {
  const classes = [...MIXED, classOf("IX B", false, [], "IX")]
  const { scalars } = contextOf(classes)
  assert.equal(
    scalars.catatan_kelas_belum_rekap,
    "Catatan: 1 kelas belum mengisi absensi sehingga data belum lengkap.",
  )
})

test("20. seluruh kelas selesai → catatan kosong, tanpa baris tersisa", () => {
  const { scalars } = contextOf(MIXED)
  assert.equal(scalars.catatan_kelas_belum_rekap, "")

  // Placeholder yang berdiri sendiri tidak boleh meninggalkan celah ganda.
  const output = renderBody("Total: {{jumlah_tidak_hadir}}\n\n{{catatan_kelas_belum_rekap}}", MIXED)
  assert.equal(output, "Total: 5")
})

// --- 21-22: pemilihan state -------------------------------------------------

test("21. ada siswa tidak hadir → kondisi ABSENT_PRESENT", () => {
  assert.equal(templateKeyFor("ATTENDANCE_ABSENT", MIXED), "ABSENT_PRESENT")
})

test("22. tidak ada siswa tidak hadir → kondisi ABSENT_NONE", () => {
  const classes = [classOf("VII A", true, [])]
  assert.equal(templateKeyFor("ATTENDANCE_ABSENT", classes), "ABSENT_NONE")
})

// --- regresi ---------------------------------------------------------------

test("23. template bawaan ABSENT_PRESENT menghasilkan bentuk berkelompok yang diminta", () => {
  const output = renderTemplate(
    "ABSENT_PRESENT",
    DEFAULT_TEMPLATES.ABSENT_PRESENT,
    contextOf(MIXED),
  )
  assert.equal(
    output,
    [
      "*REKAP SISWA TIDAK HADIR*",
      "Rabu, 16 September 2026 • 12.00 WIB",
      "",
      "*SAKIT — 3*",
      "• 7A — Ahmad",
      "• 7B — Citra",
      "• 8C — Rafi",
      "",
      "*IZIN — 1*",
      "• 7A — Budi",
      "",
      "*ALFA — 1*",
      "• 8C — Nazwa",
      "",
      "*DISPENSASI — 0*",
      "",
      "Total siswa tidak hadir: 5",
    ].join("\n"),
  )
})

test("24. template bawaan sah menurut validator", () => {
  for (const key of ["MISSING_PENDING", "MISSING_COMPLETE", "ABSENT_PRESENT", "ABSENT_NONE"] as const) {
    assert.deepEqual(validateTemplate(key, DEFAULT_TEMPLATES[key]), [], `template ${key}`)
  }
})

test("25. bagian_* dan daftar per status ditolak pada kondisi yang tidak relevan", () => {
  const allowed = allowedPlaceholders("MISSING_PENDING")
  for (const section of ABSENCE_SECTIONS) {
    assert.ok(!allowed.has(section.section), `${section.section} tidak boleh sah di pengingat`)
    assert.ok(!allowed.has(section.list), `${section.list} tidak boleh sah di pengingat`)
  }
  // Sebaliknya, kondisi NIHIL juga tidak punya daftar apa pun.
  const none = allowedPlaceholders("ABSENT_NONE")
  assert.ok(!none.has("daftar_siswa_tidak_hadir"))
})

test("26. variabel yang ditawarkan UI bersifat kontekstual", () => {
  const reminder = placeholderGroups("MISSING_PENDING")
    .flatMap((group) => group.entries)
    .map((entry) => entry.name)
  assert.ok(reminder.includes("jumlah_kelas_belum_rekap"))
  assert.ok(!reminder.includes("jumlah_sakit"), "pengingat tidak perlu variabel kehadiran")

  const absent = placeholderGroups("ABSENT_PRESENT")
    .flatMap((group) => group.entries)
    .map((entry) => entry.name)
  assert.ok(absent.includes("bagian_sakit"))
  assert.ok(absent.includes("daftar_sakit"))
  assert.ok(absent.includes("catatan_kelas_belum_rekap"))
  assert.ok(!absent.includes("jumlah_kelas_belum_rekap"))
})

test("27. data contoh pratinjau memperlihatkan status bernilai nol", () => {
  const output = renderTemplate(
    "ABSENT_PRESENT",
    DEFAULT_TEMPLATES.ABSENT_PRESENT,
    SAMPLE_CONTEXT,
  )
  assert.ok(output.includes("*ALFA — 0*"), "pratinjau harus memperlihatkan bagian bernilai nol")
  assert.ok(output.includes("Catatan: 3 kelas belum mengisi absensi"))
})
