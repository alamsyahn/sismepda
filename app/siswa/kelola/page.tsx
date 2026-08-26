import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { StudentManager } from "@/components/siswa/student-manager"

export default function KelolaSiswaPage() {
  return (
    <PageContainer>
      <PageHeading title="Kelola Data Siswa" description="Ubah identitas dan kelas siswa, atau atur status aktif tanpa menghapus riwayat absensi." />
      <StudentManager />
    </PageContainer>
  )
}
