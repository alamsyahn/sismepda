/**
 * Skema payload akun.
 *
 * Dipisahkan dari route handler supaya aturan anti mass-assignment dapat diuji
 * sebagai unit, dan supaya satu definisi dipakai ulang oleh endpoint profil
 * sendiri maupun administrasi akun.
 *
 * Aturan utama: endpoint PROFIL SENDIRI hanya boleh menyentuh identitas
 * kontak. Setiap metadata otorisasi (role, permission, status aktif, penanda
 * guru) harus DITOLAK, bukan dibuang diam-diam — perilaku `strip` bawaan Zod
 * akan membuat percobaan eskalasi hak terlihat "berhasil" bagi penyerang dan
 * tidak meninggalkan jejak. `.strict()` membuatnya gagal 400.
 */

import { z } from "zod"

/**
 * Field yang tidak boleh pernah diterima dari payload milik pengguna sendiri.
 *
 * Daftar ini dipakai pengujian sebagai kontrak eksplisit. Penegakan
 * sesungguhnya dilakukan `.strict()`, yang menolak SEMUA field asing termasuk
 * yang belum terdaftar di sini.
 */
export const AUTHORIZATION_FIELDS = [
  "role",
  "roles",
  "permission",
  "permissions",
  "active",
  "isTeacher",
  "roleIds",
  "canManageTeacherProfiles",
  "canSuperviseWorkbooks",
  "canViewWorkbookSupervision",
  "workbookSupervised",
  "passwordHash",
  "userId",
] as const

const optionalText = (max: number, pattern?: RegExp) =>
  z.union([
    z.literal(""),
    pattern
      ? z.string().trim().max(max).regex(pattern)
      : z.string().trim().max(max),
  ])

/**
 * Pembaruan profil oleh pemilik akun.
 *
 * `.strict()` wajib: tanpanya, `{ name, active: true }` akan lolos validasi
 * dengan `active` dibuang diam-diam.
 */
export const ownProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    nip: optionalText(30, /^\d+$/),
    email: z.union([z.literal(""), z.string().trim().max(254).email()]),
    phone: optionalText(20, /^\+?\d{7,15}$/),
    currentPassword: z.string().max(128).optional(),
  })
  .strict()

/** Ganti password oleh pemilik akun. Tidak menerima target selain diri sendiri. */
export const passwordUpdateSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  })
  .strict()

export type OwnProfileUpdate = z.infer<typeof ownProfileUpdateSchema>
export type PasswordUpdate = z.infer<typeof passwordUpdateSchema>
