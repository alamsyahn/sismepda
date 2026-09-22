import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { EuksVisitTable } from "@/components/e-uks/euks-visit-table"
import { pageCan, requirePagePermission } from "@/lib/page-guards"
import { readEuksComplaintOptions, readEuksStudentOptions, readEuksVisits } from "@/lib/server-euks"

export default async function EuksRiwayatKunjunganPage() {
  await requirePagePermission("euks.visits.read")
  const [canCreate, canUpdate, canDelete, canNotify, canReadComplaints] = await Promise.all([
    pageCan("euks.visits.create"),
    pageCan("euks.visits.update"),
    pageCan("euks.visits.delete"),
    pageCan("euks.visits.notify"),
    pageCan("euks.complaint_options.read"),
  ])

  const [visits, students, complaintOptions] = await Promise.all([
    readEuksVisits(),
    canCreate || canUpdate ? readEuksStudentOptions() : Promise.resolve([]),
    canReadComplaints ? readEuksComplaintOptions() : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeading
        title="Riwayat Kunjungan UKS"
        description="Catatan keluhan, tindakan yang diberikan, dan tindak lanjut setiap kunjungan"
      />

      <EuksVisitTable
        visits={visits}
        students={students}
        complaintOptions={complaintOptions}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        canNotify={canNotify}
      />
    </PageContainer>
  )
}
