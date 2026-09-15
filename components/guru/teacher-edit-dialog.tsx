"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Save, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PrefixCombobox } from "@/components/guru/prefix-combobox"
import {
  cleanName,
  defaultPrefixOptions,
  isValidEmail,
  isValidPhone,
  normalizePhone,
  previewName,
  splitPrefixedName,
} from "@/lib/guru-input"
import { PROFILE_PHOTO_TYPES } from "@/lib/profile"
import { describeOversizeFile, describeUploadPolicy, useUploadPolicy } from "@/lib/use-upload-policy"

/**
 * Editor tunggal data master guru.
 *
 * Satu dialog ini adalah tempat utama mengelola profil guru: identitas
 * (termasuk sapaan), kontak, kepegawaian, dan foto. Sebelumnya sapaan hanya
 * bisa diubah guru sendiri lewat halaman Profil dan foto sama sekali tidak
 * punya jalur admin — pemisahan itu bukan keputusan arsitektur, hanya sisa
 * pertumbuhan layar.
 *
 * Yang TETAP di luar dialog ini: role, permission, status aktif, dan
 * penghapusan akun. Itu wilayah administrasi akun/RBAC, dan mencampurnya ke
 * form profil akan membuat satu tombol "Simpan" diam-diam menyentuh
 * otorisasi.
 */

export type TeacherRecord = {
  id: string
  nip: string | null
  email: string | null
  name: string
  phone: string | null
  active: boolean
  photoUrl: string | null
  employmentStatus: string | null
  position: string | null
  teachingSince: string | null
  belajarId: string | null
  subjects: string[]
  homeroomClass: { name: string } | null
}

const positions = [
  "Kepala Sekolah",
  "Wakil Kepala Sekolah",
  "Wakil Kurikulum",
  "Wakil Kesiswaan",
  "Guru",
  "Guru BK",
  "Kepala Tata Usaha",
]

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((part) => /[a-zA-Z]/.test(part[0] ?? ""))
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "G"
  )
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error ?? fallback)
  return data as T
}

export function TeacherEditDialog({
  teacher,
  canUpdateIdentity,
  canUpdateProfile,
  canResetPassword,
  onClose,
  onSaved,
}: {
  teacher: TeacherRecord | null
  canUpdateIdentity: boolean
  canUpdateProfile: boolean
  canResetPassword: boolean
  onClose: () => void
  onSaved: (teacher: TeacherRecord) => void
}) {
  const uploadPolicy = useUploadPolicy("teachers.master.photo")
  const fileRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [prefixOptions, setPrefixOptions] = useState<string[]>(defaultPrefixOptions)

  const [salutation, setSalutation] = useState("")
  const [name, setName] = useState("")
  const [nip, setNip] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [employmentStatus, setEmploymentStatus] = useState("none")
  const [position, setPosition] = useState("")
  const [teachingSince, setTeachingSince] = useState("")
  const [belajarId, setBelajarId] = useState("")
  const [subjects, setSubjects] = useState("")

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  // Dialog dimuat ulang setiap kali guru berubah supaya nilai tersimpan tidak
  // bocor dari baris sebelumnya.
  useEffect(() => {
    if (!teacher) return
    const split = splitPrefixedName(teacher.name)
    setSalutation(split.prefix)
    setName(split.name)
    setPrefixOptions((current) =>
      split.prefix && !current.includes(split.prefix) ? [...current, split.prefix] : current,
    )
    setNip(teacher.nip ?? "")
    setEmail(teacher.email ?? "")
    setPhone(teacher.phone ?? "")
    setPassword("")
    setEmploymentStatus(teacher.employmentStatus ?? "none")
    setPosition(teacher.position ?? "")
    setTeachingSince(teacher.teachingSince ?? "")
    setBelajarId(teacher.belajarId ?? "")
    setSubjects(teacher.subjects.join(", "))
    setPhotoUrl(teacher.photoUrl)
    setPhoto(null)
    setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ""
  }, [teacher])

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  function choosePhoto(file: File | null) {
    if (!file) return
    // Pemeriksaan tipe di sini murni UX; server menentukan tipe dari isi berkas.
    if (!PROFILE_PHOTO_TYPES.includes(file.type as (typeof PROFILE_PHOTO_TYPES)[number])) {
      toast.error("Format foto harus JPG, PNG, atau WebP")
      return
    }
    const oversize = describeOversizeFile(file, uploadPolicy)
    if (oversize) {
      toast.error(oversize)
      return
    }
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function cancelPhoto() {
    setPhoto(null)
    setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function savePhoto() {
    if (!teacher || !photo) return
    setSavingPhoto(true)
    try {
      const data = new FormData()
      data.set("photo", photo)
      const result = await readResponse<{ photoUrl: string }>(
        await fetch(`/api/teachers/${teacher.id}/photo`, { method: "PUT", body: data }),
        "Foto guru gagal disimpan",
      )
      setPhotoUrl(result.photoUrl)
      cancelPhoto()
      onSaved({ ...teacher, photoUrl: result.photoUrl })
      toast.success("Foto guru diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto guru gagal disimpan")
    } finally {
      setSavingPhoto(false)
    }
  }

  async function deletePhoto() {
    if (!teacher) return
    setSavingPhoto(true)
    try {
      await readResponse(
        await fetch(`/api/teachers/${teacher.id}/photo`, { method: "DELETE" }),
        "Foto guru gagal dihapus",
      )
      setPhotoUrl(null)
      cancelPhoto()
      onSaved({ ...teacher, photoUrl: null })
      toast.success("Foto guru dihapus")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto guru gagal dihapus")
    } finally {
      setSavingPhoto(false)
    }
  }

  async function save() {
    if (!teacher) return
    const trimmedNip = nip.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const normalizedPhone = normalizePhone(phone.trim())
    const fullName = previewName(salutation, name)

    if (canUpdateIdentity) {
      if (!cleanName(name) || (!trimmedNip && !trimmedEmail)) {
        toast.error("Nama lengkap dan minimal salah satu NIP atau email wajib diisi")
        return
      }
      if ((trimmedNip && !/^\d+$/.test(trimmedNip)) || (trimmedEmail && !isValidEmail(trimmedEmail))) {
        toast.error("Format NIP atau email tidak valid")
        return
      }
      if (normalizedPhone && !isValidPhone(normalizedPhone)) {
        toast.error("Format nomor telepon tidak valid")
        return
      }
    }
    if (password && password.length < 8) {
      toast.error("Password baru minimal 8 karakter")
      return
    }

    setSaving(true)
    try {
      if (password) {
        await readResponse(
          await fetch(`/api/rbac/accounts/${teacher.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          }),
          "Password guru gagal diperbarui",
        )
      }

      let next: TeacherRecord = { ...teacher, photoUrl }

      if (canUpdateIdentity) {
        const updated = await readResponse<TeacherRecord>(
          await fetch("/api/admin/teachers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: teacher.id,
              nip: trimmedNip,
              email: trimmedEmail,
              name: fullName,
              phone: normalizedPhone,
            }),
          }),
          "Data guru gagal diperbarui",
        )
        next = { ...next, ...updated }
      }

      if (canUpdateProfile) {
        await readResponse(
          await fetch(`/api/teachers/${teacher.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employmentStatus: employmentStatus === "none" ? null : employmentStatus,
              position,
              teachingSince,
              belajarId,
              subjectNames: subjects.split(",").map((item) => item.trim()).filter(Boolean),
            }),
          }),
          "Data kepegawaian gagal disimpan",
        )
        next = {
          ...next,
          employmentStatus: employmentStatus === "none" ? null : employmentStatus,
          position: position.trim() || null,
          teachingSince: teachingSince || null,
          belajarId: belajarId.trim() || null,
          subjects: subjects.split(",").map((item) => item.trim()).filter(Boolean).sort(),
        }
      }

      onSaved(next)
      onClose()
      toast.success("Data guru berhasil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Data guru gagal diperbarui")
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || savingPhoto

  return (
    <Dialog open={Boolean(teacher)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit data guru</DialogTitle>
          <DialogDescription>
            Profil lengkap guru: foto, identitas, kontak, dan kepegawaian. Role, permission, serta status akun
            dikelola terpisah di Administrasi Akun.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Foto Profil</h3>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar className="size-20 self-center text-xl sm:self-auto">
                {photoPreview || photoUrl ? (
                  <AvatarImage src={photoPreview ?? photoUrl ?? undefined} alt="Foto guru" />
                ) : null}
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                  {initialsOf(name || teacher?.name || "")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <p className="text-xs text-muted-foreground">{describeUploadPolicy(uploadPolicy)}</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canUpdateProfile || busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="size-4" />
                    {photoUrl ? "Ganti Foto" : "Pilih Foto"}
                  </Button>
                  {photo ? (
                    <>
                      <Button type="button" size="sm" disabled={busy} onClick={savePhoto}>
                        {savingPhoto ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {savingPhoto ? "Mengunggah..." : "Simpan Foto"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancelPhoto}>
                        Batalkan Foto
                      </Button>
                    </>
                  ) : null}
                  {photoUrl && !photo ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={!canUpdateProfile || busy}
                      onClick={deletePhoto}
                    >
                      <Trash2 className="size-4" />
                      Hapus Foto
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Identitas</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="teacher-salutation">Sapaan</Label>
                <PrefixCombobox
                  id="teacher-salutation"
                  value={salutation}
                  options={prefixOptions}
                  onChange={setSalutation}
                  onAddOption={(value) => setPrefixOptions((current) => [...current, value])}
                  placeholder="Pilih atau masukkan sapaan"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-name">Nama lengkap</Label>
                <Input
                  id="teacher-name"
                  disabled={!canUpdateIdentity}
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-nip">NIP (opsional jika email diisi)</Label>
                <Input
                  id="teacher-nip"
                  disabled={!canUpdateIdentity}
                  inputMode="numeric"
                  value={nip}
                  onChange={(event) => setNip(event.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-email">Email (opsional jika NIP diisi)</Label>
                <Input
                  id="teacher-email"
                  disabled={!canUpdateIdentity}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Nama tersimpan: {previewName(salutation, name) || "-"}</p>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Informasi Kontak</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="teacher-phone">Nomor telepon</Label>
                <Input
                  id="teacher-phone"
                  disabled={!canUpdateIdentity}
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Contoh: 081234567890"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-belajar">Akun belajar.id</Label>
                <Input
                  id="teacher-belajar"
                  disabled={!canUpdateProfile}
                  value={belajarId}
                  onChange={(event) => setBelajarId(event.target.value)}
                  placeholder="nama@guru.smp.belajar.id"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Informasi Kepegawaian</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="teacher-employment-status">Status kepegawaian</Label>
                <Select
                  value={employmentStatus}
                  onValueChange={(value) => value && setEmploymentStatus(value)}
                  disabled={!canUpdateProfile}
                >
                  <SelectTrigger id="teacher-employment-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Belum ditentukan</SelectItem>
                    <SelectItem value="PNS">PNS</SelectItem>
                    <SelectItem value="PPPK">PPPK</SelectItem>
                    <SelectItem value="HONORER">Honorer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-position">Jabatan</Label>
                <Input
                  id="teacher-position"
                  disabled={!canUpdateProfile}
                  list="teacher-position-options"
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  placeholder="Guru"
                />
                <datalist id="teacher-position-options">
                  {positions.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-tmt">TMT mengajar</Label>
                <Input
                  id="teacher-tmt"
                  disabled={!canUpdateProfile}
                  type="date"
                  value={teachingSince}
                  onChange={(event) => setTeachingSince(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-subjects">Mata pelajaran diampu</Label>
                <Input
                  id="teacher-subjects"
                  disabled={!canUpdateProfile}
                  value={subjects}
                  onChange={(event) => setSubjects(event.target.value)}
                  placeholder="Matematika, Informatika"
                />
                <p className="text-xs text-muted-foreground">Pisahkan dengan koma untuk lebih dari satu mapel.</p>
              </div>
            </div>
          </section>

          {canResetPassword ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Kredensial</h3>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-password">Password baru (opsional)</Label>
                <Input
                  id="teacher-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimal 8 karakter"
                />
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
          <Button onClick={save} disabled={busy}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
