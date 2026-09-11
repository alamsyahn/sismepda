import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
import { fromNullablePrismaDate, parseSchoolDate, toPrismaDate } from "@/lib/school-date"
import { prisma } from "@/lib/prisma"

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Bentuk masukan berbeda per tipe, sehingga divalidasi sebagai union: entri
 * bertanggal tidak boleh menerima hari/rentang, dan entri berulang tidak boleh
 * menerima tanggal tunggal.
 */
const holidayInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SINGLE"),
    date: dateString,
    name: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("SCHOOL_DAY"),
    date: dateString,
    name: z.string().trim().min(1),
  }),
  z
    .object({
      kind: z.literal("RECURRING"),
      weekday: z.number().int().min(0).max(6),
      name: z.string().trim().min(1),
      startDate: dateString,
      // Kosong berarti berlaku selamanya; tetap dapat diubah nanti.
      endDate: dateString.nullish(),
    })
    .refine((value) => !value.endDate || value.endDate >= value.startDate, {
      message: "Batas akhir tidak boleh lebih awal dari batas awal",
      path: ["endDate"],
    }),
])

const prismaDate = (value: string) => {
  const parsed = parseSchoolDate(value)
  if (!parsed) throw new Error("INVALID_DATE")
  return toPrismaDate(parsed)
}

function serialize(row: {
  id: string
  kind: string
  name: string
  date: Date | null
  weekday: number | null
  startDate: Date | null
  endDate: Date | null
}) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    date: fromNullablePrismaDate(row.date),
    weekday: row.weekday,
    startDate: fromNullablePrismaDate(row.startDate),
    endDate: fromNullablePrismaDate(row.endDate),
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const holidays = await prisma.schoolHoliday.findMany({
      orderBy: [{ kind: "asc" }, { date: "asc" }, { startDate: "asc" }],
    })
    return NextResponse.json(holidays.map(serialize))
  } catch {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = holidayInput.parse(await request.json())

    if (body.kind === "RECURRING") {
      const created = await prisma.schoolHoliday.create({
        data: {
          kind: "RECURRING",
          name: body.name,
          weekday: body.weekday,
          startDate: prismaDate(body.startDate),
          endDate: body.endDate ? prismaDate(body.endDate) : null,
        },
      })
      return NextResponse.json(serialize(created), { status: 201 })
    }

    // Satu tanggal boleh memiliki satu entri per tipe, sehingga menambah ulang
    // tanggal yang sama memperbarui keterangannya, bukan menggandakan baris.
    const date = prismaDate(body.date)
    const saved = await prisma.schoolHoliday.upsert({
      where: { kind_date: { kind: body.kind, date } },
      update: { name: body.name },
      create: { kind: body.kind, date, name: body.name },
    })
    return NextResponse.json(serialize(saved), { status: 201 })
  } catch {
    return NextResponse.json({ error: "Hari libur gagal disimpan" }, { status: 400 })
  }
}

const patchInput = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    startDate: dateString.optional(),
    // `null` mengembalikan entri menjadi berlaku selamanya.
    endDate: dateString.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.startDate !== undefined || value.endDate !== undefined, {
    message: "Tidak ada perubahan",
  })

/** Mengubah masa berlaku libur tetap, atau keterangan entri mana pun. */
export async function PATCH(request: Request) {
  try {
    await requireAdmin()
    const body = patchInput.parse(await request.json())
    const existing = await prisma.schoolHoliday.findUnique({ where: { id: body.id } })
    if (!existing) {
      return NextResponse.json({ error: "Entri tidak ditemukan" }, { status: 404 })
    }
    if (existing.kind !== "RECURRING" && (body.startDate !== undefined || body.endDate !== undefined)) {
      return NextResponse.json(
        { error: "Masa berlaku hanya dapat diatur untuk hari libur tetap" },
        { status: 400 },
      )
    }

    const startDate = body.startDate === undefined ? existing.startDate : prismaDate(body.startDate)
    const endDate =
      body.endDate === undefined
        ? existing.endDate
        : body.endDate === null
          ? null
          : prismaDate(body.endDate)
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json(
        { error: "Batas akhir tidak boleh lebih awal dari batas awal" },
        { status: 400 },
      )
    }

    const updated = await prisma.schoolHoliday.update({
      where: { id: body.id },
      data: { name: body.name ?? existing.name, startDate, endDate },
    })
    return NextResponse.json(serialize(updated))
  } catch {
    return NextResponse.json({ error: "Hari libur gagal diperbarui" }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin()
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json())
    await prisma.schoolHoliday.delete({ where: { id } })
    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: "Hari libur gagal dihapus" }, { status: 400 })
  }
}
