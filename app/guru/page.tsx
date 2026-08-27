import Link from "next/link"
import { UserRoundPlus } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { TeacherManager } from "@/components/guru/teacher-manager"

export default function GuruPage() {
  return (
    <PageContainer>
      <PageHeading
        title="Data Guru"
        description="Cari, ubah kredensial, dan atur status guru, atau tambahkan guru baru secara manual maupun lewat CSV."
        action={
          <Button render={<Link href="/guru/input" />} nativeButton={false}>
            <UserRoundPlus className="size-4" />
            Tambah Guru
          </Button>
        }
      />
      <TeacherManager />
    </PageContainer>
  )
}
