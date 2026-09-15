import { requirePermission, type AuthorizationContext } from "@/lib/rbac-access"
import { readWhatsAppReportClasses } from "@/lib/server-whatsapp-report"
import type { WhatsAppReportClass } from "@/lib/whatsapp-report"

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

/**
 * Laporan WhatsApp untuk pemanggil dari web.
 *
 * Inilah satu-satunya pintu yang boleh dipakai halaman, route handler, dan
 * server action. Permission dituntut di sini, bukan di dalam fungsi query,
 * karena query yang sama juga dipakai worker latar yang memang tidak punya
 * sesi pengguna. Laporan ini merangkum SELURUH kelas, sehingga dijaga
 * permission eksplisit, bukan sekadar "sudah login".
 */
export async function getWhatsAppReportClasses(date: Date): Promise<WhatsAppReportClass[]> {
  await requirePermission("reports.whatsapp.read.all")
  return readWhatsAppReportClasses(date)
}
