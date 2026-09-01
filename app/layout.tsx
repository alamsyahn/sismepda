import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { connection } from "next/server"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/sonner"
import { SessionProvider } from "@/components/auth/session-provider"
import { SiteBranding } from "@/components/site-branding"
import { AppBrandingProvider } from "@/components/layout/app-branding-provider"
import { defaultSiteBranding, readSiteBranding } from "@/lib/server-site-branding"
import { readAttendanceStatusColors } from "@/lib/server-attendance-status-colors"
import { DEFAULT_STATUS_COLORS } from "@/lib/attendance-status-colors"
import "./globals.css"

export async function generateMetadata(): Promise<Metadata> {
  await connection()
  let branding = defaultSiteBranding
  try {
    branding = await readSiteBranding()
  } catch (error) {
    console.error("Gagal memuat branding website untuk metadata", error)
  }

  return {
    title: branding.websiteTitle,
    description:
      "Ringkasan absensi dan kelengkapan input harian untuk admin dan guru. Pantau kehadiran siswa dan progress input tiap kelas dalam satu tampilan.",
    generator: "v0.app",
    icons: {
      icon: [{ url: branding.faviconUrl }],
      apple: branding.faviconUrl,
    },
  }
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f2fb",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const statusColors = await readAttendanceStatusColors()
  let branding = defaultSiteBranding
  try {
    branding = await readSiteBranding()
  } catch (error) {
    console.error("Gagal memuat branding aplikasi", error)
  }
  // Hanya kirim override yang benar-benar berbeda dari default, sehingga
  // tampilan bawaan tetap memakai token chart yang sudah ada.
  const statusColorStyle = Object.fromEntries(
    Object.entries(statusColors)
      .filter(([status, color]) => color !== DEFAULT_STATUS_COLORS[status as keyof typeof DEFAULT_STATUS_COLORS])
      .map(([status, color]) => [`--status-${status}`, color]),
  ) as React.CSSProperties

  return (
    <html lang="id" className="light" style={statusColorStyle}>
      <body className="bg-background font-sans antialiased">
        <SiteBranding />
        <SessionProvider>
          <AppBrandingProvider
            branding={{
              appName: branding.appName,
              appFullName: branding.appFullName,
              appLogoUrl: branding.appLogoUrl,
              hasAppLogo: branding.hasAppLogo,
            }}
          >
            <AppShell>{children}</AppShell>
          </AppBrandingProvider>
        </SessionProvider>
        <Toaster position="top-center" />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
