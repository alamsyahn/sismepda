import { requirePermission, type AuthorizationContext } from "@/lib/rbac-access"

/**
 * Guard fitur WhatsApp Otomatis.
 *
 * Tiga kemampuan dipisah karena konsekuensinya berbeda jauh: melihat status
 * tidak berbahaya, memutus koneksi menghentikan seluruh pengiriman otomatis
 * sampai ada yang memindai QR lagi, dan mengirim manual menghasilkan pesan
 * nyata ke grup wali kelas yang tidak bisa ditarik kembali.
 *
 * Tidak ada pemeriksaan nama role di sini. Keputusan diambil evaluator kanonik
 * `hasPermission`, yang sekaligus memuat satu-satunya bypass system admin yang
 * terkendali.
 */

/** Membaca status koneksi, jadwal, dan histori pengiriman. */
export function requireWhatsAppViewer(): Promise<AuthorizationContext> {
  return requirePermission("whatsapp.read")
}

/** Menghubungkan, menyambung ulang, atau keluar dari akun WhatsApp sekolah. */
export function requireWhatsAppConnectionManager(): Promise<AuthorizationContext> {
  return requirePermission("whatsapp.connection.manage")
}

/** Memicu pengiriman di luar jadwal. */
export function requireWhatsAppSender(): Promise<AuthorizationContext> {
  return requirePermission("whatsapp.send")
}
