import "server-only"

import { prisma } from "@/lib/prisma"
import {
  appLogoUrl,
  DEFAULT_APP_FULL_NAME,
  DEFAULT_APP_LOGO_URL,
  DEFAULT_APP_NAME,
  DEFAULT_WEBSITE_TITLE,
  faviconUrl,
  resolveAppFullName,
  resolveAppName,
} from "@/lib/site-branding"

export type SiteBrandingData = {
  websiteTitle: string
  faviconUrl: string
  appName: string
  appFullName: string
  appLogoUrl: string
  hasAppLogo: boolean
}

export const defaultSiteBranding: SiteBrandingData = {
  websiteTitle: DEFAULT_WEBSITE_TITLE,
  faviconUrl: "/favicon.ico",
  appName: DEFAULT_APP_NAME,
  appFullName: DEFAULT_APP_FULL_NAME,
  appLogoUrl: DEFAULT_APP_LOGO_URL,
  hasAppLogo: false,
}

export async function readSiteBranding(): Promise<SiteBrandingData> {
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: {
      websiteTitle: true,
      faviconUpdatedAt: true,
      appName: true,
      appFullName: true,
      appLogoUpdatedAt: true,
    },
  })

  return {
    websiteTitle: setting?.websiteTitle?.trim() || DEFAULT_WEBSITE_TITLE,
    faviconUrl: faviconUrl(setting?.faviconUpdatedAt),
    appName: resolveAppName(setting?.appName),
    appFullName: resolveAppFullName(setting?.appFullName),
    appLogoUrl: appLogoUrl(setting?.appLogoUpdatedAt),
    hasAppLogo: Boolean(setting?.appLogoUpdatedAt),
  }
}
