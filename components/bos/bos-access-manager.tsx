"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Users } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { bosPermissionColumns, bosPermissionLabels, canViewBos, type BosPermission } from "@/lib/bos"
import type { BosAccessRow } from "@/lib/server-bos"

type Field = (typeof bosPermissionColumns)[BosPermission]

const permissions = Object.keys(bosPermissionLabels) as BosPermission[]

export function BosAccessManager({ users }: { users: BosAccessRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(users)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter(
      (row) => row.name.toLowerCase().includes(keyword) || row.nip?.includes(keyword),
    )
  }, [rows, query])

  async function toggle(row: BosAccessRow, field: Field, value: boolean) {
    const key = `${row.id}:${field}`
    setPending(key)
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, [field]: value } : item)))
    try {
      const response = await fetch("/api/bos/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.id, [field]: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Akses BOS gagal disimpan")
      toast.success(`Akses BOS ${row.name} diperbarui`)
      router.refresh()
    } catch (error) {
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, [field]: !value } : item)),
      )
      toast.error(error instanceof Error ? error.message : "Akses BOS gagal disimpan")
    } finally {
      setPending(null)
    }
  }

  const grantedCount = rows.filter((row) => canViewBos(row)).length

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama atau NIP..."
              aria-label="Cari pengguna"
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
                  <TableHead className="min-w-52">Nama</TableHead>
                  {permissions.map((permission) => (
                    <TableHead key={permission} className="min-w-32 text-center">
                      {bosPermissionLabels[permission]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={permissions.length + 1} className="h-32 text-center text-muted-foreground">
                      Tidak ada pengguna yang sesuai dengan pencarian.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const isAdmin = row.role === "ADMIN"
                    return (
                      <TableRow key={row.id} className={row.active ? undefined : "opacity-65"}>
                        <TableCell className="font-medium text-foreground">
                          {row.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {isAdmin ? "Administrator" : row.position ?? "Guru"}
                            {row.active ? "" : " · Nonaktif"}
                          </span>
                        </TableCell>
                        {permissions.map((permission) => {
                          const field = bosPermissionColumns[permission]
                          return (
                            <TableCell key={permission} className="text-center">
                              <Switch
                                // Admin selalu lolos guard, jadi toggle-nya tidak bermakna.
                                checked={isAdmin ? true : row[field]}
                                disabled={isAdmin || pending === `${row.id}:${field}`}
                                onCheckedChange={(value) => toggle(row, field, value === true)}
                                aria-label={`${bosPermissionLabels[permission]} untuk ${row.name}`}
                              />
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />
        {grantedCount} dari {rows.length} pengguna dapat membuka modul BOS. Administrator selalu punya akses penuh.
      </p>
    </div>
  )
}
