import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SarprasAccessManager } from "@/components/sarpras/sarpras-access-manager"
import { SarprasAccessError, requireSarprasAccessManager } from "@/lib/sarpras-access"
import { readSarprasAccessScope } from "@/lib/server-sarpras"

export default async function SarprasAccessPage() {
  try {
    await requireSarprasAccessManager()
  } catch (error) {
    if (error instanceof SarprasAccessError) redirect("/sarpras")
    throw error
  }

  const users = await readSarprasAccessScope()

  return (
    <PageContainer>
      <PageHeading
        title="Akses Sarpras"
        description="Tentukan siapa yang dapat melihat dan mengelola data sarana & prasarana"
        action={
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            className="min-h-11 px-4"
            render={<Link href="/sarpras" />}
          >
            <ArrowLeft className="size-4" />
            Kembali
          </Button>
        }
      />
      <SarprasAccessManager users={users} />
    </PageContainer>
  )
}
