import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { TeacherManager } from "@/components/guru/teacher-manager"

export default function KelolaGuruPage() {
  return <PageContainer><PageHeading title="Kelola Data Guru" description="Ubah profil dan kredensial guru, atur status aktif, atau hapus akun secara permanen." /><TeacherManager /></PageContainer>
}
