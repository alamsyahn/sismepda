import "server-only"

import { prisma } from "@/lib/prisma"
import { DEFAULT_WEBSITE_TITLE, faviconUrl } from "@/lib/site-branding"

export type SiteBrandingData = {
  websiteTitle: string
  faviconUrl: string
}

export const defaultSiteBranding: SiteBrandingData = {
  websiteTitle: DEFAULT_WEBSITE_TITLE,
  faviconUrl: "/favicon.ico",
}

export async function readSiteBranding(): Promise<SiteBrandingData> {
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { websiteTitle: true, faviconUpdatedAt: true },
  })

  return {
    websiteTitle: setting?.websiteTitle?.trim() || DEFAULT_WEBSITE_TITLE,
    faviconUrl: faviconUrl(setting?.faviconUpdatedAt),
  }
}
