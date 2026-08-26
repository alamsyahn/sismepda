import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { DEFAULT_WEBSITE_TITLE, faviconUrl } from "@/lib/site-branding"

const settingInput = z.object({
  websiteTitle: z.string().trim().min(1).max(100),
  schoolName: z.string().trim().min(1).max(150),
  npsn: z.string().trim().max(30).transform((value) => value || null),
  academicYear: z.string().trim().min(1).max(20),
  semester: z.string().trim().min(1).max(30),
  attendanceOpenTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  attendanceCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  autoLock: z.boolean(),
  allowTeachersAccessAllClasses: z.boolean(),
})

const settingSelect = {
  websiteTitle: true,
  schoolName: true,
  npsn: true,
  academicYear: true,
  semester: true,
  attendanceOpenTime: true,
  attendanceCloseTime: true,
  autoLock: true,
  allowTeachersAccessAllClasses: true,
  faviconData: true,
  faviconUpdatedAt: true,
} as const

function settingResponse(setting: {
  websiteTitle: string
  schoolName: string
  npsn: string | null
  academicYear: string
  semester: string
  attendanceOpenTime: string
  attendanceCloseTime: string
  autoLock: boolean
  allowTeachersAccessAllClasses: boolean
  faviconData: Uint8Array | null
  faviconUpdatedAt: Date | null
}) {
  const { faviconData, faviconUpdatedAt, ...values } = setting
  return {
    ...values,
    websiteTitle: values.websiteTitle || DEFAULT_WEBSITE_TITLE,
    hasFavicon: Boolean(faviconData),
    faviconUrl: faviconUrl(faviconUpdatedAt),
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const setting = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: {},
      create: {},
      select: settingSelect,
    })
    return NextResponse.json(settingResponse(setting))
  } catch {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin()
    const body = settingInput.parse(await request.json())
    const setting = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: body,
      create: { ...body, id: "default" },
      select: settingSelect,
    })
    return NextResponse.json(settingResponse(setting))
  } catch {
    return NextResponse.json({ error: "Gagal menyimpan pengaturan" }, { status: 400 })
  }
}
