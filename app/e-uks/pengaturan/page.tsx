import { redirect } from "next/navigation"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { EuksComplaintOptionSettings } from "@/components/e-uks/euks-complaint-option-settings"
import { EuksFacilitySettings } from "@/components/e-uks/euks-facility-settings"
import { EuksHeroImageSettings } from "@/components/e-uks/euks-hero-image-settings"
import { EuksHeroLogoSettings } from "@/components/e-uks/euks-hero-logo-settings"
import { EuksOfficerSettings } from "@/components/e-uks/euks-officer-settings"
import { EuksProfileSettings } from "@/components/e-uks/euks-profile-settings"
import { EuksAccessError, requireEuksAdmin } from "@/lib/euks-access"
import { readAssignableTeachers, readEuksSettings } from "@/lib/server-euks"

export const dynamic = "force-dynamic"

export default async function EuksPengaturanPage() {
  try {
    await requireEuksAdmin()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/e-uks")
    throw error
  }

  const [settings, teachers] = await Promise.all([readEuksSettings(), readAssignableTeachers()])

  return (
    <PageContainer>
      <PageHeading
        title="Pengaturan E-UKS"
        description="Kelola identitas, foto hero, pengurus, fasilitas, dan pilihan keluhan yang dipakai modul E-UKS"
      />
      <EuksProfileSettings profile={settings.profile} />
      <EuksHeroImageSettings images={settings.heroImages} />
      <EuksHeroLogoSettings logos={settings.heroLogos} />
      <EuksOfficerSettings officers={settings.officers} teachers={teachers} />
      <EuksFacilitySettings facilities={settings.facilities} />
      <EuksComplaintOptionSettings options={settings.complaintOptions} />
    </PageContainer>
  )
}
