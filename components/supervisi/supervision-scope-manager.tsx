"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Users } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type ScopeRow = {
  id: string
  name: string
  nip: string | null
  active: boolean
  position: string | null
  workbookSupervised: boolean
  canSuperviseWorkbooks: boolean
  canViewWorkbookSupervision: boolean
}

type Field = "workbookSupervised" | "canSuperviseWorkbooks" | "canViewWorkbookSupervision"

export function SupervisionScopeManager({ teachers }: { teachers: ScopeRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(teachers)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter(
      (row) => row.name.toLowerCase().includes(keyword) || row.nip?.includes(keyword),
    )
  }, [rows, query])

  async function toggle(row: ScopeRow, field: Field, value: boolean) {
    const key = `${row.id}:${field}`
    setPending(key)
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, [field]: value } : item)))
    try {
      const response = await fetch("/api/workbooks/scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: row.id, [field]: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Pengaturan supervisi gagal disimpan")
      toast.success(`Pengaturan ${row.name} diperbarui`)
      router.refresh()
    } catch (error) {
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, [field]: !value } : item)),
      )
      toast.error(error instanceof Error ? error.message : "Pengaturan supervisi gagal disimpan")
    } finally {
      setPending(null)
    }
  }

  const supervisedCount = rows.filter((row) => row.workbookSupervised).length

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama guru atau NIP..."
              aria-label="Cari guru"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-52">Nama Guru</TableHead>
                  <TableHead className="min-w-36 text-center">Disupervisi</TableHead>
                  <TableHead className="min-w-36 text-center">Dapat Menyupervisi</TableHead>
                  <TableHead className="min-w-36 text-center">Lihat Saja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      Tidak ada guru yang sesuai dengan pencarian.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <TableRow key={row.id} className={row.active ? undefined : "opacity-65"}>
                      <TableCell className="font-medium text-foreground">
                        {row.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.position ?? "Guru"}
                          {row.active ? "" : " · Nonaktif"}
                        </span>
                      </TableCell>
                      {(
                        [
                          ["workbookSupervised", "Disupervisi"],
                          ["canSuperviseWorkbooks", "Dapat menyupervisi"],
                          ["canViewWorkbookSupervision", "Lihat saja"],
                        ] as Array<[Field, string]>
                      ).map(([field, label]) => (
                        <TableCell key={field} className="text-center">
                          <Switch
                            checked={row[field]}
                            disabled={pending === `${row.id}:${field}`}
                            onCheckedChange={(value) => toggle(row, field, value === true)}
                            aria-label={`${label} untuk ${row.name}`}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />
        {supervisedCount} dari {rows.length} guru masuk dalam tabel supervisi.
      </p>
    </div>
  )
}
