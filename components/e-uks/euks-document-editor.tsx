"use client"

import { useId, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  EUKS_DOCUMENT_ACCEPT,
  EUKS_DOCUMENT_CATEGORIES,
  EUKS_DOCUMENT_MAX_BYTES,
  type EuksDocumentItem,
} from "@/lib/euks-documents"

const endpoint = "/api/e-uks/documents"
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

export function EuksDocumentEditor({ document }: { document?: EuksDocumentItem }) {
  const router = useRouter()
  const fields = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const url = document ? endpoint + "/" + document.id : endpoint

  async function mutate(method: "POST" | "PATCH" | "DELETE", form?: HTMLFormElement) {
    setError("")
    const data = form ? new FormData(form) : undefined
    const file = data?.get("file")
    if (file instanceof File && file.size > EUKS_DOCUMENT_MAX_BYTES) {
      setError("Ukuran berkas maksimal 5 MB.")
      return
    }
    const target = method === "DELETE" ? url + "?version=" + document?.version : url
    if (document) data?.set("version", String(document.version))
    setBusy(true)
    try {
      const response = await fetch(target, { method, body: data })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? "Perubahan gagal disimpan. Coba lagi.")
      }
      form?.reset()
      const details = form?.closest("details")
      if (details) details.open = false
      toast.success(method === "DELETE" ? "Dokumen dihapus." : "Dokumen disimpan.")
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Perubahan gagal disimpan. Coba lagi.")
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void mutate(document ? "PATCH" : "POST", event.currentTarget)
  }

  return (
    <form method="post" action={url} encType="multipart/form-data" onSubmit={submit} className="mt-4 space-y-4" aria-busy={busy}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={fields + "-title"} className="space-y-1 text-sm sm:col-span-2">
          <span className="font-medium">Judul dokumen</span>
          <Input id={fields + "-title"} name="title" defaultValue={document?.title} maxLength={160} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Kategori</span>
          <select className={selectClass} name="category" defaultValue={document?.category ?? ""} required>
            <option value="" disabled>Pilih kategori</option>
            {EUKS_DOCUMENT_CATEGORIES.map(category => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label htmlFor={fields + "-year"} className="space-y-1 text-sm">
          <span className="font-medium">Tahun ajaran</span>
          <Input id={fields + "-year"} name="schoolYear" placeholder="2026/2027" maxLength={9}
            pattern="20[0-9]{2}/20[0-9]{2}" defaultValue={document?.schoolYear} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Akses</span>
          <select className={selectClass} name="visibility" defaultValue={document?.shared ? "shared" : "internal"}>
            <option value="internal">Internal UKS</option>
            <option value="shared">Bagikan kepada pemegang izin baca</option>
          </select>
        </label>
        <label htmlFor={fields + "-file"} className="space-y-1 text-sm">
          <span className="font-medium">{document ? "Ganti berkas (opsional)" : "Berkas"}</span>
          <Input id={fields + "-file"} name="file" type="file" accept={EUKS_DOCUMENT_ACCEPT}
            aria-describedby={fields + "-formats"} required={!document} />
          <span id={fields + "-formats"} className="block text-muted-foreground">PDF, DOCX, atau XLSX, maksimal 5 MB.</span>
        </label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Memproses…" : document ? "Simpan perubahan" : "Unggah dokumen"}</Button>
        {document && (
          <Button type="button" variant="destructive" disabled={busy} onClick={() => {
            if (window.confirm(`Hapus “${document.title}”?`)) void mutate("DELETE")
          }}>Hapus dokumen</Button>
        )}
      </div>
    </form>
  )
}
