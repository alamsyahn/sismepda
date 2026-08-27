import Link from "next/link"
import { UserPlus } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { StudentManager } from "@/components/siswa/student-manager"

export default function SiswaPage() {
  return (
    <PageContainer>
      <PageHeading
        title="Data Siswa"
        description="Cari, ubah, dan atur status siswa, atau tambahkan siswa baru secara manual maupun lewat CSV."
        action={
          <Button render={<Link href="/siswa/input" />} nativeButton={false}>
            <UserPlus className="size-4" />
            Tambah Siswa
          </Button>
        }
      />
      <StudentManager />
    </PageContainer>
  )
}
