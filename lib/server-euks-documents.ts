import { z } from "zod"

import { ApiError } from "@/lib/api-errors"
import { EUKS_DOCUMENT_CATEGORIES, EUKS_DOCUMENT_MAX_BYTES, EUKS_DOCUMENT_YEAR } from "@/lib/euks-documents"
import { verifySameOrigin } from "@/lib/same-origin"

const maxRequestBytes = EUKS_DOCUMENT_MAX_BYTES + 32 * 1024
const invalidFile = "Gunakan PDF, DOCX, atau XLSX yang valid."
const tooLarge = "Ukuran berkas maksimal 5 MB."

export const documentId = z.uuid()
export const documentVersion = z.coerce.number().int().min(1).max(2147483646)
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(160).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  category: z.enum(EUKS_DOCUMENT_CATEGORIES),
  schoolYear: z.string().refine(value =>
    EUKS_DOCUMENT_YEAR.test(value) && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1),
  shared: z.enum(["internal", "shared"]).transform(value => value === "shared"),
})

export function assertDocumentOrigin(request: Request) {
  const origin = verifySameOrigin(request)
  if (!origin.ok) throw new ApiError(origin.status, origin.error)
}

export async function readDocumentForm(request: Request) {
  const type = request.headers.get("content-type")
  if (!type || !/^multipart\/form-data\s*;/i.test(type) || !request.body) {
    throw new ApiError(400, "Gunakan formulir unggah dokumen.")
  }
  if (Number(request.headers.get("content-length")) > maxRequestBytes) throw new ApiError(413, tooLarge)

  // Apply the limit to the stream as well, including uploads without Content-Length.
  const reader = request.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxRequestBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ApiError(413, tooLarge)
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }

  return new Response(new Blob(chunks), { headers: { "Content-Type": type } })
    .formData().catch(() => { throw new ApiError(400, "Formulir dokumen tidak valid.") })
}

export function readDocumentMetadata(form: FormData) {
  const metadata = metadataSchema.safeParse({
    title: form.get("title"),
    category: form.get("category"),
    schoolYear: form.get("schoolYear"),
    shared: form.get("visibility"),
  })
  if (!metadata.success) {
    throw new ApiError(400, "Isi judul, kategori, dan tahun ajaran yang valid (misalnya 2026/2027).")
  }
  return metadata.data
}

// Check the Office container directory without extracting or executing its contents.
function isOfficeDocument(content: Buffer, mainPart: string) {
  if (content.length < 22 || content.readUInt32LE(0) !== 0x04034b50) return false
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const end = content.lastIndexOf(endSignature, content.length - 22)
  if (end < 0 || end + 22 + content.readUInt16LE(end + 20) !== content.length) return false
  if (content.readUInt32LE(end + 4) !== 0) return false
  const count = content.readUInt16LE(end + 10)
  if (count !== content.readUInt16LE(end + 8)) return false
  let offset = content.readUInt32LE(end + 16)
  if (offset + content.readUInt32LE(end + 12) !== end) return false

  const names = new Set<string>()
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || content.readUInt32LE(offset) !== 0x02014b50) return false
    if ((content.readUInt16LE(offset + 8) & 1) !== 0) return false
    const nameStart = offset + 46
    const nameEnd = nameStart + content.readUInt16LE(offset + 28)
    offset = nameEnd + content.readUInt16LE(offset + 30) + content.readUInt16LE(offset + 32)
    if (offset > end) return false
    const name = content.toString("utf8", nameStart, nameEnd)
    if (/vbaProject|\/activeX\/|\/embeddings\//i.test(name) || names.has(name)) return false
    names.add(name)
  }
  return offset === end && names.has("[Content_Types].xml") && names.has(mainPart)
}

export async function readDocumentFile(form: FormData) {
  const file = form.get("file")
  if (file === null || (file instanceof File && !file.name && !file.size)) return null
  if (!(file instanceof File) || !file.size) throw new ApiError(415, invalidFile)
  if (file.size > EUKS_DOCUMENT_MAX_BYTES) throw new ApiError(413, tooLarge)
  const fileName = file.name.normalize().trim()
  const ext = fileName.split(".").at(-1)?.toLowerCase()
  if (fileName.length > 180 || /[\p{Cc}\p{Cf}<>:"\/\\|?*]/u.test(fileName) || !/\.(pdf|docx|xlsx)$/i.test(fileName)) {
    throw new ApiError(415, invalidFile)
  }

  const content = Buffer.from(await file.arrayBuffer())
  const valid = ext === "pdf"
    ? /^%PDF-[12]\.\d/.test(content.toString("ascii", 0, 8)) && content.includes("%%EOF", Math.max(0, content.length - 1024))
    : isOfficeDocument(content, ext === "docx" ? "word/document.xml" : "xl/workbook.xml")
  if (!valid) throw new ApiError(415, invalidFile)

  return { fileName, size: content.length, content }
}
