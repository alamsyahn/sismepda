import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
import { fromPrismaDate, parseSchoolDate, toPrismaDate } from "@/lib/school-date"
import { prisma } from "@/lib/prisma"

const holidayInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1) })

export async function GET() {
  try { await requireAdmin(); const holidays = await prisma.schoolHoliday.findMany({ orderBy: { date: "asc" } }); return NextResponse.json(holidays.map((holiday) => ({ ...holiday, date: fromPrismaDate(holiday.date) }))) }
  catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = holidayInput.parse(await request.json())
    const schoolDate = parseSchoolDate(body.date)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const date = toPrismaDate(schoolDate)
    const holiday = await prisma.schoolHoliday.upsert({ where: { date }, update: { name: body.name }, create: { date, name: body.name } })
    return NextResponse.json({ ...holiday, date: fromPrismaDate(holiday.date) }, { status: 201 })
  } catch { return NextResponse.json({ error: "Hari libur gagal disimpan" }, { status: 400 }) }
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); const { id } = z.object({ id: z.string().min(1) }).parse(await request.json()); await prisma.schoolHoliday.delete({ where: { id } }); return NextResponse.json({ id }) }
  catch { return NextResponse.json({ error: "Hari libur gagal dihapus" }, { status: 400 }) }
}
