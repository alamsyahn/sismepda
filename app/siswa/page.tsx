import Link from "next/link"
import { UserPlus } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { StudentManager } from "@/components/siswa/student-manager"
import { requirePagePermission, pageCan } from "@/lib/page-guards"

export default async function SiswaPage() {
  // Halaman ini sebelumnya hanya dijaga prefilter JWT pada proxy.
  await requirePagePermission("students.master.read")
  const canCreate = await pageCan("students.master.create")

  return (
    <PageContainer>
      <PageHeading
        title="Data Siswa"
        description="Cari, ubah, dan atur status siswa, atau tambahkan siswa baru secara manual maupun lewat CSV."
        action={
          canCreate ? (
            <Button render={<Link href="/siswa/input" />} nativeButton={false}>
              <UserPlus className="size-4" />
              Tambah Siswa
            </Button>
          ) : null
        }
      />
      <StudentManager />
    </PageContainer>
  )
}
