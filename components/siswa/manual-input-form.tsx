"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Save, UserPlus, CircleCheckBig, CircleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  buildRegisteredStudentIdentifiers,
  validateManual,
  type ManualErrors,
  type RegisteredStudentIdentifiers,
} from "@/lib/student-input"

type SavedInfo = { nama: string; kelas: string }

export function ManualInputForm() {
  const [nis, setNis] = useState("")
  const [nisn, setNisn] = useState("")
  const [nama, setNama] = useState("")
  const [kelas, setKelas] = useState("")
  const [classOptions, setClassOptions] = useState<string[]>([])
  const [registered, setRegistered] = useState<RegisteredStudentIdentifiers>({ nis: {}, nisn: {} })

  useEffect(() => { fetch("/api/admin/students").then((response) => response.json()).then((data) => { setClassOptions(data.classes); setRegistered(buildRegisteredStudentIdentifiers(data.students)) }) }, [])

  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<ManualErrors>({})
  const [saving, setSaving] = useState<"single" | "again" | null>(null)

  const [successInfo, setSuccessInfo] = useState<SavedInfo | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{ label: "NIS" | "NISN"; value: string; nama: string } | null>(null)
  const [saveError, setSaveError] = useState(false)

  const nisRef = useRef<HTMLInputElement>(null)

  const liveErrors = touched ? validateManual({ nis, nisn, nama, kelas }, classOptions, registered) : {}

  function handleNisChange(value: string) {
    setNis(value.replace(/\D/g, "").slice(0, 30))
  }

  function handleNisnChange(value: string) {
    // Hanya angka, maksimal 10 digit, disimpan sebagai string (nol depan dipertahankan)
    const digits = value.replace(/\D/g, "").slice(0, 10)
    setNisn(digits)
  }

  async function runSave(mode: "single" | "again") {
    setTouched(true)
    const validation = validateManual({ nis, nisn, nama, kelas }, classOptions, registered)
    setErrors(validation)

    if (validation.nis === "NIS sudah terdaftar pada siswa lain") {
      setDuplicateInfo({ label: "NIS", value: nis, nama: registered.nis[nis]?.name ?? "siswa lain" })
      return
    }

    if (validation.nisn === "NISN sudah terdaftar pada siswa lain") {
      setDuplicateInfo({ label: "NISN", value: nisn, nama: registered.nisn[nisn]?.name ?? "siswa lain" })
      return
    }

    if (Object.keys(validation).length > 0) return

    setSaving(mode)
    setSaveError(false)

    try {
      const response = await fetch("/api/admin/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nis, nisn, name: nama.trim(), className: kelas }) })
      if (!response.ok) {
        if (response.status === 409) setDuplicateInfo({ label: nis ? "NIS" : "NISN", value: nis || nisn, nama: "siswa lain" })
        throw new Error("Gagal menyimpan")
      }
        const cleanNama = nama.trim()
        setSaving(null)

        if (mode === "single") {
          setSuccessInfo({ nama: cleanNama, kelas })
        } else {
          // Pertahankan kelas agar input siswa berikutnya lebih cepat.
          setNis("")
          setNisn("")
          setNama("")
          setTouched(false)
          setErrors({})
          toast.success("Siswa berhasil ditambahkan", {
            description: `${cleanNama} • ${kelas}`,
          })
          window.setTimeout(() => nisRef.current?.focus(), 30)
        }
      } catch {
        setSaving(null)
        setSaveError(true)
      }
  }

  const nisError = touched ? liveErrors.nis : errors.nis
  const nisnError = touched ? liveErrors.nisn : errors.nisn
  const namaError = touched ? liveErrors.nama : errors.nama
  const kelasError = touched ? liveErrors.kelas : errors.kelas

  return (
    <>
      <Card className="max-w-2xl border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            Data Siswa Baru
          </CardTitle>
          <CardDescription>
            Lengkapi data berikut untuk menambahkan satu siswa ke sistem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              runSave("single")
            }}
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* NIS */}
              <div className="space-y-1.5">
                <Label htmlFor="nis">NIS</Label>
                <Input
                  id="nis"
                  ref={nisRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Masukkan NIS siswa"
                  value={nis}
                  onChange={(e) => handleNisChange(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(nisError)}
                  aria-describedby="nis-help"
                />
                <p id="nis-help" className={cn("text-xs", nisError ? "text-destructive" : "text-muted-foreground")}>
                  {nisError ?? "Wajib bila NISN tidak diisi; hanya angka."}
                </p>
              </div>

              {/* NISN */}
              <div className="space-y-1.5">
                <Label htmlFor="nisn">NISN</Label>
                <Input
                  id="nisn"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Masukkan 10 digit NISN"
                  value={nisn}
                  onChange={(e) => handleNisnChange(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(nisnError)}
                  aria-describedby="nisn-help"
                />
                <p
                  id="nisn-help"
                  className={cn(
                    "text-xs",
                    nisnError ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {nisnError ?? "Wajib bila NIS tidak diisi; harus 10 digit."}
                </p>
              </div>

              {/* Nama lengkap */}
              <div className="space-y-1.5">
                <Label htmlFor="nama">
                  Nama Lengkap <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nama"
                  type="text"
                  autoComplete="off"
                  placeholder="Masukkan nama lengkap siswa"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(namaError)}
                />
                {namaError ? (
                  <p className="text-xs text-destructive">{namaError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nama akan ditampilkan sesuai penulisan Anda.
                  </p>
                )}
              </div>
            </div>

            {/* Kelas */}
            <div className="space-y-1.5 md:max-w-[calc(50%-0.625rem)]">
              <Label htmlFor="kelas">
                Kelas <span className="text-destructive">*</span>
              </Label>
              <Select
                value={kelas}
                onValueChange={(v) => {
                  if (!v) return
                  setKelas(v)
                  setErrors((prev) => ({ ...prev, kelas: undefined }))
                }}
              >
                <SelectTrigger id="kelas" className="w-full bg-card" aria-invalid={Boolean(kelasError)}>
                  <SelectValue placeholder="Pilih kelas" />
                </SelectTrigger>
                <SelectContent>
                  {classOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kelasError ? <p className="text-xs text-destructive">{kelasError}</p> : null}
            </div>

            {saveError ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-2">
                  <p>Data siswa gagal disimpan. Silakan coba kembali.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => runSave("single")}
                  >
                    Coba Lagi
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button type="submit" disabled={saving !== null}>
                {saving === "single" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {saving === "single" ? "Menyimpan..." : "Simpan Siswa"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving !== null}
                onClick={() => runSave("again")}
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

      {/* Dialog sukses */}
      <Dialog open={Boolean(successInfo)} onOpenChange={(o) => !o && setSuccessInfo(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <CircleCheckBig className="size-7" />
            </span>
            <DialogTitle className="text-lg">Data siswa berhasil disimpan</DialogTitle>
            <DialogDescription>
              {successInfo
                ? `${successInfo.nama} berhasil ditambahkan ke kelas ${successInfo.kelas}.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              className="w-full sm:w-auto sm:min-w-32"
              onClick={() => {
                // Kosongkan seluruh field setelah OK agar siap input berikutnya
                setNis("")
                setNisn("")
                setNama("")
                setKelas("")
                setTouched(false)
                setErrors({})
                setSuccessInfo(null)
              }}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog identitas duplikat */}
      <Dialog open={Boolean(duplicateInfo)} onOpenChange={(o) => !o && setDuplicateInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleAlert className="size-5 text-[var(--chart-4)]" />
              {duplicateInfo?.label ?? "Identitas"} sudah terdaftar
            </DialogTitle>
            <DialogDescription>
              {duplicateInfo
                ? `${duplicateInfo.label} ${duplicateInfo.value} sudah digunakan oleh siswa ${duplicateInfo.nama}. Data tidak disimpan.`
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
