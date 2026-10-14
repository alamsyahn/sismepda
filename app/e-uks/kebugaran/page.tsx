import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { requirePagePermission } from "@/lib/page-guards"
import { prisma } from "@/lib/prisma"
import { readFitnessRoster } from "@/lib/server-fitness"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { parseSchoolDate, todayInSchoolTimeZone } from "@/lib/school-date"
import { FitnessClassInput } from "@/components/e-uks/fitness-class-input"

export const dynamic = "force-dynamic"
export default async function FitnessPage({ searchParams }: { searchParams: Promise<{ classId?: string; testedAt?: string }> }) {
  await requirePagePermission("euks.fitness.read")
  const [params, classes, timeZone] = await Promise.all([
    searchParams,
    prisma.schoolClass.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    readSchoolTimeZone(),
  ])
  const today = todayInSchoolTimeZone(new Date(), timeZone)
  const requestedDate = parseSchoolDate(params.testedAt)
  const testedAt = requestedDate && requestedDate <= today ? requestedDate : today
  const classId = classes.find(c => c.id === params.classId)?.id ?? classes[0]?.id
  const data = classId ? await readFitnessRoster(classId, testedAt) : null
  return <PageContainer>
    <PageHeading title="Catatan Kebugaran" description="Pencatatan beep test per kelas. Hasil menggambarkan daya tahan aerobik, bukan kebugaran keseluruhan." />
    {data && classId ? <FitnessClassInput key={`${classId}:${testedAt}`} classes={classes} classId={classId} testedAt={testedAt} data={data} /> : <p className="text-muted-foreground">Belum ada kelas untuk dicatat.</p>}
  </PageContainer>
}
