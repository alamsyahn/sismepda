import { NextResponse } from "next/server"
import { z } from "zod"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requireAnyPermission, requirePermission } from "@/lib/rbac-access"
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

/** Explicit API whitelist. Unknown keys are rejected rather than reaching Prisma. */
const settingInput = z.strictObject({
  websiteTitle: z.string().trim().min(1).max(100).optional(),
  appName: z.string().trim().min(1).max(MAX_APP_NAME_LENGTH).optional(),
  appFullName: z.string().trim().min(1).max(MAX_APP_FULL_NAME_LENGTH).optional(),
  schoolName: z.string().trim().min(1).max(150).optional(),
  npsn: z.string().trim().max(30).transform((value) => value || null).optional(),
  academicYear: z.string().trim().min(1).max(20).optional(),
  semester: z.string().trim().min(1).max(30).optional(),
  timeZone: z.string().trim().refine(isIanaTimeZone, "Zona waktu harus berupa nama IANA yang valid").optional(),
  attendanceOpenTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  attendanceCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  autoLock: z.boolean().optional(),
  allowTeachersAccessAllClasses: z.boolean().optional(),
  attendanceStatusColors: z
    .object({ sakit: hexColor, izin: hexColor, alfa: hexColor, dispensasi: hexColor })
    .optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Tidak ada perubahan" })

export const BRANDING_FIELDS = ["websiteTitle", "appName", "appFullName"] as const
export const CLASS_ACCESS_FIELDS = ["allowTeachersAccessAllClasses"] as const
export const SETTINGS_FIELDS = [
  "schoolName", "npsn", "academicYear", "semester", "timeZone",
  "attendanceOpenTime", "attendanceCloseTime", "autoLock", "attendanceStatusColors",
] as const

/** Any one of these admits a caller to PUT; each group is re-checked below. */
const WRITABLE_PERMISSIONS = [
  "school.settings.update",
  "school.branding.update",
  "school.class_access.manage",
] as const

const hasAnyOwn = (value: object, keys: readonly string[]) =>
  keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))

const settingSelect = {
  websiteTitle: true, appName: true, appFullName: true, appLogoUpdatedAt: true,
  schoolName: true, npsn: true, academicYear: true, semester: true, timeZone: true,
  attendanceOpenTime: true, attendanceCloseTime: true, autoLock: true,
  allowTeachersAccessAllClasses: true, attendanceStatusColors: true,
  faviconData: true, faviconUpdatedAt: true,
} as const

function settingResponse(setting: {
  websiteTitle: string; appName: string; appFullName: string; appLogoUpdatedAt: Date | null
  schoolName: string; npsn: string | null; academicYear: string; semester: string; timeZone: string
  attendanceOpenTime: string; attendanceCloseTime: string; autoLock: boolean
  allowTeachersAccessAllClasses: boolean; attendanceStatusColors: string | null
  faviconData: Uint8Array | null; faviconUpdatedAt: Date | null
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
    await requirePermission("school.settings.read")
    const setting = await prisma.schoolSetting.upsert({
      where: { id: "default" }, update: {}, create: {}, select: settingSelect,
    })
    return NextResponse.json(settingResponse(setting))
  } catch (error) {
    return authFailureResponse(error, "Pengaturan gagal dimuat")
  }
}

export async function PUT(request: Request) {
  try {
    // Reject callers holding none of the writable groups before the payload is
    // read or validated, so an unauthorized request cannot probe the schema by
    // reading Zod's validation messages out of a 400.
    await requireAnyPermission(WRITABLE_PERMISSIONS)

    const body = settingInput.parse(await request.json())
    // Each supplied group additionally requires its own current-DB grant. In
    // particular, a normal settings editor cannot alter the global
    // class-widening switch.
    if (hasAnyOwn(body, SETTINGS_FIELDS)) await requirePermission("school.settings.update")
    if (hasAnyOwn(body, BRANDING_FIELDS)) await requirePermission("school.branding.update")
    if (hasAnyOwn(body, CLASS_ACCESS_FIELDS)) await requirePermission("school.class_access.manage")

    const { attendanceStatusColors, ...plain } = body
    const data = attendanceStatusColors === undefined
      ? plain
      : { ...plain, attendanceStatusColors: serializeStatusColors(attendanceStatusColors) }
    const setting = await prisma.schoolSetting.upsert({
      where: { id: "default" }, update: data, create: { ...data, id: "default" }, select: settingSelect,
    })
    return NextResponse.json(settingResponse(setting))
  } catch (error) {
    return authFailureResponse(error, "Gagal menyimpan pengaturan")
  }
}
