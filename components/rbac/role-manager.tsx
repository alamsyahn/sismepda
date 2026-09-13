"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil, Plus, ShieldAlert, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PermissionMatrix } from "@/components/rbac/permission-matrix"
import { roleKeyFromName } from "@/lib/rbac-role-key"
import type { PermissionRow, RoleRow } from "@/lib/server-rbac-admin"

/**
 * Administrasi role.
 *
 * Yang sengaja TIDAK dilakukan di klien: menentukan siapa boleh memberi apa.
 * Komponen ini hanya menonaktifkan kontrol untuk memberi umpan balik; seluruh
 * penolakan nyata datang dari server. Menyembunyikan tombol bukan otorisasi.
 */
export function RoleManager({
  roles,
  catalog,
  canManage,
}: {
  roles: RoleRow[]
  catalog: PermissionRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const labelByKey = new Map(catalog.map((permission) => [permission.key, permission.label]))

  function openCreate() {
    setCreating(true)
    setName("")
    setDescription("")
    setSelected(new Set())
  }

  function openEdit(role: RoleRow) {
    setEditing(role)
    setName(role.name)
    setDescription(role.description ?? "")
    setSelected(new Set(role.permissionKeys))
  }

  /** Dampak edit ditampilkan sebelum disimpan, bukan sesudah. */
  function diffFor(role: RoleRow) {
    const before = new Set(role.permissionKeys)
    const added = [...selected].filter((key) => !before.has(key))
    const removed = [...before].filter((key) => !selected.has(key))
    return { added, removed }
  }

  async function submit(url: string, method: string, payload: unknown, success: string) {
    setBusy(true)
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    setBusy(false)

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      toast.error(body.error ?? "Permintaan ditolak")
      return false
    }

    toast.success(success)
    setCreating(false)
    setEditing(null)
    setDeleting(null)
    router.refresh()
    return true
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Role</CardTitle>
            <CardDescription>
              Kumpulan permission yang diberikan ke akun. Otorisasi selalu memakai kunci role,
              tidak pernah nama tampilannya.
            </CardDescription>
          </div>
          <Button onClick={openCreate} disabled={!canManage}>
            <Plus className="size-4" />
            Role Baru
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex flex-col gap-3 rounded-lg border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.name}</span>
                  {role.isSystemAdmin ? (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="size-3" />
                      Bypass penuh
                    </Badge>
                  ) : null}
                  {role.isSystem ? <Badge variant="secondary">Bawaan sistem</Badge> : null}
                  {role.isProtected ? <Badge variant="outline">Terlindungi</Badge> : null}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" />
                    {role.memberCount} anggota
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {role.description ?? "Tanpa deskripsi"}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {role.key} · {role.permissionKeys.length} permission
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(role)} disabled={!canManage}>
                  <Pencil className="size-4" />
                  Ubah
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleting(role)}
                  // Role bawaan sistem tidak boleh dihapus; server juga menolak.
                  disabled={!canManage || role.isSystem}
                >
                  <Trash2 className="size-4" />
                  Hapus
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Buat role */}
      <Dialog open={creating} onOpenChange={(open) => !busy && setCreating(open)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Role Baru</DialogTitle>
            <DialogDescription>
              Kunci role dibuat otomatis dari nama dan tidak pernah berubah setelahnya.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Nama</Label>
              <Input id="role-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Deskripsi</Label>
              <Input
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <PermissionMatrix
              catalog={catalog}
              selected={selected}
              disabled={busy}
              onChange={setSelected}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy || !roleKeyFromName(name)}
              onClick={() =>
                submit(
                  "/api/rbac/roles",
                  "POST",
                  {
                    key: roleKeyFromName(name),
                    name: name.trim(),
                    description: description.trim() || null,
                    permissionKeys: [...selected],
                  },
                  "Role dibuat",
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ubah role */}
      <Dialog open={editing !== null} onOpenChange={(open) => !busy && !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Ubah {editing?.name}</DialogTitle>
            <DialogDescription>
              {editing?.memberCount ?? 0} akun memakai role ini dan akan terpengaruh.
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Nama</Label>
                <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-description">Deskripsi</Label>
                <Input
                  id="edit-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              {/* Preview dampak: apa yang bertambah dan hilang, sebelum disimpan. */}
              {(() => {
                const { added, removed } = diffFor(editing)
                if (added.length === 0 && removed.length === 0) return null
                return (
                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                    <p className="font-medium">Dampak perubahan</p>
                    {added.length > 0 ? (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">+{added.length} ditambah:</span>{" "}
                        {added.map((key) => labelByKey.get(key) ?? key).join(", ")}
                      </p>
                    ) : null}
                    {removed.length > 0 ? (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-destructive">−{removed.length} dicabut:</span>{" "}
                        {removed.map((key) => labelByKey.get(key) ?? key).join(", ")}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Berlaku bagi {editing.memberCount} akun pemegang role ini.
                    </p>
                  </div>
                )
              })()}

              <PermissionMatrix
                catalog={catalog}
                selected={selected}
                disabled={busy}
                onChange={setSelected}
              />
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy || !name.trim()}
              onClick={() =>
                editing &&
                submit(
                  `/api/rbac/roles/${editing.id}`,
                  "PATCH",
                  {
                    name: name.trim(),
                    description: description.trim() || null,
                    permissionKeys: [...selected],
                    // Wajib: penulisan basi ditolak 409, bukan saling menimpa.
                    expectedVersion: editing.version,
                  },
                  "Role diperbarui",
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hapus role */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Hapus {deleting?.name}</DialogTitle>
            <DialogDescription>
              {deleting && deleting.memberCount > 0
                ? `Role ini masih dipegang ${deleting.memberCount} akun. Lepaskan role dari akun tersebut lebih dahulu.`
                : "Role tanpa anggota dapat dihapus. Tindakan ini tidak dapat dibatalkan."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              variant="destructive"
              disabled={busy || (deleting?.memberCount ?? 0) > 0}
              onClick={() =>
                deleting &&
                submit(
                  `/api/rbac/roles/${deleting.id}`,
                  "DELETE",
                  { expectedVersion: deleting.version },
                  "Role dihapus",
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
