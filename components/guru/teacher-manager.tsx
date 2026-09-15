"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Search, Trash2, UserCheck, UserX } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExportButton } from "@/components/export/export-button"
import { tableRowNumber } from "@/lib/table-row-number"
import { ProfileNameLink } from "@/components/profile/profile-name-link"
import { TeacherEditDialog, type TeacherRecord } from "@/components/guru/teacher-edit-dialog"

type Teacher = TeacherRecord

export function TeacherManager({
  canUpdate,
  canUpdateProfile,
  canResetPassword,
  canManageStatus,
  canDelete,
}: {
  canUpdate: boolean
  canUpdateProfile: boolean
  canResetPassword: boolean
  canManageStatus: boolean
  canDelete: boolean
}) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("active")
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [statusTarget, setStatusTarget] = useState<Teacher | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")

  useEffect(() => {
    fetch("/api/admin/teachers")
      .then((response) => { if (!response.ok) throw new Error(); return response.json() })
      .then(setTeachers)
      .catch(() => toast.error("Data guru gagal dimuat"))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => teachers.filter((teacher) => {
    const keyword = query.trim().toLowerCase()
    const matchesQuery = !keyword
      || teacher.name.toLowerCase().includes(keyword)
      || (teacher.nip ?? "").includes(keyword)
      || (teacher.email ?? "").toLowerCase().includes(keyword)
      || (teacher.phone ?? "").includes(keyword)
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? teacher.active : !teacher.active)
    return matchesQuery && matchesStatus
  }), [teachers, query, statusFilter])

  function applyTeacher(updated: Teacher) {
    setTeachers((current) => current.map((teacher) => teacher.id === updated.id ? { ...teacher, ...updated } : teacher))
  }

  async function mutateAccount(userId: string, payload: { password: string } | { active: boolean }) {
    const response = await fetch(`/api/rbac/accounts/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "Akun guru gagal diperbarui")
    return data as { id: string; active: boolean }
  }

  async function changeStatus() {
    if (!statusTarget) return
    setSaving(true)
    try {
      const updated = await mutateAccount(statusTarget.id, { active: !statusTarget.active })
      setTeachers((current) =>
        current.map((teacher) => teacher.id === updated.id ? { ...teacher, active: updated.active } : teacher),
      )
      toast.success(statusTarget.active ? "Guru berhasil dinonaktifkan" : "Guru berhasil diaktifkan")
      setStatusTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status guru gagal diperbarui")
    } finally {
      setSaving(false)
    }
  }

  async function deleteTeacher() {
    if (!deleteTarget || deleteConfirmation.trim().toLowerCase() !== (deleteTarget.nip ?? deleteTarget.email)?.toLowerCase()) return
    setSaving(true)
    try {
      const response = await fetch(`/api/rbac/accounts/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationIdentifier: deleteConfirmation.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Guru gagal dihapus permanen")
      setTeachers((current) => current.filter((teacher) => teacher.id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeleteConfirmation("")
      toast.success("Guru dihapus permanen", { description: `${data.reassignedAttendanceDays} riwayat penginputan dialihkan ke admin.` })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Guru gagal dihapus permanen")
    } finally {
      setSaving(false)
    }
  }

  const deleteIdentifier = deleteTarget?.nip ?? deleteTarget?.email ?? ""
  const deleteIdentifierLabel = deleteTarget?.nip ? "NIP" : "email"

  return <div className="space-y-4">
    <Card className="border-border/70">
      <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_180px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, NIP, email, atau telepon..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(value) => value && setStatusFilter(value)}>
          <SelectTrigger><SelectValue placeholder="Status guru" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Guru aktif</SelectItem>
            <SelectItem value="inactive">Guru nonaktif</SelectItem>
            <SelectItem value="all">Semua status</SelectItem>
          </SelectContent>
        </Select>
        <ExportButton type="teachers" params={{ query, status: statusFilter }} />
      </CardContent>
    </Card>

    <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
      <TableHeader><TableRow>
        <TableHead className="w-12 text-center">No</TableHead>
        <TableHead>Nama Guru</TableHead><TableHead>NIP</TableHead><TableHead>Email</TableHead>
        <TableHead>Telepon</TableHead><TableHead>Wali Kelas</TableHead><TableHead>Status</TableHead>
        <TableHead className="text-right">Aksi</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {loading ? <TableRow><TableCell colSpan={8} className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
          : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">Tidak ada guru yang sesuai.</TableCell></TableRow>
          : filtered.map((teacher, index) => <TableRow key={teacher.id} className={!teacher.active ? "opacity-65" : undefined}>
            <TableCell className="text-center text-muted-foreground tabular-nums">{tableRowNumber(index)}</TableCell>
            <TableCell className="font-medium"><ProfileNameLink type="teacher" id={teacher.id} name={teacher.name} /></TableCell>
            <TableCell className="font-mono text-sm">{teacher.nip ?? "-"}</TableCell>
            <TableCell>{teacher.email ?? "-"}</TableCell>
            <TableCell>{teacher.phone ?? "-"}</TableCell>
            <TableCell>{teacher.homeroomClass?.name ?? "-"}</TableCell>
            <TableCell><Badge variant={teacher.active ? "default" : "secondary"}>{teacher.active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
            <TableCell><div className="flex justify-end gap-2">
              {canUpdate || canResetPassword ? <Button variant="outline" size="sm" onClick={() => setEditing(teacher)}><Pencil className="size-4" /> Edit</Button> : null}
              {canManageStatus ? <Button variant="outline" size="sm" onClick={() => setStatusTarget(teacher)}>{teacher.active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}{teacher.active ? "Nonaktifkan" : "Aktifkan"}</Button> : null}
              {canDelete ? <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setDeleteTarget(teacher); setDeleteConfirmation("") }}><Trash2 className="size-4" /> Hapus</Button> : null}
            </div></TableCell>
          </TableRow>)}
      </TableBody>
    </Table></div></CardContent></Card>
    <p className="text-sm text-muted-foreground">Menampilkan {filtered.length} dari {teachers.length} guru.</p>

    <TeacherEditDialog
      teacher={editing}
      canUpdateIdentity={canUpdate}
      canUpdateProfile={canUpdateProfile}
      canResetPassword={canResetPassword}
      onClose={() => setEditing(null)}
      onSaved={applyTeacher}
    />

    <Dialog open={Boolean(statusTarget)} onOpenChange={(open) => { if (!open && !saving) setStatusTarget(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{statusTarget?.active ? "Nonaktifkan guru?" : "Aktifkan kembali guru?"}</DialogTitle><DialogDescription>{statusTarget?.active ? `${statusTarget.name} tidak dapat menggunakan akun ini sampai diaktifkan kembali.` : `${statusTarget?.name} akan dapat kembali menggunakan akun ini.`}</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose><Button variant={statusTarget?.active ? "destructive" : "default"} onClick={changeStatus} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{statusTarget?.active ? "Ya, Nonaktifkan" : "Ya, Aktifkan"}</Button></DialogFooter></DialogContent>
    </Dialog>

    <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !saving) { setDeleteTarget(null); setDeleteConfirmation("") } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Hapus guru secara permanen?</DialogTitle><DialogDescription>Akun {deleteTarget?.name} akan dihapus dan penugasan wali kelasnya dilepas. Riwayat absensi tetap dipertahankan dan dialihkan ke admin. Ketik {deleteIdentifierLabel} untuk mengonfirmasi.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="delete-teacher-identifier">Ketik {deleteIdentifierLabel} {deleteIdentifier}</Label><Input id="delete-teacher-identifier" inputMode={deleteTarget?.nip ? "numeric" : "email"} autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(deleteTarget?.nip ? event.target.value.replace(/\D/g, "") : event.target.value)} /></div>
        <DialogFooter><DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose><Button variant="destructive" onClick={deleteTeacher} disabled={saving || deleteConfirmation.trim().toLowerCase() !== deleteIdentifier.toLowerCase()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{saving ? "Menghapus..." : "Hapus Permanen"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
