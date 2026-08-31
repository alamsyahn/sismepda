"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Users } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { canViewSarpras, sarprasPermissionLabels } from "@/lib/sarpras"
import type { SarprasAccessRow } from "@/lib/server-sarpras"

type Field = "canViewSarpras" | "canEditSarpras"

const columns: Array<{ field: Field; label: string }> = [
  { field: "canViewSarpras", label: sarprasPermissionLabels["sarpras.view"] },
  { field: "canEditSarpras", label: sarprasPermissionLabels["sarpras.edit"] },
]

export function SarprasAccessManager({ users }: { users: SarprasAccessRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(users)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter(
      (row) => row.name.toLowerCase().includes(keyword) || row.nip?.includes(keyword),
    )
  }, [rows, query])

  async function toggle(row: SarprasAccessRow, field: Field, value: boolean) {
    // Optimistic flip, rolled back if the server refuses.
    setRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, [field]: value } : item)),
    )
    try {
      const response = await fetch("/api/sarpras/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.id, [field]: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Akses Sarpras gagal disimpan")
      toast.success(`Akses Sarpras ${row.name} diperbarui`)
      router.refresh()
    } catch (error) {
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, [field]: !value } : item)),
      )
      toast.error(error instanceof Error ? error.message : "Akses Sarpras gagal disimpan")
    }
  }

  const grantedCount = rows.filter((row) => canViewSarpras(row)).length

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama atau NIP..."
              aria-label="Cari pengguna"
              className="pl-9"
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {grantedCount} dari {rows.length} akun dapat membuka modul Sarpras. Administrator selalu
            memiliki akses penuh.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-52">Nama</TableHead>
                  {columns.map((column) => (
                    <TableHead key={column.field} className="min-w-36 text-center">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="h-32">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <Users className="size-5" />
                        </span>
                        <p className="text-sm text-muted-foreground">
                          Tidak ada pengguna yang cocok.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const isAdmin = row.role === "ADMIN"
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-foreground">{row.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {isAdmin ? "Administrator" : row.position || "Guru"}
                              {row.active ? "" : " · nonaktif"}
                            </p>
                          </div>
                        </TableCell>
                        {columns.map((column) => (
                          <TableCell key={column.field} className="text-center">
                            <Switch
                              checked={isAdmin ? true : row[column.field]}
                              disabled={isAdmin}
                              aria-label={`${column.label} untuk ${row.name}`}
                              onCheckedChange={(checked) =>
                                void toggle(row, column.field, checked === true)
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
