import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { EuksComplaintOptionSettings } from "@/components/e-uks/euks-complaint-option-settings"
import { EuksFacilitySettings } from "@/components/e-uks/euks-facility-settings"
import { EuksHeroImageSettings } from "@/components/e-uks/euks-hero-image-settings"
import { EuksHeroLogoSettings } from "@/components/e-uks/euks-hero-logo-settings"
import { EuksOfficerSettings } from "@/components/e-uks/euks-officer-settings"
import { EuksProfileSettings } from "@/components/e-uks/euks-profile-settings"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"
import { readAssignableTeachers, readEuksSettings } from "@/lib/server-euks"

export const dynamic = "force-dynamic"

/**
 * Permission apa pun di bawah ini cukup untuk membuka halaman, tetapi tiap
 * panel tetap dirender hanya bagi pemegang haknya sendiri. Halaman ini bukan
 * lagi milik ADMIN legacy.
 */
const SETTINGS_PERMISSIONS = [
  "euks.profile.update",
  "euks.hero_images.create",
  "euks.hero_images.update",
  "euks.hero_images.delete",
  "euks.hero_logos.create",
  "euks.hero_logos.update",
  "euks.hero_logos.delete",
  "euks.officers.create",
  "euks.officers.update",
  "euks.officers.delete",
  "euks.facilities.create",
  "euks.facilities.update",
  "euks.facilities.delete",
  "euks.complaint_options.create",
  "euks.complaint_options.update",
] as const

export default async function EuksPengaturanPage() {
  await requirePageAnyPermission(SETTINGS_PERMISSIONS)

  const [
    canProfile,
    canHeroImagesCreate,
    canHeroImagesUpdate,
    canHeroImagesDelete,
    canHeroLogosCreate,
    canHeroLogosUpdate,
    canHeroLogosDelete,
    canOfficersCreate,
    canOfficersUpdate,
    canOfficersDelete,
    canFacilitiesCreate,
    canFacilitiesUpdate,
    canFacilitiesDelete,
    canComplaintCreate,
    canComplaintUpdate,
  ] = await Promise.all(SETTINGS_PERMISSIONS.map((key) => pageCan(key)))

  const canHeroImages = canHeroImagesCreate || canHeroImagesUpdate || canHeroImagesDelete
  const canHeroLogos = canHeroLogosCreate || canHeroLogosUpdate || canHeroLogosDelete
  const canOfficers = canOfficersCreate || canOfficersUpdate || canOfficersDelete
  const canFacilities = canFacilitiesCreate || canFacilitiesUpdate || canFacilitiesDelete
  const canComplaints = canComplaintCreate || canComplaintUpdate

  const settings = await readEuksSettings()
  // Daftar guru hanya dibutuhkan panel pengurus; jangan dikirim ke pemakai lain.
  const teachers = canOfficers ? await readAssignableTeachers() : []

  return (
    <PageContainer>
      <PageHeading
        title="Pengaturan E-UKS"
        description="Kelola identitas, foto hero, pengurus, fasilitas, dan pilihan keluhan yang dipakai modul E-UKS"
      />
      {canProfile ? <EuksProfileSettings profile={settings.profile} /> : null}
      {canHeroImages ? <EuksHeroImageSettings images={settings.heroImages} /> : null}
      {canHeroLogos ? <EuksHeroLogoSettings logos={settings.heroLogos} /> : null}
      {canOfficers ? (
        <EuksOfficerSettings officers={settings.officers} teachers={teachers} />
      ) : null}
      {canFacilities ? <EuksFacilitySettings facilities={settings.facilities} /> : null}
      {canComplaints ? (
        <EuksComplaintOptionSettings options={settings.complaintOptions} />
      ) : null}
    </PageContainer>
  )
}
