"use client"

import Image from "next/image"
import { GraduationCap } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEFAULT_APP_LOGO_URL } from "@/lib/site-branding"

/**
 * Kontainer logo dengan ukuran tetap seperti sidebar sekarang. Logo custom
 * dirender `object-contain` agar proporsinya terjaga (tidak gepeng) baik untuk
 * logo persegi maupun yang punya transparent padding. Tanpa logo custom,
 * ikon default SISMEPDA tetap dipakai.
 */
export function AppLogo({
  logoUrl,
  hasCustomLogo,
  appName,
  className,
  imageClassName,
  iconClassName,
  size = 40,
}: {
  logoUrl: string
  hasCustomLogo: boolean
  appName: string
  className?: string
  imageClassName?: string
  iconClassName?: string
  size?: number
}) {
  if (!hasCustomLogo || logoUrl === DEFAULT_APP_LOGO_URL) {
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm",
          className,
        )}
      >
        <GraduationCap className={cn("size-5", iconClassName)} />
      </span>
    )
  }

  return (
    <span className={cn("flex items-center justify-center overflow-hidden rounded-2xl bg-card shadow-sm", className)}>
      <Image
        src={logoUrl}
        alt={`Logo ${appName}`}
        width={size}
        height={size}
        unoptimized
        className={cn("size-full object-contain p-0.5", imageClassName)}
      />
    </span>
  )
}
