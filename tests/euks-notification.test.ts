/**
 * Aturan notifikasi kunjungan UKS ke wali kelas.
 *
 * Yang diuji: bunyi tombol dan syarat konfirmasi (keduanya menentukan apakah
 * seorang wali kelas menerima pesan kedua tanpa diminta), serta isi
 * placeholder template yang dilihat wali kelas.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildEuksVisitContext,
  notifyActionLabel,
  notifyBlockMessage,
  notifyStatusLabel,
  requiresResendConfirmation,
  resendConfirmationMessage,
} from "../lib/euks-notification"
import { defaultTemplate } from "../lib/whatsapp-template-defaults"
import {
  allowedPlaceholders,
  placeholdersIn,
  renderTemplate,
  templateKeysForType,
  validateTemplate,
} from "../lib/whatsapp-template"

const visit = {
  dateLabel: "Senin, 21 September 2026",
  schoolName: "SMP Negeri 2 Blitar",
  studentName: "Rani Puspita",
  className: "VIII B",
  homeroomName: "Bu Sari",
  complaint: "Pusing",
  treatment: "Istirahat di UKS",
  followUp: "Dirujuk ke Puskesmas",
  recordedByName: "Pak Budi",
}

test("kunjungan yang belum pernah dinotifikasi menawarkan Kirim, bukan Kirim Ulang", () => {
  assert.equal(notifyActionLabel(null), "Kirim")
  assert.equal(notifyStatusLabel(null), "Belum dikirim")
  assert.equal(requiresResendConfirmation(null), false)
})

test("hanya pengiriman yang BERHASIL menuntut konfirmasi ulang", () => {
  assert.equal(notifyActionLabel("SENT"), "Kirim Ulang")
  assert.equal(requiresResendConfirmation("SENT"), true)

  // Gagal dan dilewati tidak menghasilkan pesan di ponsel wali kelas, sehingga
  // percobaan berikutnya bukan "ulang" dan tidak perlu konfirmasi.
  for (const status of ["FAILED", "SKIPPED"] as const) {
    assert.equal(notifyActionLabel(status), "Kirim")
    assert.equal(requiresResendConfirmation(status), false)
  }
})

test("kalimat konfirmasi menyebut siswa dan penerima", () => {
  const message = resendConfirmationMessage({
    studentName: "Rani Puspita",
    recipientName: "Bu Sari",
  })
  assert.match(message, /Rani Puspita/)
  assert.match(message, /Bu Sari/)
})

test("konfirmasi tetap terbaca saat penerima belum tercatat", () => {
  const message = resendConfirmationMessage({ studentName: "Rani", recipientName: null })
  assert.match(message, /wali kelas/)
})

test("setiap alasan blokir punya kalimat yang menyebut langkah perbaikan", () => {
  assert.match(notifyBlockMessage("NO_PHONE"), /Data Master Guru/)
  assert.match(notifyBlockMessage("INVALID_PHONE"), /Data Master Guru/)
  assert.match(notifyBlockMessage("NO_HOMEROOM"), /wali kelas/i)
  assert.match(notifyBlockMessage("NOT_CONNECTED"), /terhubung/i)
})

test("kartu notifikasi UKS hanya punya satu kondisi template", () => {
  assert.deepEqual(templateKeysForType("EUKS_VISIT_NOTIFICATION"), ["EUKS_VISIT"])
})

test("template bawaan hanya memakai placeholder yang terdaftar", () => {
  const template = defaultTemplate("EUKS_VISIT")
  assert.deepEqual(validateTemplate("EUKS_VISIT", template), [])
  const allowed = allowedPlaceholders("EUKS_VISIT")
  for (const name of placeholdersIn(template.body)) {
    assert.ok(allowed.has(name), `placeholder tidak terdaftar: ${name}`)
  }
})

test("placeholder absensi TIDAK ditawarkan pada notifikasi kunjungan", () => {
  const allowed = allowedPlaceholders("EUKS_VISIT")
  for (const name of ["jumlah_alfa", "daftar_siswa_tidak_hadir", "bagian_sakit", "waktu"]) {
    assert.equal(allowed.has(name), false, name)
  }
})

test("render memuat data kunjungan yang dilihat wali kelas", () => {
  const text = renderTemplate(
    "EUKS_VISIT",
    defaultTemplate("EUKS_VISIT"),
    buildEuksVisitContext(visit),
  )
  assert.match(text, /Rani Puspita/)
  assert.match(text, /VIII B/)
  assert.match(text, /Pusing/)
  assert.match(text, /Istirahat di UKS/)
  assert.match(text, /Dirujuk ke Puskesmas/)
  assert.match(text, /Bu Sari/)
  assert.match(text, /Pak Budi/)
  assert.match(text, /Senin, 21 September 2026/)
  // Tidak ada placeholder yang tersisa mentah di pesan yang dikirim.
  assert.equal(placeholdersIn(text).length, 0)
})

test("tindak lanjut kosong menjadi tanda hubung, bukan baris menggantung", () => {
  const context = buildEuksVisitContext({ ...visit, followUp: "   ", recordedByName: null })
  assert.equal(context.scalars.tindak_lanjut, "-")
  assert.equal(context.scalars.petugas, "-")
})

test("template yang disunting admin dipakai apa adanya", () => {
  const custom = { body: "Halo {{wali_kelas}}, {{nama_siswa}} ke UKS.", items: {} }
  assert.deepEqual(validateTemplate("EUKS_VISIT", custom), [])
  const text = renderTemplate("EUKS_VISIT", custom, buildEuksVisitContext(visit))
  assert.equal(text, "Halo Bu Sari, Rani Puspita ke UKS.")
})

test("placeholder yang tidak dikenal ditolak saat validasi", () => {
  const errors = validateTemplate("EUKS_VISIT", {
    body: "{{jumlah_alfa}}",
    items: {},
  })
  assert.ok(errors.some((error) => error.kind === "UNKNOWN_PLACEHOLDER"))
})
