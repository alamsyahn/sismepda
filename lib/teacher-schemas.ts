/**
 * Skema payload data master guru.
 *
 * SATU definisi dipakai oleh jalur create maupun update supaya keduanya tidak
 * kembali berbeda diam-diam: setiap field profil yang boleh diisi saat guru
 * dibuat juga harus bisa diperbaiki setelahnya.
 *
 * CLIENT-SAFE: hanya bergantung pada zod, tidak menyentuh Prisma.
 *
 * Aturan utama sama dengan `lib/account-schemas.ts`: `.strict()` wajib. Tanpa
 * itu, payload buatan seperti `{ name, active: true }` atau
 * `{ position, photoKey: "..." }` lolos validasi dengan field terlarang
 * dibuang diam-diam — percobaan mass-assignment jadi terlihat "berhasil" dan
 * tidak meninggalkan jejak. Dengan `.strict()` permintaannya gagal 400.
 *
 * Sapaan TIDAK disimpan pada kolom tersendiri. Model `User` hanya punya
 * `name`, dan sapaan adalah awalan bebas di dalamnya (lihat
 * `splitPrefixedName`/`previewName` di `lib/guru-input.ts`). Karena itu skema
 * ini memvalidasi nama gabungan, bukan enum sapaan yang akan mempersempit data
 * lama.
 */

import { z } from "zod"

/** Field teknis/otorisasi yang tidak boleh pernah datang dari payload guru. */
export const TEACHER_FORBIDDEN_FIELDS = [
  "role",
  "roles",
  "roleIds",
  "active",
  "isTeacher",
  "passwordHash",
  "password",
  "photoKey",
  "photoData",
  "photoSize",
  "photoMimeType",
  "photoUpdatedAt",
  "createdAt",
  "updatedAt",
  "canManageTeacherProfiles",
  "canSuperviseWorkbooks",
  "homeroomUserId",
] as const

export const teacherNipSchema = z
  .string()
  .trim()
  .max(30)
  .refine((value) => !value || /^\d+$/.test(value), "NIP hanya boleh berisi angka")

export const teacherEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Format email tidak valid")

export const teacherPhoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine((value) => !value || /^\+?\d{7,15}$/.test(value), "Format nomor telepon tidak valid")

/** Nama tampilan lengkap, sudah termasuk sapaan bila ada. */
export const teacherNameSchema = z.string().trim().min(1).max(100)

/** Tanggal polos (YYYY-MM-DD) atau string kosong untuk "dikosongkan". */
export const teacherDateSchema = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD"),
])

export const EMPLOYMENT_STATUSES = ["PNS", "PPPK", "HONORER"] as const

export const teacherCreateSchema = z
  .object({
    nip: teacherNipSchema.optional().default(""),
    email: teacherEmailSchema.optional().default(""),
    name: teacherNameSchema,
    phone: teacherPhoneSchema.optional().default(""),
    password: z.string().min(8).max(128),
  })
  .strict()
  .refine((value) => Boolean(value.nip || value.email), {
    message: "NIP atau email wajib diisi",
    path: ["nip"],
  })

/**
 * Identitas akun guru (NIP/email/nama termasuk sapaan/telepon).
 *
 * Dipisahkan dari data kepegawaian karena penjaganya memang berbeda:
 * identitas akun memakai `teachers.accounts.update` (dan email tambahan
 * `accounts.credentials.manage`), sedangkan profil kepegawaian memakai
 * `teachers.profile.update`.
 */
export const teacherIdentityUpdateSchema = z
  .object({
    id: z.string().min(1),
    nip: teacherNipSchema.optional(),
    email: teacherEmailSchema.optional(),
    name: teacherNameSchema.optional(),
    phone: teacherPhoneSchema.optional(),
  })
  .strict()

/** Data kepegawaian/profil guru yang dikelola dari Data Master > Guru. */
export const teacherProfileUpdateSchema = z
  .object({
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullable().optional(),
    position: z.string().trim().max(100).optional(),
    teachingSince: teacherDateSchema.optional(),
    belajarId: z.string().trim().max(254).optional(),
    subjectNames: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .strict()

export type TeacherCreate = z.infer<typeof teacherCreateSchema>
export type TeacherIdentityUpdate = z.infer<typeof teacherIdentityUpdateSchema>
export type TeacherProfileUpdate = z.infer<typeof teacherProfileUpdateSchema>
