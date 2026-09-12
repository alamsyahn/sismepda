"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Users } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { BosAccessRow } from "@/lib/server-bos"
import { BOS_BUNDLE_PERMISSION_SETS, type BosBundleKey } from "@/lib/bos-access-service"

const labels: Record<BosBundleKey, string> = {
  legacy_bos_view: "Lihat BOS",
  legacy_bos_create: "Tambah Entry + Kategori",
  legacy_bos_edit: "Edit Entry + Anggaran",
  legacy_bos_categories: "Ubah Kategori",
  legacy_bos_access: "Kelola Akses BOS",
}
const bundles = Object.keys(BOS_BUNDLE_PERMISSION_SETS) as BosBundleKey[]

export function BosAccessManager({ users }: { users: BosAccessRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(users)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(keyword) || row.nip?.includes(keyword))
  }, [rows, query])

  async function toggle(row: BosAccessRow, bundleKey: BosBundleKey, assigned: boolean) {
    const key = `${row.id}:${bundleKey}`
    setPending(key)
    setRows((current) => current.map((item) => item.id === row.id ? {
      ...item,
      bundleKeys: assigned
        ? [...new Set([...item.bundleKeys, bundleKey])]
        : item.bundleKeys.filter((candidate: string) => candidate !== bundleKey),
    } : item))
    try {
      const response = await fetch("/api/bos/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.id, bundleKey, assigned }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Akses BOS gagal disimpan")
      toast.success(`Akses BOS ${row.name} diperbarui`)
      router.refresh()
    } catch (error) {
      setRows(users)
      toast.error(error instanceof Error ? error.message : "Akses BOS gagal disimpan")
    } finally {
      setPending(null)
    }
  }

  const grantedCount = rows.filter((row) => row.bundleKeys.length > 0).length

  return (
    <div className="space-y-4">
      <Card className="border-border/70"><CardContent className="space-y-3 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau NIP..." aria-label="Cari pengguna" className="pl-9" />
        </div>
        <p className="text-sm text-muted-foreground">
          Hak efektif adalah gabungan (OR) semua role pengguna. Mencabut satu bundle hanya menghapus role bundle tersebut; hak yang sama dari role lain tetap berlaku.
        </p>
      </CardContent></Card>

      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead className="min-w-52">Nama</TableHead>{bundles.map((key) => <TableHead key={key} className="min-w-36 text-center">{labels[key]}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{filtered.length === 0 ? <TableRow><TableCell colSpan={bundles.length + 1} className="h-32 text-center text-muted-foreground">Tidak ada pengguna yang sesuai dengan pencarian.</TableCell></TableRow> : filtered.map((row) => (
          <TableRow key={row.id} className={row.active ? undefined : "opacity-65"}>
            <TableCell className="font-medium text-foreground">{row.name}<span className="ml-2 text-xs text-muted-foreground">{row.position ?? "Pengguna"}{row.active ? "" : " · Nonaktif"}{row.protected ? " · Terlindungi" : ""}</span></TableCell>
            {bundles.map((bundleKey) => <TableCell key={bundleKey} className="text-center"><Switch checked={row.bundleKeys.includes(bundleKey)} disabled={row.protected || pending === `${row.id}:${bundleKey}`} onCheckedChange={(value) => toggle(row, bundleKey, value === true)} aria-label={`${labels[bundleKey]} untuk ${row.name}`} /></TableCell>)}
          </TableRow>
        ))}</TableBody>
      </Table></div></CardContent></Card>

      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" />{grantedCount} dari {rows.length} pengguna memiliki sedikitnya satu bundle BOS.</p>
    </div>
  )
}
