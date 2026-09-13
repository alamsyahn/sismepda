import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { auditActionLabel, auditTargetLabel } from "@/lib/rbac-audit-view"
import { requirePagePermission } from "@/lib/page-guards"
import { readRbacAudit } from "@/lib/server-rbac-admin"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"

export default async function AuditRbacPage() {
  await requirePagePermission("rbac.audit.read")
  const [entries, timeZone] = await Promise.all([readRbacAudit(), readSchoolTimeZone()])
  const formatter = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  })

  return (
    <PageContainer>
      <PageHeading
        title="Audit Akses"
        description="100 perubahan role, permission, dan kewenangan akun terbaru."
      />
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Perubahan</TableHead>
                <TableHead>Pelaku</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Ringkasan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Belum ada jejak audit RBAC.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatter.format(entry.createdAt)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{auditActionLabel(entry.action)}</div>
                      <Badge variant="secondary" className="mt-1">{entry.entity}</Badge>
                    </TableCell>
                    <TableCell>{entry.actorName}</TableCell>
                    <TableCell>{auditTargetLabel(entry)}</TableCell>
                    <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                      {entry.summary ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
