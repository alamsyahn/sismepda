import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireDevelopmentViewer } from "@/lib/development-access"
import { developmentCliCommands } from "@/lib/development-cli"
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"

/**
 * Halaman Development — dokumentasi CLI, sepenuhnya read-only.
 *
 * Halaman ini hanya menampilkan teks. Tidak ada tombol jalankan, tidak ada
 * endpoint eksekusi, dan tidak ada `child_process`: daftar perintah dibaca dari
 * `package.json` pada waktu build/render server, bukan dengan memanggil
 * `npm run`. Nama perintah produksi (deploy, backup, migrasi media) muncul
 * murni sebagai dokumentasi.
 */
export default async function DevelopmentPage() {
  try {
    await requireDevelopmentViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    if (error instanceof UnauthorizedError) redirect("/login")
    throw error
  }

  const commands = developmentCliCommands()

  return (
    <PageContainer>
      <PageHeading
        title="Development"
        description="Dokumentasi perintah CLI untuk pengembangan, maintenance, backup, dan deployment SISMEPDA."
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">No</TableHead>
              <TableHead className="w-44">Kategori</TableHead>
              <TableHead className="w-72">Command</TableHead>
              <TableHead>Kegunaan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commands.map((entry) => (
              <TableRow key={entry.name} className="align-top">
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {entry.no}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="whitespace-nowrap font-normal">
                    {entry.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  <code className="bg-muted rounded px-1.5 py-1 font-mono text-xs break-all">
                    {entry.command}
                  </code>
                </TableCell>
                <TableCell className="text-muted-foreground min-w-64 py-3 text-sm leading-relaxed">
                  {entry.description}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  )
}
