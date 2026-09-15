/**
 * Kontrak Data Master > Guru: form Edit adalah tempat utama mengelola profil
 * guru.
 *
 * Dua lapis diuji di sini:
 *
 *  1. SKEMA (`lib/teacher-schemas.ts`) — perilaku murni: field mana yang
 *     diterima, mana yang ditolak, dan bagaimana nilai lama yang kosong
 *     diperlakukan. Ini yang menentukan apakah payload buatan bisa memutasi
 *     kolom teknis.
 *  2. TEKS SUMBER route/komponen — untuk properti yang tidak bisa dibuktikan
 *     fungsi murni tanpa database nyata: keberadaan guard permission, urutan
 *     pemeriksaan NIP milik sendiri, dan pemakaian penyimpanan media kanonik.
 *     Menjalankan route aslinya berarti menulis ke database.
 *
 * Sapaan sengaja tidak punya kolom sendiri: ia awalan bebas di dalam `name`.
 * Karena itu test sapaan di bawah menguji `splitPrefixedName`/`previewName`
 * (round-trip), bukan enum.
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  TEACHER_FORBIDDEN_FIELDS,
  teacherCreateSchema,
  teacherIdentityUpdateSchema,
  teacherProfileUpdateSchema,
} from "../lib/teacher-schemas"
import { defaultPrefixOptions, previewName, splitPrefixedName } from "../lib/guru-input"

const adminRoute = readFileSync("app/api/admin/teachers/route.ts", "utf8")
const profileRoute = readFileSync("app/api/teachers/[teacherId]/route.ts", "utf8")
const photoRoute = readFileSync("app/api/teachers/[teacherId]/photo/route.ts", "utf8")
const dialog = readFileSync("components/guru/teacher-edit-dialog.tsx", "utf8")
const page = readFileSync("app/guru/page.tsx", "utf8")

// 1. Admin berizin dapat membuka edit guru — dan hak itu diputuskan di server.
test("hak membuka editor dibaca dari permission di server, bukan diasumsikan klien", () => {
  assert.match(page, /requirePagePermission\("teachers\.accounts\.read"\)/)
  assert.match(page, /pageCan\("teachers\.accounts\.update"\)/)
  assert.match(page, /pageCan\("teachers\.profile\.update"\)/)
  // Halaman meneruskan hak itu ke editor; tombolnya bukan satu-satunya penjaga.
  assert.match(page, /canUpdateProfile=\{canUpdateProfile\}/)
})

// 2. Seluruh field editable dimuat dari data existing.
test("editor memuat setiap field editable dari record yang dibuka", () => {
  for (const field of [
    "teacher.nip",
    "teacher.email",
    "teacher.phone",
    "teacher.employmentStatus",
    "teacher.position",
    "teacher.teachingSince",
    "teacher.belajarId",
    "teacher.subjects",
    "teacher.photoUrl",
  ]) {
    assert.ok(dialog.includes(field), `${field} tidak dimuat ke state editor`)
  }
  // Nama dipecah menjadi sapaan + nama supaya keduanya bisa diedit terpisah.
  assert.match(dialog, /splitPrefixedName\(teacher\.name\)/)
})

// 3. Nama dapat diubah.
test("nama divalidasi sebagai teks bebas yang wajib terisi", () => {
  const ok = teacherIdentityUpdateSchema.parse({ id: "u1", name: "  Ahmad Santoso " })
  assert.equal(ok.name, "Ahmad Santoso")
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", name: "" }).success, false)
})

// 4. Sapaan dapat diubah, tanpa mempersempit data lama menjadi enum.
test("sapaan adalah awalan nama dan round-trip tanpa kehilangan nilai", () => {
  for (const prefix of defaultPrefixOptions) {
    const stored = previewName(prefix, "Dewi Lestari")
    assert.deepEqual(splitPrefixedName(stored), { prefix, name: "Dewi Lestari" })
  }
  // Sapaan di luar daftar tetap tersimpan utuh sebagai bagian nama; tidak ada
  // validasi yang menolaknya.
  const custom = previewName("Kyai", "Ahmad")
  assert.equal(custom, "Kyai Ahmad")
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", name: custom }).success, true)
  // Nama lama tanpa sapaan tidak berubah artinya.
  assert.deepEqual(splitPrefixedName("Rudi Hartono"), { prefix: "", name: "Rudi Hartono" })
})

// 5. Nomor telepon dapat diubah, termasuk dikosongkan.
test("nomor telepon menerima format valid, kosong, dan menolak yang tidak valid", () => {
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", phone: "081234567890" }).success, true)
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", phone: "+6281234567890" }).success, true)
  // String kosong berarti "kosongkan", bukan error.
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", phone: "" }).success, true)
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", phone: "bukan-nomor" }).success, false)
})

// 6-8. Foto dapat ditambah, diganti, dan dihapus.
test("foto guru punya jalur tambah, ganti, dan hapus pada satu endpoint", () => {
  assert.match(photoRoute, /export async function PUT/)
  assert.match(photoRoute, /export async function DELETE/)
  // Editor memakai endpoint yang sama untuk ketiganya.
  assert.match(dialog, /method: "PUT"/)
  assert.match(dialog, /method: "DELETE"/)
  // Preview dan pembatalan sebelum simpan.
  assert.match(dialog, /URL\.createObjectURL/)
  assert.match(dialog, /function cancelPhoto/)
  // Fallback avatar untuk guru tanpa foto.
  assert.match(dialog, /AvatarFallback/)
})

test("foto memakai penyimpanan media kanonik, bukan kolom byte baru", () => {
  assert.match(photoRoute, /storeMedia\(/)
  assert.match(photoRoute, /resolveMedia\(/)
  // Tidak ada base64 di jalur simpan.
  assert.doesNotMatch(photoRoute, /toString\("base64"\)|data:image/)
  // Byte legacy hanya dikosongkan untuk baris yang baru pindah; kolomnya tidak
  // pernah dijadikan tujuan tulis baru.
  assert.match(photoRoute, /photoData: null/)
  assert.doesNotMatch(photoRoute, /photoData: (bytes|Buffer)/)
})

test("tipe file foto ditentukan dari isi berkas dan batas global slot upload", () => {
  assert.match(photoRoute, /detectProfilePhotoType\(bytes\)/)
  assert.match(photoRoute, /assertDetectedType\(/)
  assert.match(photoRoute, /assertUploadAllowedForSlot\("teachers\.master\.photo"/)
  assert.match(photoRoute, /assertRequestSizeWithinSlot\("teachers\.master\.photo"/)
  // Klien membaca batas yang sama dari Administrasi/Pengaturan.
  assert.match(dialog, /useUploadPolicy\("teachers\.master\.photo"\)/)
})

// 9-10. NIP: milik sendiri bukan duplikat, milik guru lain ditolak manusiawi.
test("pemeriksaan NIP membandingkan pemilik, bukan sekadar keberadaan", () => {
  assert.match(adminRoute, /nip !== existing\.nip/)
  assert.match(adminRoute, /owner\.id !== body\.id/)
  assert.match(adminRoute, /NIP sudah digunakan akun lain/)
})

test("pelanggaran unik database dipetakan ke pesan manusiawi, bukan error Prisma mentah", () => {
  assert.match(adminRoute, /P2002/)
  assert.match(adminRoute, /status: 409/)
  // Pesan Prisma tidak pernah diteruskan apa adanya.
  assert.doesNotMatch(adminRoute, /error:\s*String\(error\)|error\.message/)
})

// 11. Tanpa permission, endpoint langsung pun ditolak.
test("setiap mutasi guru dijaga permission di server", () => {
  assert.match(adminRoute, /requirePermission\("teachers\.accounts\.update"\)/)
  assert.match(adminRoute, /requirePermission\("accounts\.credentials\.manage"\)/)
  assert.match(profileRoute, /requireTeacherManager\(\)/)
  // Foto: baca cukup hak direktori, menulis butuh hak profil.
  assert.match(photoRoute, /requirePermission\("teachers\.directory\.read"\)/)
  const writes = photoRoute.match(/requirePermission\("teachers\.profile\.update"\)/g) ?? []
  assert.equal(writes.length, 2, "PUT dan DELETE harus sama-sama dijaga")
  // Mutasi lintas origin ditolak.
  for (const source of [adminRoute, photoRoute]) {
    assert.match(source, /verifySameOrigin\(request\)/)
  }
})

// 12. Edit tidak merusak relasi guru.
test("edit memperbarui record yang ada, tidak menghapus lalu membuat ulang", () => {
  // Hanya jalur EDIT yang diperiksa; POST pada route admin memang membuat akun
  // guru baru dan bukan bagian dari alur ini.
  const editPaths = [
    adminRoute.slice(adminRoute.indexOf("export async function PATCH"), adminRoute.indexOf("export async function POST")),
    profileRoute,
    photoRoute,
  ]
  for (const source of editPaths) {
    assert.match(source, /\.user\.update\(/)
    assert.doesNotMatch(source, /\.user\.delete(Many)?\(/)
    assert.doesNotMatch(source, /\.user\.create\(/)
  }
  // Identitas dan foreign key tidak pernah ikut ditulis dari payload.
  assert.doesNotMatch(profileRoute, /homeroomUserId/)
  assert.doesNotMatch(adminRoute, /homeroomUserId/)
})

test("penulisan ulang mata pelajaran tidak menyentuh relasi guru lain", () => {
  // deleteMany dibatasi userId guru yang sedang diedit.
  assert.match(profileRoute, /teacherSubject\.deleteMany\(\{ where: \{ userId: teacherId \} \}\)/)
})

// 13. Field teknis tidak dapat dimutasi lewat payload buatan.
test("payload dengan field teknis ditolak, bukan dibersihkan diam-diam", () => {
  for (const field of TEACHER_FORBIDDEN_FIELDS) {
    const identity = teacherIdentityUpdateSchema.safeParse({ id: "u1", name: "Guru", [field]: "x" })
    assert.equal(identity.success, false, `identitas menerima field terlarang: ${field}`)

    const profile = teacherProfileUpdateSchema.safeParse({ position: "Guru", [field]: "x" })
    assert.equal(profile.success, false, `profil menerima field terlarang: ${field}`)
  }
})

test("skema create pun tidak menerima field di luar daftar", () => {
  const base = { nip: "199203112018012005", name: "Dewi Lestari", password: "rahasia123" }
  assert.equal(teacherCreateSchema.safeParse(base).success, true)
  assert.equal(teacherCreateSchema.safeParse({ ...base, isTeacher: true }).success, false)
  assert.equal(teacherCreateSchema.safeParse({ ...base, role: "ADMIN" }).success, false)
})

test("create dan update berbagi aturan field yang sama", () => {
  // Nilai yang ditolak saat create harus tetap ditolak saat update, supaya
  // keduanya tidak menyimpang lagi di kemudian hari.
  assert.equal(teacherCreateSchema.safeParse({ nip: "bukan-angka", name: "X", password: "rahasia123" }).success, false)
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", nip: "bukan-angka" }).success, false)
  assert.equal(teacherCreateSchema.safeParse({ email: "salah", name: "X", password: "rahasia123" }).success, false)
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1", email: "salah" }).success, false)
})

// 14. Data guru lama tetap dapat diedit.
test("guru lama tanpa foto, sapaan, dan kolom profil kosong tetap valid", () => {
  // Semua field profil opsional: menyimpan tanpa mengisi apa pun tidak error.
  assert.equal(teacherProfileUpdateSchema.safeParse({}).success, true)
  assert.equal(teacherIdentityUpdateSchema.safeParse({ id: "u1" }).success, true)

  // Mengosongkan nilai lama adalah operasi sah, bukan validasi gagal.
  const cleared = teacherProfileUpdateSchema.parse({
    employmentStatus: null,
    position: "",
    teachingSince: "",
    belajarId: "",
  })
  assert.equal(cleared.employmentStatus, null)
  assert.equal(cleared.position, "")

  // Nama lama tanpa sapaan tetap bisa dibuka editor.
  assert.deepEqual(splitPrefixedName("Siti Aminah, S.Pd"), { prefix: "", name: "Siti Aminah, S.Pd" })
})

test("string kosong pada kolom nullable disimpan sebagai NULL, bukan string kosong", () => {
  for (const pattern of [
    /position: body\.position \|\| null/,
    /belajarId: body\.belajarId \|\| null/,
  ]) {
    assert.match(profileRoute, pattern)
  }
  assert.match(adminRoute, /phone: body\.phone \|\| null/)
})

// Field profil tambahan yang ditemukan saat inspeksi.
test("status kepegawaian dibatasi nilai yang memang dipakai sistem", () => {
  for (const status of ["PNS", "PPPK", "HONORER"]) {
    assert.equal(teacherProfileUpdateSchema.safeParse({ employmentStatus: status }).success, true)
  }
  assert.equal(teacherProfileUpdateSchema.safeParse({ employmentStatus: "TIDAK_ADA" }).success, false)
})

test("TMT mengajar hanya menerima tanggal polos YYYY-MM-DD", () => {
  assert.equal(teacherProfileUpdateSchema.safeParse({ teachingSince: "2020-07-13" }).success, true)
  // Timestamp berzona waktu ditolak: kolom ini tanggal, bukan momen.
  assert.equal(teacherProfileUpdateSchema.safeParse({ teachingSince: "2020-07-13T00:00:00Z" }).success, false)
  assert.equal(teacherProfileUpdateSchema.safeParse({ teachingSince: "13/07/2020" }).success, false)
})

test("mata pelajaran diampu diterima sebagai daftar nama, bukan id internal", () => {
  const parsed = teacherProfileUpdateSchema.parse({ subjectNames: [" Matematika ", "Informatika"] })
  assert.deepEqual(parsed.subjectNames, ["Matematika", "Informatika"])
  assert.equal(teacherProfileUpdateSchema.safeParse({ subjectNames: [""] }).success, false)
})

// Audit
test("mutasi profil dan foto guru tercatat di trail audit yang sama", () => {
  assert.match(profileRoute, /recordAuditLog\(/)
  assert.match(profileRoute, /action: "TEACHER_PROFILE_UPDATED"/)
  assert.match(photoRoute, /action: "TEACHER_PHOTO_UPDATED"/)
  // Audit tidak pernah membawa kredensial atau byte gambar: field sensitif
  // tidak boleh muncul di dalam blok before/after mana pun.
  for (const source of [profileRoute, photoRoute, adminRoute]) {
    for (const block of source.match(/(before|after):\s*\{[^}]*\}/g) ?? []) {
      for (const secret of ["passwordHash", "password", "photoData", "bytes"]) {
        assert.ok(!block.includes(secret), `payload audit memuat data sensitif: ${secret}`)
      }
    }
  }
})

// Editor tidak mencampur profil dengan otorisasi.
test("editor tidak mengelola role, permission, atau status aktif", () => {
  // Komentar dibuang supaya penyebutan dalam dokumentasi tidak memicu temuan.
  const dialogCode = dialog
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n")

  for (const forbidden of ["roleIds", "permissionKeys", "isSystemAdmin"]) {
    assert.ok(!dialogCode.includes(forbidden), `editor guru menyentuh urusan otorisasi: ${forbidden}`)
  }
  // `active` boleh dibaca sebagai bagian record, tetapi tidak pernah dikirim:
  // mengaktifkan/menonaktifkan akun punya konfirmasinya sendiri.
  for (const body of dialogCode.match(/JSON\.stringify\(\{[\s\S]*?\}\)/g) ?? []) {
    assert.ok(!/\bactive\b/.test(body), "editor guru mengirim status aktif akun")
  }
  // Endpoint RBAC tidak pernah dipanggil untuk mengubah hak; satu-satunya
  // sentuhan ke sana adalah reset password, yang memang kredensial.
  const rbacCalls = dialogCode.match(/\/api\/rbac\/[^`"']+/g) ?? []
  assert.deepEqual(rbacCalls, ["/api/rbac/accounts/${teacher.id}"])
})
