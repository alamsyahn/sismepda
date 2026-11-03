import test from "node:test"
import assert from "node:assert/strict"
import { cardPageLayout, defaultCardPrintOptions, studentCardsPrintHtml } from "../lib/student-card-print"
import { printableStudentQr, qrHash, studentQrTokenHash } from "../lib/student-qr-code"
import type { ScanStudent } from "../lib/scan"

test("printable credentials resolve to the original hash without knowing or changing the old QR", () => {
  const previous = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = "isolated-card-print-test-secret"
  try {
    const original = "SP1:" + "a".repeat(32)
    const hash = qrHash(original)
    const printed = printableStudentQr(hash)
    assert.equal(studentQrTokenHash(original), hash)
    assert.equal(studentQrTokenHash(printed), hash)
    assert.equal(printableStudentQr(hash), printed)
    assert.equal(studentQrTokenHash(printed.replace(hash, "b".repeat(64))), null)
    assert.equal(studentQrTokenHash(printed.slice(0, -2) + "AA"), null)
    assert.equal(studentQrTokenHash("SP2:" + hash + ":bad"), null)
    assert.equal(studentQrTokenHash(hash), null)
    process.env.AUTH_SECRET = "different-secret"
    assert.equal(studentQrTokenHash(printed), null)
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previous
  }
})

test("paper layouts fit full 90 × 55 mm cards, 5 mm cutting gaps and 8 mm margins", () => {
  for (const paper of ["A4", "A3", "F4", "Custom"] as const) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const layout = cardPageLayout({ ...defaultCardPrintOptions, paper, orientation, customWidth: 215, customHeight: 350 })
      assert.ok(layout.columns * 90 + (layout.columns - 1) * 5 <= layout.width - 16)
      assert.ok(layout.rows * 55 + (layout.rows - 1) * 5 <= layout.height - 16)
      assert.ok((layout.columns + 1) * 90 + layout.columns * 5 > layout.width - 16)
      assert.ok((layout.rows + 1) * 55 + layout.rows * 5 > layout.height - 16)
    }
  }
  assert.equal(cardPageLayout(defaultCardPrintOptions).perPage, 8)
  assert.equal(cardPageLayout({ ...defaultCardPrintOptions, orientation: "landscape" }).perPage, 9)
  assert.equal(cardPageLayout({ ...defaultCardPrintOptions, paper: "F4" }).perPage, 10)
  for (const customWidth of [0, 75, NaN, Infinity, 1201]) {
    assert.throws(() => cardPageLayout({ ...defaultCardPrintOptions, paper: "Custom", customWidth }))
  }
})

test("print pagination keeps each card intact and safely escapes student data", () => {
  const student: ScanStudent = { id: "student", name: '<script>alert("x")</script>', nis: "000123", nisn: null, classId: "class", className: "VII A", homeroomName: null, recipientReady: false }
  const html = studentCardsPrintHtml(Array.from({ length: 17 }, () => ({ student, image: "data:image/png;base64,AA" })), "SMPN 2 BLITAR", "", defaultCardPrintOptions)
  assert.equal((html.match(/<main class="sheet">/g) ?? []).length, 3)
  assert.equal((html.match(/<section class="card">/g) ?? []).length, 17)
  assert.ok(!html.includes(student.name))
  assert.ok(html.includes("&lt;script&gt;"))
  assert.ok(html.includes("size:210mm 297mm"))
  assert.ok(html.includes("000123"))
})
