"use client"

import { createContext, useContext } from "react"
import {
  DEFAULT_APP_FULL_NAME,
  DEFAULT_APP_LOGO_URL,
  DEFAULT_APP_NAME,
} from "@/lib/site-branding"

export type AppBranding = {
  appName: string
  appFullName: string
  appLogoUrl: string
  hasAppLogo: boolean
}

export const defaultAppBranding: AppBranding = {
  appName: DEFAULT_APP_NAME,
  appFullName: DEFAULT_APP_FULL_NAME,
  appLogoUrl: DEFAULT_APP_LOGO_URL,
  hasAppLogo: false,
}

const AppBrandingContext = createContext<AppBranding>(defaultAppBranding)

/**
 * Nilai branding di-render dari server (layout) sehingga markup pertama sudah
 * benar — tidak ada flash "SISMEPDA" lalu berganti, dan tidak ada hydration
 * mismatch karena client memakai nilai yang sama.
 */
export function AppBrandingProvider({
  branding,
  children,
}: {
  branding: AppBranding
  children: React.ReactNode
}) {
  return <AppBrandingContext.Provider value={branding}>{children}</AppBrandingContext.Provider>
}

export function useAppBranding(): AppBranding {
  return useContext(AppBrandingContext)
}
