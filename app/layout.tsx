import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { connection } from "next/server"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/sonner"
import { SessionProvider } from "@/components/auth/session-provider"
import { SiteBranding } from "@/components/site-branding"
import { defaultSiteBranding, readSiteBranding } from "@/lib/server-site-branding"
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="id" className="light">
      <body className="bg-background font-sans antialiased">
        <SiteBranding />
        <SessionProvider><AppShell>{children}</AppShell></SessionProvider>
        <Toaster position="top-center" />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
