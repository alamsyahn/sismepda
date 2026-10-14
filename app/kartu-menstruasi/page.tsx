import { requirePagePermission } from '@/lib/page-guards'
import { readMenstruationCard } from '@/lib/server-menstruation'
import { MenstruationCard } from '@/components/e-uks/menstruation-card'
import { PageContainer, PageHeading } from '@/components/layout/page-container'
export const dynamic = 'force-dynamic'
export default async function KartuMenstruasiPage() {
 await requirePagePermission("euks.menstruation.read.own")
 const data = await readMenstruationCard()
 return <PageContainer><PageHeading title="Kartu Menstruasi Saya" description="Catatan pribadi mulai dan selesai menstruasi." /><MenstruationCard data={data} today={data.today} canCreate={data.canCreate} canUpdate={data.canUpdate} own /></PageContainer>
}
