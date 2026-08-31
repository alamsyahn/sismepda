import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { BosAccessManager } from "@/components/bos/bos-access-manager"
import { BosAccessError, requireBosPermission } from "@/lib/bos-access"
import { readBosAccessScope } from "@/lib/server-bos"

export default async function BosAccessPage() {
  try {
    await requireBosPermission("bos.manage_access")
  } catch (error) {
    if (error instanceof BosAccessError) redirect("/bos")
    throw error
  }

  const users = await readBosAccessScope()

  return (
    <PageContainer>
      <PageHeading
        title="Kelola Akses BOS"
        description="Tentukan pengguna yang boleh membuka, menambah, dan mengubah data BOS."
      />
      <BosAccessManager users={users} />
    </PageContainer>
  )
}
