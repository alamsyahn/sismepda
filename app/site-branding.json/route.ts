import { NextResponse } from "next/server"
import { defaultSiteBranding, readSiteBranding } from "@/lib/server-site-branding"

export async function GET() {
  try {
    return NextResponse.json(await readSiteBranding(), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Gagal memuat branding website", error)
    return NextResponse.json(defaultSiteBranding, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
