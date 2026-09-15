import { redirect } from "next/navigation"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { WhatsAppPanel } from "@/components/whatsapp/whatsapp-panel"
import { can, ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"
import { requireWhatsAppViewer } from "@/lib/whatsapp-access"

/**
 * Halaman WhatsApp Otomatis.
 *
 * Kemampuan ditentukan di server dan diturunkan sebagai prop. Klien tidak
 * pernah menebak haknya sendiri: menyembunyikan tombol hanyalah kenyamanan,
 * sedangkan penegakan sebenarnya tetap di setiap route handler.
 */
export default async function WhatsAppPage() {
  try {
    await requireWhatsAppViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    if (error instanceof UnauthorizedError) redirect("/login")
    throw error
  }

  const [canManageConnection, canSend] = await Promise.all([
    can("whatsapp.connection.manage"),
    can("whatsapp.send"),
  ])

  return (
    <PageContainer>
      <PageHeading
        title="WhatsApp Otomatis"
        description="Status koneksi, jadwal pengiriman laporan absensi ke grup, dan histori pengiriman."
      />
      <WhatsAppPanel canManageConnection={canManageConnection} canSend={canSend} />
    </PageContainer>
  )
}
