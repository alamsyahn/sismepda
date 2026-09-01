"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, ImageIcon, Loader2, Save, Upload } from "lucide-react"
import Image from "next/image"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { HolidayManager } from "@/components/settings/holiday-manager"
import { DatabaseBackupCard } from "@/components/settings/database-backup"
import { StatusColorSettings } from "@/components/settings/status-color-settings"
import { AppBrandingSettings } from "@/components/settings/app-branding-settings"
import {
  DEFAULT_APP_FULL_NAME,
  DEFAULT_APP_LOGO_URL,
  DEFAULT_APP_NAME,
  FAVICON_ACCEPT,
  MAX_FAVICON_BYTES,
} from "@/lib/site-branding"
import { DEFAULT_STATUS_COLORS, parseStatusColors, type AttendanceStatusColors } from "@/lib/attendance-status-colors"

export default function PengaturanPage() {
  const [websiteTitle, setWebsiteTitle] = useState("SISMEPDA — Dashboard Absensi Sekolah")
  const [notifReminder, setNotifReminder] = useState(true)
  const [notifDaily, setNotifDaily] = useState(true)
  const [notifWeekly, setNotifWeekly] = useState(false)
  const [autoLock, setAutoLock] = useState(true)
  const [allowTeachersAccessAllClasses, setAllowTeachersAccessAllClasses] = useState(false)
  const [schoolName, setSchoolName] = useState("SMP Negeri 1 Contoh")
  const [npsn, setNpsn] = useState("20200123")
  const [academicYear, setAcademicYear] = useState("2025/2026")
  const [semester, setSemester] = useState("Ganjil")
  const [openTime, setOpenTime] = useState("06:30")
  const [closeTime, setCloseTime] = useState("08:00")
  const [saving, setSaving] = useState(false)
  const [faviconUrl, setFaviconUrl] = useState("/favicon.ico")
  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null)
  const [uploadingFavicon, setUploadingFavicon] = useState(false)
  const [statusColors, setStatusColors] = useState<AttendanceStatusColors>(DEFAULT_STATUS_COLORS)
  const [appName, setAppName] = useState(DEFAULT_APP_NAME)
  const [appFullName, setAppFullName] = useState(DEFAULT_APP_FULL_NAME)
  const [appLogoUrl, setAppLogoUrl] = useState(DEFAULT_APP_LOGO_URL)
  const [hasAppLogo, setHasAppLogo] = useState(false)
  const faviconInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => { fetch("/api/admin/settings").then((r) => r.json()).then((s) => { setWebsiteTitle(s.websiteTitle); setSchoolName(s.schoolName); setNpsn(s.npsn ?? ""); setAcademicYear(s.academicYear); setSemester(s.semester); setOpenTime(s.attendanceOpenTime); setCloseTime(s.attendanceCloseTime); setAutoLock(s.autoLock); setAllowTeachersAccessAllClasses(s.allowTeachersAccessAllClasses ?? false); setFaviconUrl(s.faviconUrl ?? "/favicon.ico"); setAppName(s.appName ?? DEFAULT_APP_NAME); setAppFullName(s.appFullName ?? DEFAULT_APP_FULL_NAME); setAppLogoUrl(s.appLogoUrl ?? DEFAULT_APP_LOGO_URL); setHasAppLogo(Boolean(s.hasAppLogo)); setStatusColors(parseStatusColors(JSON.stringify(s.attendanceStatusColors ?? DEFAULT_STATUS_COLORS))) }) }, [])
  useEffect(() => () => { if (faviconPreview) URL.revokeObjectURL(faviconPreview) }, [faviconPreview])

  async function save() {
    if (!websiteTitle.trim()) { toast.error("Title website wajib diisi"); return }
    if (!appName.trim()) { toast.error("Nama aplikasi wajib diisi"); return }
    if (!appFullName.trim()) { toast.error("Nama lengkap aplikasi wajib diisi"); return }
    setSaving(true)
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ websiteTitle, appName, appFullName, schoolName, npsn, academicYear, semester, attendanceOpenTime: openTime, attendanceCloseTime: closeTime, autoLock, allowTeachersAccessAllClasses, attendanceStatusColors: statusColors }) })
    setSaving(false)
    if (response.ok) {
      document.title = websiteTitle.trim()
      // Warna status disuntikkan dari server; refresh agar seluruh
      // visualisasi langsung memakai warna terbaru.
      router.refresh()
      toast.success("Pengaturan disimpan")
    } else {
      toast.error("Pengaturan gagal disimpan")
    }
  }

  function chooseFavicon(file: File | null) {
    if (!file) return
    const validType = file.type === "image/png" || file.type === "image/x-icon" || file.type === "image/vnd.microsoft.icon" || file.name.toLowerCase().endsWith(".ico")
    if (!validType) { toast.error("Favicon harus berformat PNG atau ICO"); return }
    if (file.size > MAX_FAVICON_BYTES) { toast.error("Ukuran favicon maksimal 512 KB"); return }
    setFaviconFile(file)
    setFaviconPreview(URL.createObjectURL(file))
  }

  async function uploadFavicon() {
    if (!faviconFile) return
    setUploadingFavicon(true)
    try {
      const formData = new FormData()
      formData.set("favicon", faviconFile)
      const response = await fetch("/favicon.ico", { method: "PUT", body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Favicon gagal disimpan")
      setFaviconUrl(data.faviconUrl)
      setFaviconFile(null)
      setFaviconPreview(null)
      if (faviconInputRef.current) faviconInputRef.current.value = ""
      let icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
      if (!icon) { icon = document.createElement("link"); icon.rel = "icon"; document.head.appendChild(icon) }
      icon.href = data.faviconUrl
      toast.success("Favicon berhasil diperbarui")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Favicon gagal disimpan")
    } finally {
      setUploadingFavicon(false)
    }
  }

  return (
    <PageContainer>
      <PageHeading
        title="Pengaturan"
        description="Kelola branding website, profil sekolah, waktu input absensi, dan preferensi notifikasi."
      />

      <Card>
        <CardHeader>
          <CardTitle>Branding Website</CardTitle>
          <CardDescription>Atur title pada tab browser dan favicon website.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="website-title">Title Website</Label>
            <Input id="website-title" value={websiteTitle} onChange={(event) => setWebsiteTitle(event.target.value)} maxLength={100} className="bg-card" placeholder="Contoh: Dashboard Absensi Sekolah" />
            <p className="text-xs text-muted-foreground">Maksimal 100 karakter dan akan tampil pada tab browser.</p>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-[96px_1fr] sm:items-center">
            <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
              {faviconPreview || faviconUrl ? <Image src={faviconPreview ?? faviconUrl} alt="Favicon saat ini" width={64} height={64} unoptimized className="size-16 object-contain" /> : <ImageIcon className="size-8 text-muted-foreground" />}
            </div>
            <div className="space-y-3">
              <div>
                <p className="font-medium">Favicon</p>
                <p className="text-xs text-muted-foreground">Format PNG atau ICO, maksimal 512 KB. Disarankan berukuran persegi.</p>
              </div>
              <input ref={faviconInputRef} type="file" accept={FAVICON_ACCEPT} className="sr-only" onChange={(event) => chooseFavicon(event.target.files?.[0] ?? null)} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => faviconInputRef.current?.click()} disabled={uploadingFavicon}>
                  <Upload className="size-4" />Pilih Favicon
                </Button>
                {faviconFile ? (
                  <Button type="button" onClick={uploadFavicon} disabled={uploadingFavicon}>
                    {uploadingFavicon ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {uploadingFavicon ? "Mengunggah..." : "Simpan Favicon"}
                  </Button>
                ) : null}
                <Button render={<a href={`${faviconUrl}${faviconUrl.includes("?") ? "&" : "?"}download=1`} download />} type="button" variant="outline">
                  <Download className="size-4" />Download Favicon Saat Ini
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AppBrandingSettings
        appName={appName}
        appFullName={appFullName}
        logoUrl={appLogoUrl}
        hasLogo={hasAppLogo}
        onAppNameChange={setAppName}
        onAppFullNameChange={setAppFullName}
        onLogoChange={({ logoUrl, hasLogo }) => { setAppLogoUrl(logoUrl); setHasAppLogo(hasLogo); router.refresh() }}
      />

      <StatusColorSettings colors={statusColors} onChange={setStatusColors} />

      <Card>
        <CardHeader>
          <CardTitle>Profil Sekolah</CardTitle>
          <CardDescription>Informasi umum yang tampil pada laporan absensi</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nama">Nama Sekolah</Label>
              <Input id="nama" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="bg-card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="npsn">NPSN</Label>
              <Input id="npsn" value={npsn} onChange={(e) => setNpsn(e.target.value)} className="bg-card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tahun">Tahun Ajaran</Label>
              <Input id="tahun" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="bg-card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="semester">Semester</Label>
              <Input id="semester" value={semester} onChange={(e) => setSemester(e.target.value)} className="bg-card" />
            </div>
          </div>
        </CardContent>
      </Card>

      <HolidayManager />

      <DatabaseBackupCard />

      <Card>
        <CardHeader>
          <CardTitle>Hak Akses Guru</CardTitle>
          <CardDescription>Atur cakupan kelas yang dapat dilihat dan diinput oleh seluruh akun guru.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="teacher-all-classes">Izinkan guru mengakses seluruh kelas</Label>
              <p className="text-sm text-muted-foreground">
                Jika aktif, semua guru dapat melihat dashboard, rekap, dan export serta menginput atau memperbarui absensi seluruh kelas.
              </p>
            </div>
            <Switch id="teacher-all-classes" checked={allowTeachersAccessAllClasses} onCheckedChange={setAllowTeachersAccessAllClasses} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waktu Input Absensi</CardTitle>
          <CardDescription>Atur batas waktu wali kelas menginput absensi harian</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mulai">Jam Buka</Label>
              <Input id="mulai" type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="bg-card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tutup">Batas Akhir</Label>
              <Input id="tutup" type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="bg-card" />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Kunci otomatis setelah batas waktu</p>
              <p className="text-sm text-muted-foreground">
                Wali kelas tidak dapat mengubah absensi setelah batas akhir tanpa izin admin
              </p>
            </div>
            <Switch checked={autoLock} onCheckedChange={setAutoLock} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifikasi</CardTitle>
          <CardDescription>Preferensi pengingat dan laporan otomatis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <NotifRow
            title="Pengingat input absensi"
            desc="Kirim pengingat ke wali kelas yang belum menginput"
            checked={notifReminder}
            onChange={setNotifReminder}
          />
          <Separator />
          <NotifRow
            title="Ringkasan harian"
            desc="Kirim rekap kehadiran ke kepala sekolah setiap hari"
            checked={notifDaily}
            onChange={setNotifDaily}
          />
          <Separator />
          <NotifRow
            title="Laporan mingguan"
            desc="Kirim laporan tren kehadiran setiap akhir pekan"
            checked={notifWeekly}
            onChange={setNotifWeekly}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" className="bg-card">
          Batal
        </Button>
        <Button onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button>
      </div>
    </PageContainer>
  )
}

function NotifRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
