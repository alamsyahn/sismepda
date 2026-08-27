"use client"

import { useMemo, useState } from "react"
import { BookMarked, Check, ExternalLink, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeWorkbookUrl } from "@/lib/workbook"

export type WorkbookLink = {
  workbookId: string
  number: number
  name: string
  url: string | null
}

function toFormState(links: WorkbookLink[]): Record<string, string> {
  return Object.fromEntries(links.map((link) => [link.workbookId, link.url ?? ""]))
}

export function WorkbookLinksCard({ initialLinks }: { initialLinks: WorkbookLink[] }) {
  const [links, setLinks] = useState(initialLinks)
  const [values, setValues] = useState(() => toFormState(initialLinks))
  const [saving, setSaving] = useState(false)

  const saved = useMemo(() => toFormState(links), [links])
  const dirty = useMemo(
    () => links.some((link) => (values[link.workbookId] ?? "").trim() !== (saved[link.workbookId] ?? "")),
    [links, values, saved],
  )

  async function save(event: React.FormEvent) {
    event.preventDefault()

    for (const link of links) {
      const raw = values[link.workbookId] ?? ""
      if (normalizeWorkbookUrl(raw) === undefined) {
        toast.error(`Tautan ${link.name} harus berupa URL http atau https yang valid`)
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch("/api/workbooks/links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          links: links.map((link) => ({ workbookId: link.workbookId, url: values[link.workbookId] ?? "" })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Tautan Buku Kerja gagal disimpan")
      setLinks(data.links)
      setValues(toFormState(data.links))
      toast.success("Tautan Buku Kerja tersimpan")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tautan Buku Kerja gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookMarked className="size-4 text-primary" />
          Link Buku Kerja
        </CardTitle>
        <CardDescription>
          Masukkan tautan Buku Kerja Anda. Pastikan tautan dapat diakses oleh tim Kurikulum.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={save}>
          <div className="grid gap-5 sm:grid-cols-2">
            {links.map((link) => {
              const value = values[link.workbookId] ?? ""
              const openable = normalizeWorkbookUrl(value)
              const inputId = `workbook-link-${link.number}`
              return (
                <div key={link.workbookId} className="space-y-1.5">
                  <Label htmlFor={inputId}>Link {link.name}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      type="url"
                      inputMode="url"
                      value={value}
                      maxLength={2048}
                      placeholder="https://..."
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [link.workbookId]: event.target.value }))
                      }
                    />
                    {openable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        render={
                          <a
                            href={openable}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Buka ${link.name} di tab baru`}
                          />
                        }
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {dirty ? (
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled aria-live="polite">
              <Check className="size-4" />
              Tersimpan
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
