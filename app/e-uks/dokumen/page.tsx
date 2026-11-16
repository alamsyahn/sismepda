import Link from "next/link"

import { EuksDocumentEditor } from "@/components/e-uks/euks-document-editor"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  EUKS_DOCUMENT_CATEGORIES,
  EUKS_DOCUMENT_READ_PERMISSIONS,
  EUKS_DOCUMENT_YEAR,
} from "@/lib/euks-documents"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const pageSize = 30
const path = "/e-uks/dokumen"
const sizeFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 })

export default async function EuksDocumentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePageAnyPermission(EUKS_DOCUMENT_READ_PERMISSIONS)
  const [canReadAll, canManage, params] = await Promise.all([
    pageCan("euks.documents.read"),
    pageCan("euks.documents.manage"),
    searchParams,
  ])
  const editable = canReadAll && canManage
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 160) : ""
  const category = EUKS_DOCUMENT_CATEGORIES.find(item => item === params.category) ?? ""
  const schoolYear = typeof params.year === "string" && EUKS_DOCUMENT_YEAR.test(params.year) ? params.year : ""
  const requestedPage = typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1

  const visibility = canReadAll ? {} : { shared: true }
  const where = {
    ...visibility,
    ...(query ? { title: { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const } } : {}),
    ...(category ? { category } : {}),
    ...(schoolYear ? { schoolYear } : {}),
  }
  const [years, count] = await Promise.all([
    prisma.euksDocument.groupBy({ by: ["schoolYear"], where: visibility, orderBy: { schoolYear: "desc" } }),
    prisma.euksDocument.count({ where }),
  ])
  const lastPage = Math.max(1, Math.ceil(count / pageSize))
  const page = Math.min(requestedPage, lastPage)
  const documents = await prisma.euksDocument.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true, title: true, category: true, schoolYear: true, shared: true,
      fileName: true, size: true, version: true,
    },
  })

  function pageHref(number: number) {
    const search = new URLSearchParams({ page: String(number) })
    if (query) search.set("q", query)
    if (category) search.set("category", category)
    if (schoolYear) search.set("year", schoolYear)
    return path + "?" + search
  }

  return (
    <PageContainer>
      <PageHeading title="Dokumen UKS" description="Arsip SK, program kerja, anggaran, SOP, dan laporan kegiatan UKS." />
      {editable && (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Tambah dokumen</summary>
          <EuksDocumentEditor />
        </details>
      )}

      <form action={path} className="grid items-end gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Cari judul</span>
          <Input type="search" name="q" defaultValue={query} maxLength={160} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Kategori</span>
          <select name="category" defaultValue={category} className="h-9 w-full rounded-md border border-input bg-background px-3">
            <option value="">Semua kategori</option>
            {EUKS_DOCUMENT_CATEGORIES.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Tahun ajaran</span>
          <select name="year" defaultValue={schoolYear} className="h-9 w-full rounded-md border border-input bg-background px-3">
            <option value="">Semua tahun</option>
            {schoolYear && !years.some(row => row.schoolYear === schoolYear) && <option>{schoolYear}</option>}
            {years.map(row => <option key={row.schoolYear}>{row.schoolYear}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit">Terapkan</Button>
          <Link href={path} className={buttonVariants({ variant: "ghost" })}>Reset</Link>
        </div>
      </form>

      {documents.length ? (
        <ul className="divide-y rounded-lg border bg-card">
          {documents.map(document => (
            <li key={document.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 break-words">
                  <h2 className="font-semibold">{document.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {document.category} · {document.schoolYear} · {document.shared ? "Dibagikan" : "Internal UKS"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {document.fileName} · {sizeFormat.format(document.size / 1024)} KB
                  </p>
                </div>
                <a href={"/api/e-uks/documents/" + document.id} download
                  className={buttonVariants({ variant: "outline", size: "sm" })}>Unduh</a>
              </div>
              {editable && (
                <details key={document.version} className="mt-3">
                  <summary className="w-fit cursor-pointer text-sm font-medium">Edit dokumen</summary>
                  <EuksDocumentEditor document={document} />
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {query || category || schoolYear ? "Tidak ada dokumen yang cocok." : "Belum ada dokumen."}
        </p>
      )}

      {lastPage > 1 && (
        <nav aria-label="Halaman dokumen" className="flex flex-wrap items-center gap-3 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline" })}>Sebelumnya</Link>}
          <span>Halaman {page} dari {lastPage}</span>
          {page < lastPage && <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline" })}>Berikutnya</Link>}
        </nav>
      )}
    </PageContainer>
  )
}
