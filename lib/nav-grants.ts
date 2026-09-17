/**
 * Derivasi grant efektif untuk navigasi.
 *
 * Navigasi disaring dari daftar permission, sementara `system_admin` sengaja
 * tidak memiliki baris `RolePermission`: kewenangannya hidup di evaluator
 * kanonik sebagai bypass terkendali. Menyusun menu dari baris RolePermission
 * mentah karena itu kehilangan bypass tersebut dan menyembunyikan tujuan yang
 * sebenarnya boleh diakses.
 *
 * Modul ini menutup celah itu di satu tempat: setiap permission yang DIKENAL
 * diputuskan ulang lewat `hasPermission()`. Konsekuensinya otomatis benar —
 * bypass hanya berlaku bagi role ber-key `system_admin` (bukan yang sekadar
 * bernama sama atau hasil kloning), key di luar registry tetap tertutup, dan
 * pemakai biasa tetap memperoleh union OR dari role-nya.
 *
 * Tidak ada interpretasi semantik System Admin yang ditulis ulang di sini, dan
 * tidak ada `RolePermission` yang dimaterialisasi demi menu. Hasilnya murni
 * untuk UX: route handler dan server guard tetap memutuskan sendiri lewat
 * `requirePermission()`.
 */
import { effectiveGrants, type AuthorizationSubject } from "@/lib/rbac"

export function deriveNavGrants(subject: AuthorizationSubject): ReadonlySet<string> {
  return effectiveGrants(subject)
}
