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
import { isValidEmail, isValidPhone, normalizePhone } from "@/lib/guru-input"
import { ExportButton } from "@/components/export/export-button"

type Teacher = {
  id: string
  nip: string | null
  email: string | null
  name: string
  phone: string | null
  active: boolean
  homeroomClass: { name: string } | null
}

type EditValues = { nip: string; email: string; name: string; phone: string; password: string }

export function TeacherManager() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("active")
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [values, setValues] = useState<EditValues>({ nip: "", email: "", name: "", phone: "", password: "" })
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

  function openEdit(teacher: Teacher) {
    setEditing(teacher)
    setValues({
      nip: teacher.nip ?? "",
      email: teacher.email ?? "",
      name: teacher.name,
      phone: teacher.phone ?? "",
      password: "",
    })
  }

  async function patchTeacher(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/teachers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "Data guru gagal diperbarui")
    setTeachers((current) => current.map((teacher) => teacher.id === data.id ? data : teacher))
  }

  async function saveEdit() {
    const nip = values.nip.trim()
    const email = values.email.trim().toLowerCase()
    const phone = normalizePhone(values.phone)
    if (!editing || !values.name.trim() || (!nip && !email)) {
      toast.error("Nama lengkap dan minimal salah satu NIP atau email wajib diisi")
      return
    }
    if ((nip && !/^\d+$/.test(nip)) || (email && !isValidEmail(email))) {
      toast.error("Format NIP atau email tidak valid")
      return
    }
    if ((phone && !isValidPhone(phone)) || (values.password && values.password.length < 8)) {
      toast.error("Periksa format telepon atau gunakan password minimal 8 karakter")
      return
    }

    setSaving(true)
    try {
      await patchTeacher({
        id: editing.id,
        nip,
        email,
        name: values.name.trim(),
        phone,
        ...(values.password ? { password: values.password } : {}),
      })
      setEditing(null)
      toast.success("Data guru berhasil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Data guru gagal diperbarui")
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus() {
    if (!statusTarget) return
    setSaving(true)
    try {
      await patchTeacher({ id: statusTarget.id, active: !statusTarget.active })
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
      const response = await fetch("/api/admin/teachers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, confirmationIdentifier: deleteConfirmation.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Guru gagal dihapus permanen")
      setTeachers((current) => current.filter((teacher) => teacher.id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeleteConfirmation("")
      toast.success("Guru dihapus permanen", { description: `${data.reassignedSubmissions} riwayat penginputan dialihkan ke admin.` })
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
        <TableHead>Nama Guru</TableHead><TableHead>NIP</TableHead><TableHead>Email</TableHead>
        <TableHead>Telepon</TableHead><TableHead>Wali Kelas</TableHead><TableHead>Status</TableHead>
        <TableHead className="text-right">Aksi</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {loading ? <TableRow><TableCell colSpan={7} className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
          : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">Tidak ada guru yang sesuai.</TableCell></TableRow>
          : filtered.map((teacher) => <TableRow key={teacher.id} className={!teacher.active ? "opacity-65" : undefined}>
            <TableCell className="font-medium">{teacher.name}</TableCell>
            <TableCell className="font-mono text-sm">{teacher.nip ?? "-"}</TableCell>
            <TableCell>{teacher.email ?? "-"}</TableCell>
            <TableCell>{teacher.phone ?? "-"}</TableCell>
            <TableCell>{teacher.homeroomClass?.name ?? "-"}</TableCell>
            <TableCell><Badge variant={teacher.active ? "default" : "secondary"}>{teacher.active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
            <TableCell><div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => openEdit(teacher)}><Pencil className="size-4" /> Edit</Button>
              <Button variant="outline" size="sm" onClick={() => setStatusTarget(teacher)}>{teacher.active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}{teacher.active ? "Nonaktifkan" : "Aktifkan"}</Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setDeleteTarget(teacher); setDeleteConfirmation("") }}><Trash2 className="size-4" /> Hapus</Button>
            </div></TableCell>
          </TableRow>)}
      </TableBody>
    </Table></div></CardContent></Card>
    <p className="text-sm text-muted-foreground">Menampilkan {filtered.length} dari {teachers.length} guru.</p>

    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit data guru</DialogTitle><DialogDescription>Nama dan minimal salah satu NIP atau email wajib diisi. Telepon dan password baru bersifat opsional.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="teacher-name">Nama lengkap</Label><Input id="teacher-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="teacher-nip">NIP (opsional jika email diisi)</Label><Input id="teacher-nip" inputMode="numeric" value={values.nip} onChange={(event) => setValues((current) => ({ ...current, nip: event.target.value.replace(/\D/g, "") }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="teacher-email">Email (opsional jika NIP diisi)</Label><Input id="teacher-email" type="email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="teacher-phone">Nomor telepon (opsional)</Label><Input id="teacher-phone" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="teacher-password">Password baru (opsional)</Label><Input id="teacher-password" type="password" autoComplete="new-password" value={values.password} onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))} placeholder="Minimal 8 karakter" /></div>
        </div>
        <DialogFooter><DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose><Button onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

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
