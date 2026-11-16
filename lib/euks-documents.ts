export const EUKS_DOCUMENT_READ_PERMISSIONS = [
  "euks.documents.read",
  "euks.shared_documents.read",
] as const

export const EUKS_DOCUMENT_CATEGORIES = ["SK", "Program Kerja", "Anggaran", "SOP", "Laporan", "Lainnya"] as const
export const EUKS_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
export const EUKS_DOCUMENT_ACCEPT = ".pdf,.docx,.xlsx"
export const EUKS_DOCUMENT_YEAR = /^20\d{2}\/20\d{2}$/

export type EuksDocumentItem = {
  id: string
  title: string
  category: string
  schoolYear: string
  shared: boolean
  fileName: string
  size: number
  version: number
}
