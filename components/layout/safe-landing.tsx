import { Card, CardContent } from "@/components/ui/card"
import { Compass } from "lucide-react"

/**
 * Landing untuk pengguna yang sah tetapi belum punya dashboard.
 *
 * Sengaja tanpa data: komponen ini tidak melakukan query apa pun, sehingga
 * pengguna tanpa hak tidak pernah memicu pembacaan data privat.
 */
export function SafeLanding({ name }: { name: string | null }) {
  return (
    <Card className="border-border/70">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="size-7" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Selamat datang{name ? `, ${name}` : ""}</h1>
          <p className="max-w-md text-sm text-muted-foreground text-pretty">
            Akun Anda belum memiliki akses ke dashboard absensi. Gunakan menu di samping untuk
            membuka modul yang tersedia, atau hubungi administrator bila Anda merasa seharusnya
            memiliki akses lebih.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
