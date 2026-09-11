import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import {
  appLogoUrl,
  DEFAULT_WEBSITE_TITLE,
  faviconUrl,
  MAX_APP_FULL_NAME_LENGTH,
  MAX_APP_NAME_LENGTH,
  resolveAppFullName,
  resolveAppName,
} from "@/lib/site-branding"
import {
  normalizeHexColor,
  parseStatusColors,
  serializeStatusColors,
} from "@/lib/attendance-status-colors"
import { isIanaTimeZone } from "@/lib/school-date"

const hexColor = z.string().transform((value, ctx) => {
  const normalized = normalizeHexColor(value)
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Warna harus berupa kode HEX" })
    return z.NEVER
  }
  return normalized
})

const settingInput = z.object({
  websiteTitle: z.string().trim().min(1).max(100),
  appName: z.string().trim().min(1).max(MAX_APP_NAME_LENGTH),
  appFullName: z.string().trim().min(1).max(MAX_APP_FULL_NAME_LENGTH),
  schoolName: z.string().trim().min(1).max(150),
  npsn: z.string().trim().max(30).transform((value) => value || null),
  academicYear: z.string().trim().min(1).max(20),
  semester: z.string().trim().min(1).max(30),
  timeZone: z.string().trim().refine(isIanaTimeZone, "Zona waktu harus berupa nama IANA yang valid"),
  attendanceOpenTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  attendanceCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  autoLock: z.boolean(),
  allowTeachersAccessAllClasses: z.boolean(),
  attendanceStatusColors: z
    .object({
      sakit: hexColor,
      izin: hexColor,
      alfa: hexColor,
      dispensasi: hexColor,
    })
    .optional(),
})

const settingSelect = {
  websiteTitle: true,
  appName: true,
  appFullName: true,
  appLogoUpdatedAt: true,
  schoolName: true,
  npsn: true,
  academicYear: true,
  semester: true,
  timeZone: true,
  attendanceOpenTime: true,
  attendanceCloseTime: true,
  autoLock: true,
  allowTeachersAccessAllClasses: true,
  attendanceStatusColors: true,
  faviconData: true,
  faviconUpdatedAt: true,
} as const

function settingResponse(setting: {
  websiteTitle: string
  appName: string
  appFullName: string
  appLogoUpdatedAt: Date | null
  schoolName: string
  npsn: string | null
  academicYear: string
  semester: string
  timeZone: string
  attendanceOpenTime: string
  attendanceCloseTime: string
  autoLock: boolean
  allowTeachersAccessAllClasses: boolean
  attendanceStatusColors: string | null
  faviconData: Uint8Array | null
  faviconUpdatedAt: Date | null
}) {
  const { faviconData, faviconUpdatedAt, appLogoUpdatedAt, attendanceStatusColors, ...values } = setting
  return {
    ...values,
    websiteTitle: values.websiteTitle || DEFAULT_WEBSITE_TITLE,
    appName: resolveAppName(values.appName),
    appFullName: resolveAppFullName(values.appFullName),
    appLogoUrl: appLogoUrl(appLogoUpdatedAt),
    hasAppLogo: Boolean(appLogoUpdatedAt),
    attendanceStatusColors: parseStatusColors(attendanceStatusColors),
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
    const { attendanceStatusColors, ...body } = settingInput.parse(await request.json())
    // Kolom menyimpan JSON; undefined berarti pemanggil tidak mengubah warna.
    const data = attendanceStatusColors
      ? { ...body, attendanceStatusColors: serializeStatusColors(attendanceStatusColors) }
      : body
    const setting = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: data,
      create: { ...data, id: "default" },
      select: settingSelect,
    })
    return NextResponse.json(settingResponse(setting))
  } catch {
    return NextResponse.json({ error: "Gagal menyimpan pengaturan" }, { status: 400 })
  }
}
