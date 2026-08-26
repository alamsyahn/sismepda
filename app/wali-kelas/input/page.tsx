import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { WaliKelasManager } from "@/components/wali-kelas/wali-kelas-manager"

export default function WaliKelasInputPage() {
  return (
    <PageContainer>
      <div className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex items-center gap-1.5">
            <li>Data Guru</li>
            <li aria-hidden>/</li>
            <li className="font-medium text-foreground">Wali Kelas</li>
          </ol>
        </nav>
        <PageHeading
          title="Input Data Wali Kelas"
          description="Tentukan guru yang menjadi wali kelas untuk setiap kelas"
        />
      </div>

      <WaliKelasManager />
    </PageContainer>
  )
}
