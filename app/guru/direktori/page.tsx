import { requireUser } from "@/lib/auth-guards"
import { readTeacherDirectory } from "@/lib/server-teacher-profile"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { TeacherDirectory } from "@/components/guru/teacher-directory"
import { fromPrismaDate } from "@/lib/school-date"

export default async function TeacherDirectoryPage() {
  await requireUser()
  const teachers = await readTeacherDirectory()

  return (
    <PageContainer>
      <PageHeading
        title="Direktori Guru"
        description="Cari data guru, lihat profil lengkap, dan export data kepegawaian."
      />
      <TeacherDirectory
        teachers={teachers.map((teacher) => ({
          ...teacher,
          teachingSince: teacher.teachingSince ? fromPrismaDate(teacher.teachingSince) : null,
        }))}
      />
    </PageContainer>
  )
}
