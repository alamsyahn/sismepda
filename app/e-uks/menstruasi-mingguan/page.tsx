import { requirePagePermission, pageCan } from '@/lib/page-guards'
import { prisma } from '@/lib/prisma'
import { readMenstruationCard, readMenstruationWeek } from '@/lib/server-menstruation'
import { MenstruationWeekly } from '@/components/e-uks/menstruation-weekly'
import { PageContainer, PageHeading } from '@/components/layout/page-container'
import { parseSchoolDate, requireSchoolDate, startOfSchoolWeek, todayInSchoolTimeZone } from '@/lib/school-date'
import { readSchoolTimeZone } from '@/lib/server-school-time-zone'
export const dynamic = 'force-dynamic'
export default async function MenstruasiMingguanPage({ searchParams }: { searchParams: Promise<{ classId?: string; weekStart?: string }> }) {
 await requirePagePermission("euks.menstruation.read")
 const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
 const params = await searchParams
 const classId = classes.some(c => c.id === params.classId) ? params.classId! : classes[0]?.id
 const weekStart = startOfSchoolWeek(parseSchoolDate(params.weekStart) ?? requireSchoolDate(todayInSchoolTimeZone(new Date(), await readSchoolTimeZone())))
 if (!classId) return <PageContainer><PageHeading title="Menstruasi Mingguan" description="Belum ada kelas." /></PageContainer>
 const data = await readMenstruationWeek(classId, weekStart)
 const cards = await Promise.all(data.students.map(s => readMenstruationCard(s.id)))
 const canReview = await pageCan('euks.menstruation.review')
 const rows = data.students.map(s => { const card = cards.find(c => c.student.id === s.id)!; return { student: { id: s.id, name: s.name }, observation: s.confirmation, episodes: card.episodes, conflicts: card.conflicts, profileVersion: card.profile.version, needsReview: card.conflicts.length > 0 } })
 return <PageContainer><PageHeading title="Menstruasi Mingguan" description="Konfirmasi mingguan siswi aktif, bukan pengisian harian." /><MenstruationWeekly key={`${classId}:${weekStart}`} data={{ classId, weekStart, rows }} classes={classes} canCreate={data.canCreate} canUpdate={data.canUpdate} canReview={canReview} /></PageContainer>
}
