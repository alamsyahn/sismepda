"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { filterBySearchQuery } from "@/lib/entity-search"
import { subjectNameProblem, SUBJECT_NAME_MAX_LENGTH } from "@/lib/subject-constants"
import type { SubjectView } from "@/lib/server-subjects"

/**
 * Pengelola Data Master Mata Pelajaran.
 *
 * Mengikuti pola mutasi modul lain: route handler + `router.refresh()`, bukan
 * pembaruan optimistis. Daftar yang tampil selalu berasal dari server, sehingga
 * penolakan (nama bentrok, mata pelajaran masih terpakai) tidak pernah
 * menyisakan baris palsu di layar.
 */
export function SubjectManager({
  initialSubjects,
  canCreate,
  canUpdate,
  canDelete,
}: {
  initialSubjects: readonly SubjectView[]
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<SubjectView | null>(null)
  const [removing, setRemoving] = useState<SubjectView | null>(null)
  const [name, setName] = useState("")

  const visible = filterBySearchQuery(initialSubjects, query, (item) => item.name)

  async function send(
    method: "POST" | "PUT" | "DELETE",
    body: Record<string, unknown>,
    success: string,
  ) {
    if (busy) return false
    setBusy(true)
    try {
      const response = await fetch("/api/mata-pelajaran", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? "Operasi gagal")
      }
      toast.success(success)
      // Sumber daftar adalah server component induk; memuat ulang di sini
      // membuat nilai baru langsung terlihat tanpa refresh peramban.
      router.refresh()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operasi gagal")
      return false
    } finally {
      setBusy(false)
    }
  }

  function guardName(): boolean {
    const problem = subjectNameProblem(name)
    if (problem) {
      toast.error(problem)
      return false
    }
    return true
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5 sm:max-w-sm sm:flex-1">
          <Label htmlFor="mapel-cari">Cari mata pelajaran</Label>
          <Input
            id="mapel-cari"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ketik sebagian nama"
          />
        </div>

        {canCreate ? (
          <Button
            onClick={() => {
              setName("")
              setCreateOpen(true)
            }}
          >
            <Plus className="size-4" />
            Tambah mata pelajaran
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {visible.length} dari {initialSubjects.length} mata pelajaran
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {initialSubjects.length === 0
            ? "Belum ada mata pelajaran. Tambahkan lebih dulu agar dapat dipakai jadwal dan pemetaan impor aSc."
            : "Tidak ada mata pelajaran yang cocok dengan pencarian."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Dipakai</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((subject) => {
                const used =
                  subject.usage.scheduleEntries +
                  subject.usage.assignments +
                  subject.usage.teacherSubjects +
                  subject.usage.importMappings
                return (
                  <TableRow key={subject.id}>
                    <TableCell className="font-medium">{subject.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {used === 0 ? "Belum dipakai" : `${used} keterkaitan`}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {canUpdate ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setName(subject.name)
                              setEditing(subject)
                            }}
                          >
                            <Pencil className="size-4" />
                            Ubah
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            variant="outline"
                            size="sm"
                            // Mata pelajaran yang masih dipakai tidak dapat
                            // dihapus; tombolnya dimatikan agar alasannya
                            // terlihat sebelum ditekan, bukan sesudah ditolak.
                            disabled={!subject.deletable}
                            title={
                              subject.deletable
                                ? undefined
                                : "Masih dipakai jadwal, penugasan, atau pemetaan impor"
                            }
                            onClick={() => setRemoving(subject)}
                          >
                            <Trash2 className="size-4" />
                            Hapus
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah mata pelajaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mapel-baru">Nama</Label>
            <Input
              id="mapel-baru"
              value={name}
              maxLength={SUBJECT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contoh: Bahasa Indonesia"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!guardName()) return
                if (await send("POST", { name }, "Mata pelajaran ditambahkan")) setCreateOpen(false)
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah mata pelajaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mapel-ubah">Nama</Label>
            <Input
              id="mapel-ubah"
              value={name}
              maxLength={SUBJECT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Jadwal dan pemetaan impor yang sudah ada ikut memakai nama baru karena keduanya
              menunjuk mata pelajaran yang sama, bukan namanya.
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!editing || !guardName()) return
                if (await send("PUT", { id: editing.id, name }, "Mata pelajaran diperbarui")) {
                  setEditing(null)
                }
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus mata pelajaran?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {removing ? `"${removing.name}" akan dihapus permanen.` : null}
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!removing) return
                if (await send("DELETE", { id: removing.id }, "Mata pelajaran dihapus")) {
                  setRemoving(null)
                }
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
