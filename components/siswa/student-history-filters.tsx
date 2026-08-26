"use client"

import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function StudentHistoryFilters({ studentId, from, to, status }: { studentId: string; from: string; to: string; status: string }) {
  const router = useRouter()

  function submit(formData: FormData) {
    const params = new URLSearchParams()
    for (const key of ["from", "to", "status"] as const) {
      const value = String(formData.get(key) ?? "")
      if (value && value !== "all") params.set(key, value)
    }
    router.push(`/siswa/${studentId}${params.size ? `?${params}` : ""}`)
  }

  return (
    <form action={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_190px_auto_auto] md:items-end">
      <div className="space-y-1.5"><label htmlFor="history-from" className="text-sm font-medium">Dari tanggal</label><Input id="history-from" name="from" type="date" defaultValue={from} /></div>
      <div className="space-y-1.5"><label htmlFor="history-to" className="text-sm font-medium">Sampai tanggal</label><Input id="history-to" name="to" type="date" defaultValue={to} /></div>
      <div className="space-y-1.5"><label htmlFor="history-status" className="text-sm font-medium">Status</label><Select name="status" defaultValue={status}><SelectTrigger id="history-status" className="w-full"><SelectValue placeholder="Semua status" /></SelectTrigger><SelectContent><SelectItem value="all">Semua status</SelectItem><SelectItem value="hadir">Hadir</SelectItem><SelectItem value="sakit">Sakit</SelectItem><SelectItem value="izin">Izin</SelectItem><SelectItem value="dispensasi">Dispensasi</SelectItem><SelectItem value="alfa">Alfa</SelectItem></SelectContent></Select></div>
      <Button type="submit"><Search className="size-4" />Terapkan</Button>
      <Button type="button" variant="outline" onClick={() => router.push(`/siswa/${studentId}`)}><X className="size-4" />Reset</Button>
    </form>
  )
}
