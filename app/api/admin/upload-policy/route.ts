import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"
import {
  DEFAULT_GLOBAL_LIMITS,
  MAX_CONFIGURABLE_UPLOAD_BYTES,
  MIN_CONFIGURABLE_UPLOAD_BYTES,
  isValidLimitBytes,
  resolveUploadPolicy,
  UploadPolicyError,
} from "@/lib/upload-policy"
import { getUploadPolicyConfig } from "@/lib/server-upload-policy"
import {
  UPLOAD_CATEGORIES,
  configurableUploadSlots,
  findUploadSlot,
  type UploadCategory,
} from "@/lib/upload-slots"

/**
 * Konfigurasi kebijakan unggah.
 *
 * GET menyusun tampilannya dari registry kode, bukan dari baris database:
 * slot baru yang didaftarkan developer langsung muncul di halaman Administrasi
 * tanpa menyentuh berkas UI mana pun. Database hanya menyimpan angka yang
 * berbeda dari bawaan.
 *
 * PUT tidak pernah mempercayai angka kiriman klien sebagai kebijakan — ia
 * hanya menerimanya sebagai usulan, memvalidasi rentangnya, dan menolak kunci
 * slot yang tidak terdaftar maupun yang memang tidak boleh disetel.
 */

export async function GET() {
  try {
    await requirePermission("school.upload_policy.read")
    const config = await getUploadPolicyConfig()

    return NextResponse.json({
      globals: UPLOAD_CATEGORIES.map((category) => ({
        category,
        maxBytes: config.globalLimits?.[category] ?? DEFAULT_GLOBAL_LIMITS[category],
        isCustom: isValidLimitBytes(config.globalLimits?.[category]),
        defaultMaxBytes: DEFAULT_GLOBAL_LIMITS[category],
      })),
      slots: configurableUploadSlots().map((slot) => {
        const resolved = resolveUploadPolicy(slot.key, config)
        // Angka yang akan berlaku bila override dilepas — dipakai UI untuk
        // menjelaskan konsekuensi tombol "Gunakan Default".
        const fallback = resolveUploadPolicy(slot.key, {
          ...config,
          slotOverrides: {},
        })
        return {
          key: slot.key,
          label: slot.label,
          module: slot.module,
          category: slot.category,
          description: slot.description ?? null,
          allowedMimeTypes: slot.allowedMimeTypes ?? null,
          maxBytes: resolved.maxBytes,
          source: resolved.source,
          isCustom: resolved.source === "override",
          defaultMaxBytes: fallback.maxBytes,
        }
      }),
      limits: {
        minBytes: MIN_CONFIGURABLE_UPLOAD_BYTES,
        maxBytes: MAX_CONFIGURABLE_UPLOAD_BYTES,
      },
    })
  } catch (error) {
    return authFailureResponse(error, "Pengaturan unggah gagal dimuat")
  }
}

type PutBody = {
  globals?: Partial<Record<UploadCategory, number | null>>
  slots?: Record<string, number | null>
}

export async function PUT(request: Request) {
  try {
    verifySameOrigin(request)
    const { user: viewer } = await requirePermission("school.upload_policy.update")

    const body = (await request.json().catch(() => null)) as PutBody | null
    if (!body || typeof body !== "object") {
      throw new UploadPolicyError("UPLOAD_POLICY_INVALID", "Data pengaturan tidak valid", 400)
    }

    // `null` berarti "kembalikan ke bawaan", bukan "tanpa batas".
    const globalUpdates: Record<string, number | null> = {}
    for (const [category, value] of Object.entries(body.globals ?? {})) {
      if (!UPLOAD_CATEGORIES.includes(category as UploadCategory)) {
        throw new UploadPolicyError("UPLOAD_POLICY_INVALID", "Kategori unggah tidak dikenal", 400)
      }
      if (value === null) {
        globalUpdates[category] = null
        continue
      }
      assertLimit(value)
      globalUpdates[category] = value
    }

    const slotEntries = Object.entries(body.slots ?? {})
    for (const [slotKey, value] of slotEntries) {
      const slot = findUploadSlot(slotKey)
      // Kunci slot dari klien wajib divalidasi terhadap registry: menerima
      // kunci asing berarti menyimpan kebijakan untuk sesuatu yang tidak
      // pernah ditegakkan.
      if (!slot) {
        throw new UploadPolicyError("UPLOAD_SLOT_UNKNOWN", "Tujuan unggahan tidak dikenal", 400)
      }
      if (slot.configurable === false) {
        throw new UploadPolicyError(
          "UPLOAD_POLICY_INVALID",
          `Batas "${slot.label}" tidak dapat diubah dari halaman ini`,
          400,
        )
      }
      if (value !== null) assertLimit(value)
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(globalUpdates).length > 0) {
        const data = {
          ...("image" in globalUpdates ? { uploadImageMaxBytes: globalUpdates.image } : {}),
          ...("document" in globalUpdates
            ? { uploadDocumentMaxBytes: globalUpdates.document }
            : {}),
        }
        await tx.schoolSetting.upsert({
          where: { id: "default" },
          update: data,
          create: { id: "default", ...data },
          select: { id: true },
        })
      }

      for (const [slotKey, value] of slotEntries) {
        if (value === null) {
          await tx.uploadPolicyOverride.deleteMany({ where: { slotKey } })
          continue
        }
        await tx.uploadPolicyOverride.upsert({
          where: { slotKey },
          update: { maxBytes: value, updatedById: viewer.id },
          create: { slotKey, maxBytes: value, updatedById: viewer.id },
          select: { slotKey: true },
        })
      }

      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "UPLOAD_POLICY_UPDATED",
          entity: "UploadPolicy",
          entityId: "default",
          after: { globals: globalUpdates, slots: Object.fromEntries(slotEntries) },
          summary: "Pengaturan batas unggah diperbarui",
        },
        tx,
      )
    })

    return GET()
  } catch (error) {
    return authFailureResponse(error, "Pengaturan unggah gagal disimpan")
  }
}

/** @throws {UploadPolicyError} bila di luar rentang, bukan bilangan bulat aman, atau negatif. */
function assertLimit(value: unknown): asserts value is number {
  if (!isValidLimitBytes(value)) {
    throw new UploadPolicyError(
      "UPLOAD_POLICY_INVALID",
      "Batas ukuran harus berupa angka antara 32 KB dan 64 MB",
      400,
    )
  }
}
