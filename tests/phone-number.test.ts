/**
 * Normalisasi nomor WhatsApp Indonesia.
 *
 * Yang diuji di sini adalah JANJI yang dipegang seluruh aplikasi: satu nomor
 * yang diketik dalam bentuk apa pun harus menghasilkan satu deret digit yang
 * sama, dan nomor yang tidak dapat dipastikan harus DITOLAK, bukan ditebak.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isPersonalJid,
  normalizeIndonesianPhone,
  personalJidFor,
  type PhoneInvalidReason,
} from "../lib/phone-number"

/** Nomor kanonik; gagal keras bila justru ditolak. */
function whatsappOf(raw: string): string {
  const result = normalizeIndonesianPhone(raw)
  assert.equal(result.valid, true, `seharusnya sah: ${raw}`)
  if (!result.valid) throw new Error("unreachable")
  return result.whatsapp
}

/** Alasan penolakan; gagal keras bila justru diterima. */
function reasonOf(raw: string | null | undefined): PhoneInvalidReason {
  const result = normalizeIndonesianPhone(raw)
  assert.equal(result.valid, false, `seharusnya ditolak: ${raw}`)
  if (result.valid) throw new Error("unreachable")
  return result.reason
}

test("awalan nasional 0 diganti kode negara, bukan ditempeli", () => {
  const result = normalizeIndonesianPhone("085784095162")
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.equal(result.whatsapp, "6285784095162")
  assert.equal(result.display, "+6285784095162")
})

test("spasi dan tanda baca dibersihkan", () => {
  for (const raw of [
    "08 578-409-5162",
    "0857.8409.5162",
    "(0857) 8409 5162",
    " 0857 8409 5162 ",
  ]) {
    assert.equal(whatsappOf(raw), "6285784095162", raw)
  }
})

test("+62 dan 62 menghasilkan bentuk yang sama", () => {
  assert.equal(whatsappOf("+6285784095162"), "6285784095162")
  assert.equal(whatsappOf("6285784095162"), "6285784095162")
  assert.equal(whatsappOf("+62 857-8409-5162"), "6285784095162")
})

test("+62 di depan nomor yang masih bernol tidak menghasilkan 620…", () => {
  assert.equal(whatsappOf("+62085784095162"), "6285784095162")
})

test("nomor tanpa awalan apa pun diterima sebagai nomor nasional", () => {
  assert.equal(whatsappOf("85784095162"), "6285784095162")
})

test("nomor kosong ditolak dengan alasan EMPTY", () => {
  for (const raw of ["", "   ", "- - -", null, undefined]) {
    assert.equal(reasonOf(raw), "EMPTY")
  }
})

test("huruf dan simbol asing ditolak, bukan dibersihkan diam-diam", () => {
  assert.equal(reasonOf("0857ABC5162"), "INVALID_CHARACTER")
})

test("nomor non-seluler ditolak sebagai UNKNOWN_PREFIX", () => {
  // Telepon rumah Blitar; bukan nomor WhatsApp seluler.
  assert.equal(reasonOf("0342801234"), "UNKNOWN_PREFIX")
})

test("panjang di luar batas ditolak dengan alasan yang membedakan", () => {
  assert.equal(reasonOf("08578"), "TOO_SHORT")
  assert.equal(reasonOf("0857840951620000"), "TOO_LONG")
})

test("setiap penolakan membawa kalimat untuk pengguna", () => {
  const result = normalizeIndonesianPhone("0342801234")
  assert.equal(result.valid, false)
  if (result.valid) return
  assert.ok(result.message.length > 0)
})

test("JID perorangan memakai akhiran s.whatsapp.net, bukan g.us", () => {
  const jid = personalJidFor("6285784095162")
  assert.equal(jid, "6285784095162@s.whatsapp.net")
  assert.equal(isPersonalJid(jid), true)
  assert.equal(isPersonalJid("120363000000000000@g.us"), false)
})
