"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OFFICER_NAME_MAX, OFFICER_ROLE_MAX } from "@/lib/euks-settings"

export type OfficerRow = {
  id: string
  name: string
  role: string
  active: boolean
  sortOrder: number
  userId: string | null
  user: { name: string; active: boolean } | null
}

const MANUAL = "__manual__"

export function EuksOfficerSettings({
  officers,
  teachers,
}: {
  officers: OfficerRow[]
  teachers: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [selection, setSelection] = useState<string>(MANUAL)
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  const [busy, setBusy] = useState(false)

  const isManual = selection === MANUAL

  const send = async (init: RequestInit, failure: string) => {
    setBusy(true)
    try {
      const response = await fetch("/api/e-uks/officers", {
        headers: { "Content-Type": "application/json" },
        ...init,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? failure)
      }
      router.refresh()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (isManual && name.trim().length < 2) return toast.error("Nama pengurus wajib diisi")
    if (!isManual && selection === "") return toast.error("Pilih guru terlebih dahulu")
    if (role.trim().length < 2) return toast.error("Jabatan wajib diisi")

    const ok = await send(
      {
        method: "POST",
        body: JSON.stringify({
          userId: isManual ? null : selection,
          // Untuk guru, nama diambil server dari akunnya; kirim placeholder
          // yang memenuhi validasi panjang minimum.
          name: isManual ? name.trim() : (teachers.find((t) => t.id === selection)?.name ?? "-"),
          role: role.trim(),
        }),
      },
      "Gagal menambah pengurus",
    )
    if (ok) {
      toast.success("Pengurus ditambahkan")
      setName("")
      setRole("")
      setSelection(MANUAL)
    }
  }

  const toggle = async (officer: OfficerRow, active: boolean) => {
    const ok = await send(
      { method: "PATCH", body: JSON.stringify({ id: officer.id, active }) },
      "Gagal memperbarui pengurus",
    )
    if (ok) toast.success(active ? "Pengurus diaktifkan" : "Pengurus dinonaktifkan")
  }

  const move = async (officer: OfficerRow, direction: "up" | "down") => {
    await send(
      { method: "PATCH", body: JSON.stringify({ id: officer.id, move: direction }) },
      "Gagal mengubah urutan",
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengurus UKS</CardTitle>
        <CardDescription>
          Pilih guru yang sudah punya akun, atau ketik manual untuk siswa dan pihak luar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className={`grid items-end gap-3 ${isManual ? "sm:grid-cols-[1fr_1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]"}`}>
          <div className="space-y-1.5">
            <Label htmlFor="euks-officer-person">Orang</Label>
            <Select value={selection} onValueChange={(value) => setSelection(String(value))}>
              <SelectTrigger id="euks-officer-person" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === MANUAL
                      ? "Ketik manual (siswa / pihak luar)"
                      : (teachers.find((t) => t.id === value)?.name ?? "Ketik manual (siswa / pihak luar)")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL}>Ketik manual (siswa / pihak luar)</SelectItem>
                {teachers.map((teacher) => (
                  <SelectItem key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isManual ? (
            <div className="space-y-1.5">
              <Label htmlFor="euks-officer-name">Nama</Label>
              <Input
                id="euks-officer-name"
                value={name}
                maxLength={OFFICER_NAME_MAX}
                placeholder="Nama pengurus"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="euks-officer-role">Jabatan</Label>
            <Input
              id="euks-officer-role"
              value={role}
              maxLength={OFFICER_ROLE_MAX}
              placeholder="Pembina"
              onChange={(event) => setRole(event.target.value)}
            />
          </div>

          <Button onClick={add} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Tambah
          </Button>
        </div>

        {officers.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada pengurus UKS yang terdaftar.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {officers.map((officer, index) => (
              <li key={officer.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {officer.user?.name ?? officer.name}
                    {officer.userId ? null : (
                      <Badge variant="secondary" className="ml-2 align-middle">
                        Manual
                      </Badge>
                    )}
                    {officer.user && !officer.user.active ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        Akun nonaktif
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{officer.role}</p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Naikkan urutan"
                  disabled={busy || index === 0}
                  onClick={() => move(officer, "up")}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Turunkan urutan"
                  disabled={busy || index === officers.length - 1}
                  onClick={() => move(officer, "down")}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Switch
                  checked={officer.active}
                  disabled={busy}
                  aria-label={`Aktifkan ${officer.user?.name ?? officer.name}`}
                  onCheckedChange={(checked) => toggle(officer, Boolean(checked))}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
