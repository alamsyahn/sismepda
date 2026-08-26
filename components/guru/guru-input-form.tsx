"use client"

import { useEffect, useRef, useState } from "react"
import {
  Loader2,
  Save,
  UserPlus,
  CircleCheckBig,
  CircleAlert,
  Eye,
  EyeOff,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { cn } from "@/lib/utils"
import {
  defaultPrefixOptions,
  normalizePhone,
  previewName,
  sanitizeNip,
  validateGuru,
  type RegisteredGuruIdentifiers,
  type GuruErrors,
} from "@/lib/guru-input"

export function GuruInputForm() {
  const [registered, setRegistered] = useState<RegisteredGuruIdentifiers>({ nip: {}, email: {} })
  useEffect(() => {
    fetch("/api/admin/teachers").then((response) => response.json()).then((teachers) => setRegistered({
      nip: Object.fromEntries(teachers.filter((teacher: { nip: string | null }) => teacher.nip).map((teacher: { nip: string; name: string }) => [teacher.nip, teacher.name])),
      email: Object.fromEntries(teachers.filter((teacher: { email: string | null }) => teacher.email).map((teacher: { email: string; name: string }) => [teacher.email.toLowerCase(), teacher.name])),
    }))
  }, [])
  const [nip, setNip] = useState("")
  const [email, setEmail] = useState("")
  const [prefix, setPrefix] = useState("")
  const [prefixOptions, setPrefixOptions] = useState<string[]>(defaultPrefixOptions)
  const [nama, setNama] = useState("")
  const [telepon, setTelepon] = useState("")
  const [password, setPassword] = useState("")
  const [konfirmasi, setKonfirmasi] = useState("")

  const [showPassword, setShowPassword] = useState(false)
  const [showKonfirmasi, setShowKonfirmasi] = useState(false)

  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<GuruErrors>({})
  const [saving, setSaving] = useState<"single" | "again" | null>(null)
  const [pendingMode, setPendingMode] = useState<"single" | "again" | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successName, setSuccessName] = useState<string | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{ label: "NIP" | "Email"; value: string; nama: string } | null>(null)

  const nipRef = useRef<HTMLInputElement>(null)

  const values = { nip, email, nama, telepon, password, konfirmasi }
  const liveErrors = touched ? validateGuru(values, registered) : {}

  const nipError = touched ? errors.nip ?? liveErrors.nip : undefined
  const emailError = touched ? errors.email ?? liveErrors.email : undefined
  const namaError = touched ? errors.nama ?? liveErrors.nama : undefined
  const teleponError = touched ? errors.telepon ?? liveErrors.telepon : undefined
  const passwordError = touched ? errors.password ?? liveErrors.password : undefined
  const konfirmasiError = touched ? errors.konfirmasi ?? liveErrors.konfirmasi : undefined

  const preview = previewName(prefix, nama)

  function attemptSave(mode: "single" | "again") {
    setTouched(true)
    const validation = validateGuru(values, registered)
    setErrors(validation)

    if (validation.nip === "NIP sudah terdaftar") {
      setDuplicateInfo({ label: "NIP", value: nip.trim(), nama: registered.nip[nip.trim()] ?? "guru lain" })
      return
    }
    if (validation.email === "Email sudah terdaftar") {
      const normalizedEmail = email.trim().toLowerCase()
      setDuplicateInfo({ label: "Email", value: normalizedEmail, nama: registered.email[normalizedEmail] ?? "guru lain" })
      return
    }

    if (Object.keys(validation).length > 0) return

    // Simpan lewat dialog konfirmasi terlebih dahulu.
    setPendingMode(mode)
    setConfirmOpen(true)
  }

  async function performSave() {
    const mode = pendingMode ?? "single"
    setConfirmOpen(false)
    setSaving(mode)

    try {
      const finalName = previewName(prefix, nama)
      const response = await fetch("/api/admin/teachers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nip: nip.trim(), email: email.trim(), name: finalName, phone: normalizePhone(telepon), password }) })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? "Data guru gagal disimpan")
      }
      setSaving(null)
      setPendingMode(null)

      if (mode === "single") {
        setSuccessName(finalName)
      } else {
        // Simpan & Tambah Lagi: kosongkan seluruh form, fokus ke NIP.
        resetForm()
        toast.success("Guru berhasil ditambahkan", { description: finalName })
        window.setTimeout(() => nipRef.current?.focus(), 30)
      }
    } catch (error) { setSaving(null); toast.error(error instanceof Error ? error.message : "Data guru gagal disimpan") }
  }

  function resetForm() {
    setNip("")
    setEmail("")
    setPrefix("")
    setNama("")
    setTelepon("")
    setPassword("")
    setKonfirmasi("")
    setShowPassword(false)
    setShowKonfirmasi(false)
    setTouched(false)
    setErrors({})
  }

  return (
    <>
      <Card className="max-w-3xl border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            Data Guru Baru
          </CardTitle>
          <CardDescription>
            Lengkapi data berikut untuk menambahkan akun dan data guru ke sistem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              attemptSave("single")
            }}
          >
            {/* Identitas login */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nip">
                  NIP
                </Label>
                <Input
                  id="nip"
                  ref={nipRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Masukkan NIP guru"
                  value={nip}
                  onChange={(e) => setNip(sanitizeNip(e.target.value))}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(nipError)}
                  aria-describedby="nip-help"
                />
                <p
                  id="nip-help"
                  className={cn("text-xs", nipError ? "text-destructive" : "text-muted-foreground")}
                >
                  {nipError ?? "Opsional jika email diisi. Hanya angka dan harus unik."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nama@sekolah.sch.id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(emailError)}
                />
                <p className={cn("text-xs", emailError ? "text-destructive" : "text-muted-foreground")}>
                  {emailError ?? "Opsional jika NIP diisi. Email harus unik."}
                </p>
              </div>
            </div>

            {/* Sapaan, nama & telepon */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prefix">Prefix / Sapaan</Label>
                <PrefixCombobox
                  id="prefix"
                  value={prefix}
                  options={prefixOptions}
                  onChange={setPrefix}
                  onAddOption={(v) =>
                    setPrefixOptions((prev) =>
                      prev.some((o) => o.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v],
                    )
                  }
                  placeholder="Pilih atau masukkan prefix"
                />
                <p className="text-xs text-muted-foreground">Opsional. Bisa memilih atau menambah baru.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nama">
                  Nama Lengkap <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nama"
                  type="text"
                  autoComplete="off"
                  placeholder="Masukkan nama lengkap guru"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(namaError)}
                />
                {namaError ? (
                  <p className="text-xs text-destructive">{namaError}</p>
                ) : preview ? (
                  <p className="text-xs text-muted-foreground">
                    Pratinjau: <span className="font-medium text-foreground">{preview}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Nama ditampilkan sesuai penulisan Anda.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="telepon">
                  Nomor Telepon
                </Label>
                <Input
                  id="telepon"
                  type="text"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="Contoh: 081234567890"
                  value={telepon}
                  onChange={(e) => setTelepon(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(teleponError)}
                />
                {teleponError ? (
                  <p className="text-xs text-destructive">{teleponError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Opsional. Format Indonesia, mis. 081234567890 atau +6281234567890.
                  </p>
                )}
              </div>
            </div>

            {/* Password & Konfirmasi */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  Password <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Masukkan password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={Boolean(passwordError)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className={cn("text-xs", passwordError ? "text-destructive" : "text-muted-foreground")}>
                  {passwordError ?? "Gunakan minimal 8 karakter."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="konfirmasi">
                  Konfirmasi Password <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="konfirmasi"
                    type={showKonfirmasi ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Masukkan ulang password"
                    value={konfirmasi}
                    onChange={(e) => setKonfirmasi(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={Boolean(konfirmasiError)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKonfirmasi((s) => !s)}
                    aria-label={showKonfirmasi ? "Sembunyikan password" : "Tampilkan password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showKonfirmasi ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {konfirmasiError ? (
                  <p className="text-xs text-destructive">{konfirmasiError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Ulangi password yang sama.</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button type="submit" disabled={saving !== null}>
                {saving === "single" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {saving === "single" ? "Menyimpan..." : "Simpan Guru"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving !== null}
                onClick={() => attemptSave("again")}
              >
                {saving === "again" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                {saving === "again" ? "Menyimpan..." : "Simpan & Tambah Lagi"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Dialog konfirmasi simpan */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simpan data guru?</DialogTitle>
            <DialogDescription>Pastikan data dan password guru sudah sesuai.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-sm">
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">NIP</dt>
                <dd className="font-medium tabular-nums">{nip || "-"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{email.trim() || "-"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Nama</dt>
                <dd className="font-medium text-right">{previewName(prefix, nama)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Telepon</dt>
                <dd className="font-medium tabular-nums">{normalizePhone(telepon) || "-"}</dd>
              </div>
            </dl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Batal
            </Button>
            <Button onClick={performSave}>Ya, Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog sukses */}
      <Dialog open={Boolean(successName)} onOpenChange={(o) => !o && setSuccessName(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <CircleCheckBig className="size-7" />
            </span>
            <DialogTitle className="text-lg">Data guru berhasil disimpan</DialogTitle>
            <DialogDescription>
              {successName ? `${successName} berhasil ditambahkan ke dalam sistem.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              className="w-full sm:w-auto sm:min-w-32"
              onClick={() => {
                resetForm()
                setSuccessName(null)
              }}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog NIP duplikat */}
      <Dialog open={Boolean(duplicateInfo)} onOpenChange={(o) => !o && setDuplicateInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleAlert className="size-5 text-[var(--chart-4)]" />
              {duplicateInfo?.label} sudah terdaftar
            </DialogTitle>
            <DialogDescription>
              {duplicateInfo
                ? `${duplicateInfo.label} ${duplicateInfo.value} sudah digunakan oleh ${duplicateInfo.nama}. Data tidak disimpan.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button />}>Kembali</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
