/**
 * Pembacaan jejak audit RBAC.
 *
 * Menuntut `rbac.audit.read` tersendiri: mengetahui siapa mengubah kewenangan
 * siapa adalah informasi sensitif, dan tidak otomatis menyertai izin membaca
 * daftar role.
 */

import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { RBAC_AUDIT_ENTITIES } from "@/lib/rbac-audit"

const MAX_PAGE_SIZE = 100

export async function GET(request: Request) {
  try {
    await requirePermission("rbac.audit.read")

    const url = new URL(request.url)
    const requestedSize = Number(url.searchParams.get("pageSize") ?? "50")
    const pageSize = Number.isFinite(requestedSize)
      ? Math.min(Math.max(Math.trunc(requestedSize), 1), MAX_PAGE_SIZE)
      : 50
    const cursor = url.searchParams.get("cursor")
    const targetUserId = url.searchParams.get("targetUserId")

    const rows = await prisma.auditLog.findMany({
      where: {
        // Hanya entitas RBAC; endpoint ini bukan pembaca audit umum.
        entity: { in: [...RBAC_AUDIT_ENTITIES] },
        ...(targetUserId ? { targetUserId } : {}),
      },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        targetUserId: true,
        summary: true,
        before: true,
        after: true,
        createdAt: true,
        actor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = rows.length > pageSize
    const entries = hasMore ? rows.slice(0, pageSize) : rows

    // `AuditLog.targetUserId` sengaja tidak berelasi di schema agar baris audit
    // selamat saat akun dihapus. Nama target karena itu diresolusi terpisah,
    // dan tetap null bila akunnya sudah tidak ada.
    const targetIds = [...new Set(entries.map((row) => row.targetUserId).filter((id): id is string => Boolean(id)))]
    const targets = targetIds.length
      ? await prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, name: true },
        })
      : []
    const targetById = new Map(targets.map((user) => [user.id, user.name]))

    return NextResponse.json({
      entries: entries.map((row) => ({
        ...row,
        targetUserName: row.targetUserId ? targetById.get(row.targetUserId) ?? null : null,
      })),
      nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null,
    })
  } catch (error) {
    return authFailureResponse(error, "Jejak audit gagal dimuat")
  }
}
