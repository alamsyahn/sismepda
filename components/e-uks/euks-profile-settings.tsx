"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  PROFILE_CONTACT_MAX,
  PROFILE_DESCRIPTION_MAX,
  PROFILE_LOCATION_MAX,
  PROFILE_NAME_MAX,
  PROFILE_SERVICE_HOURS_MAX,
} from "@/lib/euks-settings"

export type EuksProfileForm = {
  name: string | null
  location: string | null
  description: string | null
  serviceHours: string | null
  contact: string | null
}

export function EuksProfileSettings({ profile }: { profile: EuksProfileForm }) {
  const router = useRouter()
  const [name, setName] = useState(profile.name ?? "")
  const [location, setLocation] = useState(profile.location ?? "")
  const [description, setDescription] = useState(profile.description ?? "")
  const [serviceHours, setServiceHours] = useState(profile.serviceHours ?? "")
  const [contact, setContact] = useState(profile.contact ?? "")
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/e-uks/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location, description, serviceHours, contact }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? "Gagal menyimpan identitas UKS")
      }
      toast.success("Identitas UKS disimpan")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan identitas UKS")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identitas UKS</CardTitle>
        <CardDescription>Tampil di bagian atas Halaman Utama E-UKS.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="euks-profile-name">Nama Unit</Label>
            <Input
              id="euks-profile-name"
              value={name}
              maxLength={PROFILE_NAME_MAX}
              placeholder="UKS SMP Negeri 1 Contoh"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="euks-profile-location">Lokasi Ruang</Label>
            <Input
              id="euks-profile-location"
              value={location}
              maxLength={PROFILE_LOCATION_MAX}
              placeholder="Gedung B lantai 1, sebelah ruang guru"
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
        </div>

        {/* Jam layanan & kontak: ditampilkan sebagai blok tersendiri di hero
            Halaman Utama, bukan sebagai statistik. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="euks-profile-service-hours">Jam Layanan</Label>
            <Input
              id="euks-profile-service-hours"
              value={serviceHours}
              maxLength={PROFILE_SERVICE_HOURS_MAX}
              placeholder="Senin–Jumat, 07.00–14.00 WIB"
              onChange={(event) => setServiceHours(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="euks-profile-contact">Kontak</Label>
            <Input
              id="euks-profile-contact"
              value={contact}
              maxLength={PROFILE_CONTACT_MAX}
              placeholder="0812-3456-7890 (Ibu Ani)"
              onChange={(event) => setContact(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="euks-profile-description">Deskripsi</Label>
          {/* Tidak ada komponen textarea di design system ini; memakai
              elemen native dengan kelas yang sama seperti Input. */}
          <textarea
            id="euks-profile-description"
            value={description}
            maxLength={PROFILE_DESCRIPTION_MAX}
            rows={4}
            placeholder="Visi, misi, atau keterangan singkat tentang UKS sekolah."
            onChange={(event) => setDescription(event.target.value)}
            className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          />
          <p className="text-muted-foreground text-xs">
            {description.length} / {PROFILE_DESCRIPTION_MAX} karakter
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
