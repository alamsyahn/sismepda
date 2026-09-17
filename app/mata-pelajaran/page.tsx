import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SubjectManager } from "@/components/mata-pelajaran/subject-manager"
import { requirePagePermission, pageCan } from "@/lib/page-guards"
import { listSubjects } from "@/lib/server-subjects"

/**
 * Data Master Mata Pelajaran.
 *
 * Daftar ini sudah lama dipakai jadwal dan pemetaan impor aSc, tetapi barisnya
 * dulu hanya lahir diam-diam dari alur lain. Halaman ini menjadikannya data
 * master yang dapat dilihat dan dirapikan secara sadar.
 */
export default async function MataPelajaranPage() {
  await requirePagePermission("subjects.read")

  const [subjects, canCreate, canUpdate, canDelete] = await Promise.all([
    listSubjects(),
    pageCan("subjects.create"),
    pageCan("subjects.update"),
    pageCan("subjects.delete"),
  ])

  return (
    <PageContainer>
      <div className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex items-center gap-1.5">
            <li>Data Master</li>
            <li aria-hidden>/</li>
            <li className="font-medium text-foreground">Mata Pelajaran</li>
          </ol>
        </nav>
        <PageHeading
          title="Mata Pelajaran"
          description="Daftar mata pelajaran yang dipakai jadwal, penugasan mengajar, dan pemetaan impor aSc"
        />
      </div>

      <SubjectManager
        initialSubjects={subjects}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
      />
    </PageContainer>
  )
}
