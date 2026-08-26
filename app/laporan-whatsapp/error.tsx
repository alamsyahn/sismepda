"use client"

import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageContainer, PageHeading } from "@/components/layout/page-container"

export default function LaporanWhatsAppError({ reset }: { reset: () => void }) {
  return (
    <PageContainer>
      <PageHeading title="Laporan WhatsApp" description="Terjadi kendala saat menyiapkan laporan." />
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <TriangleAlert className="size-8 text-destructive" />
          <div className="space-y-1">
            <p className="font-semibold">Data laporan gagal dimuat</p>
            <p className="text-sm text-muted-foreground">Periksa koneksi lalu coba muat kembali.</p>
          </div>
          <Button onClick={reset}>Coba Lagi</Button>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
