import Link from "next/link"
import { UserRoundPlus } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { TeacherManager } from "@/components/guru/teacher-manager"
import { requirePagePermission, pageCan } from "@/lib/page-guards"

export default async function GuruPage() {
  await requirePagePermission("teachers.accounts.read")
  const canCreate = await pageCan("teachers.accounts.create")

  return (
    <PageContainer>
      <PageHeading
        title="Data Guru"
        description="Cari, ubah kredensial, dan atur status guru, atau tambahkan guru baru secara manual maupun lewat CSV."
        action={
          canCreate ? (
            <Button render={<Link href="/guru/input" />} nativeButton={false}>
              <UserRoundPlus className="size-4" />
              Tambah Guru
            </Button>
          ) : null
        }
      />
      <TeacherManager />
    </PageContainer>
  )
}
