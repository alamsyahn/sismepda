import { redirect } from "next/navigation"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { ScheduleView } from "@/components/jadwal/schedule-view"
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"
import { requirePageAnyPermission } from "@/lib/page-guards"
import { readScheduleViewer } from "@/lib/schedule-access"
import { SCHEDULE_PAGE_PERMISSIONS } from "@/lib/schedule-authorization"
import {
  ensureActiveTimeProfile,
  isScheduleTeacher,
  listTimeTemplates,
  readNowContext,
  readScheduleMasterData,
} from "@/lib/server-schedule"

/**
 * Satu halaman untuk seluruh modul Jadwal.
 *
 * "Jadwal Saya", "Jadwal Kelas", dan seterusnya adalah TAB di sini, bukan item
 * sidebar terpisah. Tab yang tampil ditentukan permission yang sama yang
 * ditegakkan route handler — menyembunyikan tab bukan pengamanan, hanya
 * kebersihan tampilan.
 */
export default async function JadwalPage() {
  await requirePageAnyPermission(SCHEDULE_PAGE_PERMISSIONS)

  let viewer
  try {
    viewer = await readScheduleViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    if (error instanceof UnauthorizedError) redirect("/login")
    throw error
  }

  const profile = await ensureActiveTimeProfile()
  const [now, master, viewerIsTeacher, templates] = await Promise.all([
    readNowContext(profile),
    readScheduleMasterData(),
    isScheduleTeacher(viewer.id),
    listTimeTemplates(),
  ])

  return (
    <PageContainer>
      <PageHeading
        title="Jadwal"
        description="Jadwal pelajaran mingguan, jam kosong guru, dan struktur waktu sekolah"
      />
      <ScheduleView
        viewerId={viewer.id}
        viewerIsTeacher={viewerIsTeacher}
        capabilities={viewer.capabilities}
        profile={profile}
        templates={templates}
        now={now}
        master={master}
      />
    </PageContainer>
  )
}
