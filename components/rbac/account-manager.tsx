"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, ShieldAlert, Trash2, UserCog } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Switch } from "@/components/ui/switch"
import type { AccountRow, RoleRow } from "@/lib/server-rbac-admin"

/**
 * Administrasi akun: penugasan role, status aktif, reset sandi, penghapusan.
 *
 * Kontrol dinonaktifkan hanya sebagai umpan balik. Setiap penolakan sebenarnya
 * — target istimewa, admin terakhir, hapus diri sendiri — ditegakkan server;
 * menyembunyikan tombol bukan otorisasi.
 */
export function AccountManager({
  accounts,
  roles,
  viewerId,
  canAssign,
  canManageCredentials,
  canManageStatus,
  canDelete,
}: {
  accounts: AccountRow[]
  roles: RoleRow[]
  viewerId: string
  canAssign: boolean
  canManageCredentials: boolean
  canManageStatus: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [assigning, setAssigning] = useState<AccountRow | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [resetting, setResetting] = useState<AccountRow | null>(null)
  const [password, setPassword] = useState("")
  const [deleting, setDeleting] = useState<AccountRow | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)

  const term = query.trim().toLowerCase()
  const visible = term
    ? accounts.filter((account) =>
        [account.name, account.nip ?? "", account.email ?? ""].some((field) =>
          field.toLowerCase().includes(term),
        ),
      )
    : accounts

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
      return
    }

    toast.success(success)
    setAssigning(null)
    setResetting(null)
    setDeleting(null)
    setPassword("")
    setConfirmation("")
    router.refresh()
  }

  function openAssign(account: AccountRow) {
    setAssigning(account)
    setSelectedRoles(new Set(account.roles.map((role) => role.id)))
  }

  /** Mencabut bypass dari diri sendiri menuntut konfirmasi eksplisit. */
  const selfRevokingSystemAdmin =
    assigning !== null &&
    assigning.id === viewerId &&
    assigning.roles.some((role) => role.isSystemAdmin) &&
    !roles.some((role) => role.isSystemAdmin && selectedRoles.has(role.id))

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Akun</CardTitle>
          <CardDescription>
            Role akun tidak terikat identitas guru. Menonaktifkan bersifat sementara; menghapus
            tidak dapat dibatalkan.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <Input
            placeholder="Cari nama, NIP, atau email..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {visible.map((account) => (
            <div
              key={account.id}
              className="flex flex-col gap-3 rounded-lg border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{account.name}</span>
                  {account.id === viewerId ? <Badge variant="outline">Anda</Badge> : null}
                  {account.active ? null : <Badge variant="secondary">Nonaktif</Badge>}
                  {account.roles.some((role) => role.isSystemAdmin) ? (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="size-3" />
                      Admin Sistem
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {account.nip ?? "Tanpa NIP"} · {account.email ?? "Tanpa email"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {account.roles.length > 0
                    ? account.roles.map((role) => role.name).join(", ")
                    : "Tanpa role"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openAssign(account)} disabled={!canAssign}>
                  <UserCog className="size-4" />
                  Role
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetting(account)}
                  disabled={!canManageCredentials}
                >
                  <KeyRound className="size-4" />
                  Sandi
                </Button>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={account.active}
                    // Server juga menolak; ini hanya mencegah klik yang pasti gagal.
                    disabled={!canManageStatus || account.id === viewerId || busy}
                    onCheckedChange={(checked) =>
                      submit(
                        `/api/rbac/accounts/${account.id}`,
                        "PATCH",
                        { active: checked },
                        checked ? "Akun diaktifkan" : "Akun dinonaktifkan",
                      )
                    }
                  />
                  <Label className="text-xs text-muted-foreground">Aktif</Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleting(account)
                    setConfirmation("")
                  }}
                  disabled={!canDelete || account.id === viewerId}
                >
                  <Trash2 className="size-4" />
                  Hapus
                </Button>
              </div>
            </div>
          ))}

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada akun cocok.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Penugasan role */}
      <Dialog open={assigning !== null} onOpenChange={(open) => !busy && !open && setAssigning(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Role untuk {assigning?.name}</DialogTitle>
            <DialogDescription>
              Role menentukan kewenangan akun ini. Identitas guru tidak ikut berubah.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {roles.map((role) => (
              <label
                key={role.id}
                className="flex items-start gap-2 rounded-md border border-border/70 p-2 text-sm"
              >
                <Checkbox
                  checked={selectedRoles.has(role.id)}
                  disabled={busy}
                  onCheckedChange={() => {
                    const next = new Set(selectedRoles)
                    if (next.has(role.id)) next.delete(role.id)
                    else next.add(role.id)
                    setSelectedRoles(next)
                  }}
                />
                <span className="space-y-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{role.name}</span>
                    {role.isSystemAdmin ? (
                      <Badge variant="destructive" className="text-[10px]">
                        Bypass penuh
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {role.description ?? "Tanpa deskripsi"}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {selfRevokingSystemAdmin ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Anda akan mencabut Admin Sistem dari akun Anda sendiri. Tindakan ini hanya berhasil
              bila masih ada Admin Sistem aktif lain.
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy}
              onClick={() =>
                assigning &&
                submit(
                  `/api/rbac/users/${assigning.id}/roles`,
                  "PUT",
                  {
                    roleIds: [...selectedRoles],
                    // Dihitung server saat halaman dibaca; menolak penulisan basi.
                    expectedRevision: assigning.revision,
                    ...(selfRevokingSystemAdmin ? { confirmSelfRevoke: true } : {}),
                  },
                  "Role akun diperbarui",
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset sandi */}
      <Dialog open={resetting !== null} onOpenChange={(open) => !busy && !open && setResetting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset sandi {resetting?.name}</DialogTitle>
            <DialogDescription>
              Sandi baru langsung berlaku. Sampaikan lewat jalur tepercaya, bukan pesan terbuka.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">Sandi baru</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy || password.length < 8}
              onClick={() =>
                resetting &&
                submit(`/api/rbac/accounts/${resetting.id}`, "PATCH", { password }, "Sandi direset")
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hapus akun */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Hapus {deleting?.name}</DialogTitle>
            <DialogDescription>
              Tindakan ini permanen. Riwayat absensi yang dikirim akun ini dialihkan ke Anda. Bila
              akun ini pernah mencatat poin pelanggaran siswa, penghapusan akan ditolak.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="delete-confirmation">
              Ketik {deleting?.nip ?? deleting?.email} untuk konfirmasi
            </Label>
            <Input
              id="delete-confirmation"
              autoComplete="off"
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              variant="destructive"
              disabled={busy || confirmation.trim().length === 0}
              onClick={() =>
                deleting &&
                submit(
                  `/api/rbac/accounts/${deleting.id}`,
                  "DELETE",
                  { confirmationIdentifier: confirmation.trim() },
                  "Akun dihapus",
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Hapus permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
