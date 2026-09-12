import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { detectProfilePhotoType } from "@/lib/profile"
import { authFailureResponse } from "@/lib/api-errors"
import { requireSarprasPermission } from "@/lib/sarpras-access"
import {
  MAX_SARPRAS_PHOTO_BYTES,
  MAX_SARPRAS_PHOTOS_PER_ITEM,
} from "@/lib/sarpras-constants"

/** Upload one photo for an item. Requires sarpras.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.photos.create")

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_SARPRAS_PHOTO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran foto maksimal 2 MB" }, { status: 413 })
    }

    const formData = await request.formData()
    const itemId = formData.get("itemId")
    const photo = formData.get("photo")
    const caption = formData.get("caption")

    if (typeof itemId !== "string" || itemId.length === 0) {
      return NextResponse.json({ error: "Barang tidak valid" }, { status: 400 })
    }
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    if (photo.size > MAX_SARPRAS_PHOTO_BYTES) {
      return NextResponse.json({ error: "Ukuran foto maksimal 2 MB" }, { status: 413 })
    }

    const item = await prisma.sarprasItem.findUnique({
      where: { id: itemId },
      select: { id: true, _count: { select: { photos: true } } },
    })
    if (!item) return NextResponse.json({ error: "Barang tidak ditemukan" }, { status: 404 })
    if (item._count.photos >= MAX_SARPRAS_PHOTOS_PER_ITEM) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_SARPRAS_PHOTOS_PER_ITEM} foto per barang` },
        { status: 409 },
      )
    }

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Trust the file's magic bytes, never the client-supplied content type.
    const mimeType = detectProfilePhotoType(bytes)
    if (!mimeType) {
      return NextResponse.json(
        { error: "Foto harus berformat JPEG, PNG, atau WebP" },
        { status: 415 },
      )
    }

    const created = await prisma.sarprasPhoto.create({
      data: {
        itemId: item.id,
        data: bytes,
        mimeType,
        caption: typeof caption === "string" && caption.trim().length > 0 ? caption.trim() : null,
        sortOrder: item._count.photos,
      },
      select: { id: true, caption: true },
    })

    void viewer
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/** Delete one photo. Requires sarpras.edit. */
export async function DELETE(request: Request) {
  try {
    await requireSarprasPermission("sarpras.photos.delete")
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Foto tidak valid" }, { status: 400 })

    const photo = await prisma.sarprasPhoto.findUnique({ where: { id }, select: { id: true } })
    if (!photo) return NextResponse.json({ error: "Foto tidak ditemukan" }, { status: 404 })

    await prisma.sarprasPhoto.delete({ where: { id: photo.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/** List photo ids for one item. Viewers may read. */
export async function GET(request: Request) {
  try {
    await requireSarprasPermission("sarpras.photos.read")
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get("itemId")
    if (!itemId) return NextResponse.json({ error: "Barang tidak valid" }, { status: 400 })

    const photos = await prisma.sarprasPhoto.findMany({
      where: { itemId },
      select: { id: true, caption: true },
      orderBy: { sortOrder: "asc" },
    })
    return NextResponse.json({ photos })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}
