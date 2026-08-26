"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

export function SiteBranding() {
  const pathname = usePathname()

  useEffect(() => {
    const controller = new AbortController()
    fetch("/site-branding.json", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((branding: { websiteTitle?: string; faviconUrl?: string } | null) => {
        if (!branding) return
        if (branding.websiteTitle) document.title = branding.websiteTitle
        if (branding.faviconUrl) {
          document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => {
            link.href = branding.faviconUrl as string
          })
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [pathname])

  return null
}
