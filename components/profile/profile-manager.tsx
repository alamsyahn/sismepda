"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck, Trash2, Upload, UserRound } from "lucide-react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { PrefixCombobox } from "@/components/guru/prefix-combobox"
import { defaultPrefixOptions, previewName, splitPrefixedName } from "@/lib/guru-input"
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TYPES } from "@/lib/profile"

export type ProfileData = {
  id: string
  name: string
  nip: string | null
  email: string | null
  phone: string | null
  role: "ADMIN" | "GURU"
  photoUrl: string | null
}

type ApiError = { error?: string }

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json() as T & ApiError
  if (!response.ok) throw new Error(data.error || "Permintaan gagal diproses")
  return data
}

export function ProfileManager({ initialProfile }: { initialProfile: ProfileData }) {
  const initialName = splitPrefixedName(initialProfile.name)
  const { update: updateSession } = useSession()
  const [profile, setProfile] = useState(initialProfile)
  const [salutation, setSalutation] = useState(initialName.prefix)
  const [salutationOptions, setSalutationOptions] = useState<string[]>(defaultPrefixOptions)
  const [name, setName] = useState(initialName.name)
  const [nip, setNip] = useState(initialProfile.nip ?? "")
  const [email, setEmail] = useState(initialProfile.email ?? "")
  const [phone, setPhone] = useState(initialProfile.phone ?? "")
  const [currentPassword, setCurrentPassword] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [deletePhotoOpen, setDeletePhotoOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  const identifierChanged =
    nip.trim() !== (profile.nip ?? "") || email.trim().toLowerCase() !== (profile.email ?? "").toLowerCase()
  const initials = name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U"

  function choosePhoto(file: File | null) {
    if (!file) return
    if (!PROFILE_PHOTO_TYPES.includes(file.type as (typeof PROFILE_PHOTO_TYPES)[number])) {
      toast.error("Foto harus berformat JPEG, PNG, atau WebP")
      return
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      toast.error("Ukuran foto maksimal 1 MB")
      return
    }
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function savePhoto() {
    if (!photo) return
    setSavingPhoto(true)
    try {
      const data = new FormData()
      data.set("photo", photo)
      const result = await readResponse<{ photoUrl: string }>(await fetch("/api/profile/photo", { method: "PUT", body: data }))
      setProfile((current) => ({ ...current, photoUrl: result.photoUrl }))
      setPhoto(null)
      setPhotoPreview(null)
      if (fileRef.current) fileRef.current.value = ""
      await updateSession()
      toast.success("Foto profil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto profil gagal disimpan")
    } finally {
      setSavingPhoto(false)
    }
  }

  async function deletePhoto() {
    setSavingPhoto(true)
    try {
      await readResponse(await fetch("/api/profile/photo", { method: "DELETE" }))
      setProfile((current) => ({ ...current, photoUrl: null }))
      setPhoto(null)
      setPhotoPreview(null)
      setDeletePhotoOpen(false)
      if (fileRef.current) fileRef.current.value = ""
      await updateSession()
      toast.success("Foto profil dihapus")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto profil gagal dihapus")
    } finally {
      setSavingPhoto(false)
    }
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error("Nama lengkap wajib diisi")
      return
    }
    if (!nip.trim() && !email.trim()) {
      toast.error("Minimal salah satu NIP atau email wajib diisi")
      return
    }
    const displayName = previewName(salutation, name)
    if (displayName.length > 100) {
      toast.error("Gabungan sapaan dan nama maksimal 100 karakter")
      return
    }
    if (identifierChanged && !currentPassword) {
      toast.error("Masukkan password saat ini untuk mengubah email atau NIP")
      return
    }

    setSavingProfile(true)
    try {
      const updated = await readResponse<ProfileData>(await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: displayName,
          nip: nip.trim(),
          email: email.trim(),
          phone: phone.replace(/[\s-]/g, ""),
          currentPassword: identifierChanged ? currentPassword : undefined,
        }),
      }))
      const updatedName = splitPrefixedName(updated.name)
      setProfile(updated)
      setSalutation(updatedName.prefix)
      setName(updatedName.name)
      setNip(updated.nip ?? "")
      setEmail(updated.email ?? "")
      setPhone(updated.phone ?? "")
      setCurrentPassword("")
      await updateSession()
      toast.success("Profil berhasil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profil gagal diperbarui")
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (newPassword.length < 8) {
      toast.error("Password baru minimal 8 karakter")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Konfirmasi password baru tidak sama")
      return
    }
    setSavingPassword(true)
    try {
      await readResponse(await fetch("/api/profile/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
      }))
      setOldPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setShowPasswords(false)
      toast.success("Password berhasil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Password gagal diperbarui")
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><UserRound className="size-4 text-primary" />Data Diri</CardTitle>
            <CardDescription>NIP dan email dapat digunakan sebagai identitas login.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={saveProfile}>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-salutation">Sapaan</Label>
                  <PrefixCombobox
                    id="profile-salutation"
                    value={salutation}
                    options={salutationOptions}
                    onChange={setSalutation}
                    onAddOption={(value) => setSalutationOptions((current) =>
                      current.some((option) => option.toLowerCase() === value.toLowerCase())
                        ? current
                        : [...current, value]
                    )}
                    placeholder="Pilih atau masukkan sapaan"
                  />
                  <p className="text-xs text-muted-foreground">Opsional, misalnya Bpk., Ibu, atau Dr.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-name">Nama Lengkap</Label>
                  <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-phone">Nomor Telepon</Label>
                  <Input id="profile-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Contoh: 081234567890" />
                  <p className="text-xs text-muted-foreground">Opsional, 7–15 digit.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-nip">NIP</Label>
                  <Input id="profile-nip" value={nip} onChange={(event) => setNip(event.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="username" maxLength={30} />
                  <p className="text-xs text-muted-foreground">Opsional jika email diisi. Hanya angka dan harus unik.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} placeholder="nama@sekolah.sch.id" />
                  <p className="text-xs text-muted-foreground">Opsional jika NIP diisi. Email dapat dipakai untuk login.</p>
                </div>
              </div>

              {identifierChanged ? (
                <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <Label htmlFor="profile-current-password">Password Saat Ini</Label>
                  <Input id="profile-current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required />
                  <p className="text-xs text-muted-foreground">Diperlukan karena email atau NIP Anda berubah.</p>
                </div>
              ) : null}

              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {savingProfile ? "Menyimpan..." : "Simpan Data Diri"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-primary" />Ubah Password</CardTitle>
            <CardDescription>Gunakan minimal 8 karakter dan jangan gunakan kembali password lama.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={savePassword}>
              <div className="grid gap-5 sm:grid-cols-3">
                <PasswordInput id="old-password" label="Password Saat Ini" value={oldPassword} onChange={setOldPassword} visible={showPasswords} autoComplete="current-password" />
                <PasswordInput id="new-password" label="Password Baru" value={newPassword} onChange={setNewPassword} visible={showPasswords} autoComplete="new-password" />
                <PasswordInput id="confirm-password" label="Konfirmasi Password" value={confirmPassword} onChange={setConfirmPassword} visible={showPasswords} autoComplete="new-password" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={savingPassword || !oldPassword || !newPassword || !confirmPassword}>
                  {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {savingPassword ? "Memperbarui..." : "Ubah Password"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowPasswords((current) => !current)}>
                  {showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {showPasswords ? "Sembunyikan" : "Tampilkan"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Foto Profil</CardTitle>
          <CardDescription>JPEG, PNG, atau WebP dengan ukuran maksimal 1 MB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <Avatar className="size-28 text-2xl">
              {photoPreview || profile.photoUrl ? <AvatarImage src={photoPreview ?? profile.photoUrl ?? undefined} alt="Foto profil" /> : null}
              <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">{previewName(salutation, name) || profile.name}</p>
              <Badge variant="secondary" className="mt-1">{profile.role === "ADMIN" ? "Administrator" : "Guru"}</Badge>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)}
          />
          <div className="grid gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={savingPhoto}>
              <Upload className="size-4" />Pilih Foto
            </Button>
            {photo ? (
              <Button type="button" onClick={savePhoto} disabled={savingPhoto}>
                {savingPhoto ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {savingPhoto ? "Mengunggah..." : "Simpan Foto"}
              </Button>
            ) : null}
            {profile.photoUrl && !photo ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeletePhotoOpen(true)} disabled={savingPhoto}>
                {savingPhoto ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Hapus Foto
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      </div>

      <Dialog open={deletePhotoOpen} onOpenChange={(open) => !savingPhoto && setDeletePhotoOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus foto profil?</DialogTitle>
            <DialogDescription>Foto profil Anda akan dihapus dari database. Anda dapat mengunggah foto baru kapan saja.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={savingPhoto} />}>Batal</DialogClose>
            <Button type="button" variant="destructive" onClick={deletePhoto} disabled={savingPhoto}>
              {savingPhoto ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {savingPhoto ? "Menghapus..." : "Ya, Hapus Foto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  visible,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  autoComplete: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} maxLength={128} required />
    </div>
  )
}
