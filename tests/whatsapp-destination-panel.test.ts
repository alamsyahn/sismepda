/**
 * Panel grup tujuan: apa yang boleh disentuh admin, dan kapan.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Daftar grup hanya ada selama sesi WhatsApp hidup. Selector yang tetap aktif
 * saat terputus menjanjikan sesuatu yang tidak dapat ditepati, dan fetch yang
 * gagal tidak boleh terlihat seperti "grupnya hilang".
 *
 * Pemeriksaan dilakukan atas sumber panel, sejalan dengan whatsapp-page.test.ts:
 * yang dijaga adalah keputusan kondisionalnya, yang justru tidak terlihat oleh
 * render statis karena bergantung pada state klien.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(
  new URL("../components/whatsapp/whatsapp-panel.tsx", import.meta.url),
  "utf8",
)

test("selector grup mati saat WhatsApp belum terhubung", () => {
  // Selector default, selector override, dan tombol muat ulang — ketiganya
  // tidak berarti apa-apa tanpa sesi yang hidup.
  assert.match(source, /disabled=\{!canManageConnection \|\| !connected \|\| busy !== null\}/)
  assert.match(source, /disabled=\{!connected \|\| busy !== null\}/)
  assert.match(source, /disabled=\{!connected \|\| refreshingGroups\}/)
})

test("keadaan terputus dijelaskan dengan kalimat, bukan selector kosong", () => {
  assert.match(source, /Hubungkan WhatsApp terlebih dahulu untuk memilih grup\./)
})

test("tombol muat ulang grup ada dan mati saat terputus", () => {
  assert.match(source, /Muat ulang grup/)
  assert.match(source, /disabled=\{!connected \|\| refreshingGroups\}/)
  assert.match(source, /refreshingGroups \? "Memuat…"/)
})

test("fetch grup yang gagal tidak menghapus pilihan tersimpan", () => {
  // Jalur gagal keluar lebih awal; `setGroups` hanya dipanggil dengan daftar
  // yang benar-benar diterima. Tidak ada satu pun pemanggilan yang
  // mengosongkannya, sehingga pilihan tersimpan selamat dari fetch yang gagal.
  assert.ok(!/setGroups\(null\)/.test(source))
  assert.ok(!/setGroups\(\[\]\)/.test(source))
  assert.match(source, /if \(!data\.groups\) \{/)
  assert.match(source, /if \(data\.groups\) setGroups\(data\.groups\)/)
})

test("grup tersimpan yang hilang diberi tahu, bukan diganti", () => {
  assert.equal(source.split("STALE_DESTINATION_MESSAGE").length - 1, 3)
})

test("JID mentah tidak pernah dirender ke pengguna", () => {
  // Label selalu berasal dari destinationDisplay / nama grup.
  assert.ok(!/\{defaultDestination\.jid\}/.test(source))
  assert.ok(!/\{configuration\?\.targetGroupJid\}/.test(source))
})

test("pengguna hanya-baca tidak mendapat kontrol pengubah", () => {
  // Tombol muat ulang dan selector override berada di balik izin kelola;
  // selector default dimatikan lewat prop `disabled`.
  assert.match(source, /disabled=\{!canManageConnection \|\|/)
  assert.ok(source.split("canManageConnection ? (").length - 1 >= 2)
})

test("otomatis tidak dapat dinyalakan tanpa tujuan, tetapi selalu dapat dimatikan", () => {
  // Jadwal yang telanjur aktif harus tetap bisa dimatikan walau tujuannya
  // sedang bermasalah — kalau tidak, admin terkunci.
  assert.match(
    source,
    /disabled=\{busy !== null \|\| \(!destinationReady && !configuration\?\.enabled\)\}/,
  )
})

test("kirim sekarang mati tanpa tujuan dan menjelaskan alasannya", () => {
  assert.match(source, /disabled=\{busy !== null \|\| !destinationReady\}/)
  assert.match(source, /Pilih grup tujuan terlebih dahulu\./)
})

test("pilihan gunakan grup default tersedia pada setiap laporan", () => {
  assert.match(source, /<SelectItem value=\{USE_DEFAULT\}>Gunakan grup default<\/SelectItem>/)
})

test("selector responsif di layar kecil", () => {
  // Lebar penuh di mobile, terbatas di layar lebar.
  assert.equal(source.split('className="w-full sm:w-72"').length - 1, 2)
})
