"use client"

/**
 * Editor template pesan WhatsApp.
 *
 * MENGAPA KOMPONEN TERPISAH
 *
 * `whatsapp-panel.tsx` sudah panjang dan menangani koneksi, tujuan, jadwal,
 * serta riwayat. Editor template berdiri sendiri karena keadaannya tidak
 * bersinggungan dengan hal-hal itu: ia hanya menyunting teks milik satu jenis
 * pesan.
 *
 * CLIENT-SAFE: seluruh impornya modul murni. Tidak ada `lib/server-*` di sini,
 * sehingga tidak ada Prisma yang tertarik ke bundel klien.
 *
 * PRATINJAU TIDAK MENGIRIM APA PUN. Ia dirender di browser dengan data contoh;
 * tidak ada permintaan jaringan, apalagi jalur menuju WhatsApp.
 */
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SAMPLE_CONTEXT } from "@/lib/whatsapp-template-sample"
import {
  COLLECTION_LABELS,
  ITEM_PLACEHOLDERS,
  SEPARATOR_LABELS,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  collectionsFor,
  isItemSeparator,
  placeholderGroups,
  renderTemplate,
  templateErrorMessage,
  validateTemplate,
  type ItemSeparator,
  type WhatsAppCollectionKey,
  type WhatsAppTemplateKey,
  type WhatsAppTemplateSet,
} from "@/lib/whatsapp-template"

type Props = {
  type: string
  templates: WhatsAppTemplateSet
  /** Kondisi yang benar-benar tersimpan; sisanya masih memakai bawaan. */
  customized: readonly WhatsAppTemplateKey[]
  disabled: boolean
  onSaved: () => void
}

export function WhatsAppTemplateEditor({
  type,
  templates,
  customized,
  disabled,
  onSaved,
}: Props) {
  const [active, setActive] = useState<WhatsAppTemplateKey>("MISSING_PENDING")
  const [draft, setDraft] = useState<WhatsAppTemplateSet>(templates)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const template = draft[active]
  const errors = useMemo(() => validateTemplate(active, template), [active, template])
  const collections = collectionsFor(active)

  // Pratinjau tetap dirender walaupun template belum sah, tetapi hanya bila
  // kesalahannya bukan pada struktur — placeholder tak dikenal sengaja
  // dibiarkan terlihat apa adanya supaya admin melihat persis di mana salahnya.
  const preview = useMemo(() => {
    try {
      return renderTemplate(active, template, SAMPLE_CONTEXT)
    } catch {
      return ""
    }
  }, [active, template])

  function updateBody(body: string) {
    setDraft((current) => ({ ...current, [active]: { ...current[active], body } }))
  }

  function updateItem(
    collection: WhatsAppCollectionKey,
    changes: Partial<{ format: string; separator: ItemSeparator }>,
  ) {
    setDraft((current) => {
      const existing = current[active].items[collection] ?? {
        format: "",
        separator: "NEWLINE" as ItemSeparator,
      }
      return {
        ...current,
        [active]: {
          ...current[active],
          items: { ...current[active].items, [collection]: { ...existing, ...changes } },
        },
      }
    })
  }

  /**
   * Menyisipkan placeholder pada posisi kursor.
   *
   * Menyisipkan jauh lebih berguna daripada menyalin: admin tidak perlu
   * berpindah aplikasi, dan nama variabel tidak pernah salah ketik.
   */
  function insertPlaceholder(name: string) {
    const element = bodyRef.current
    const token = `{{${name}}}`
    if (!element) {
      updateBody(`${template.body}${token}`)
      return
    }
    const start = element.selectionStart ?? template.body.length
    const end = element.selectionEnd ?? start
    const next = `${template.body.slice(0, start)}${token}${template.body.slice(end)}`
    updateBody(next)
    // Kursor dikembalikan ke belakang token agar admin dapat langsung mengetik.
    requestAnimationFrame(() => {
      element.focus()
      const caret = start + token.length
      element.setSelectionRange(caret, caret)
    })
  }

  async function save() {
    if (errors.length > 0) {
      toast.error(templateErrorMessage(errors[0]))
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "templates", type, templates: draft }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(payload.message ?? "Template gagal disimpan.")
        return
      }
      toast.success("Template pesan disimpan.")
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function resetAll() {
    // Konfirmasi karena tindakan ini membuang seluruh teks yang pernah disusun
    // admin untuk jenis pesan ini, bukan hanya yang sedang terbuka.
    if (!window.confirm("Kembalikan SEMUA template jenis pesan ini ke bawaan?")) return
    setSaving(true)
    try {
      const response = await fetch("/api/whatsapp/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "templates", type, templates: null }),
      })
      if (!response.ok) {
        toast.error("Template gagal dikembalikan.")
        return
      }
      toast.success("Template dikembalikan ke bawaan.")
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TEMPLATE_KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={key === active ? "default" : "outline"}
            onClick={() => setActive(key)}
          >
            {TEMPLATE_LABELS[key]}
            {customized.includes(key) ? null : (
              <span className="ml-1 text-xs opacity-70">(bawaan)</span>
            )}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{TEMPLATE_DESCRIPTIONS[active]}</p>

      <div className="space-y-1">
        <p className="text-sm font-medium">Isi pesan</p>
        <textarea
          ref={bodyRef}
          className="min-h-40 w-full rounded-md border bg-transparent p-2 font-mono text-sm"
          value={template.body}
          disabled={disabled}
          onChange={(event) => updateBody(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Variabel tersedia</p>
        {placeholderGroups(active).map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="text-xs text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-1">
              {group.entries.map((entry) => (
                <Button
                  key={entry.name}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  title={entry.description}
                  onClick={() => insertPlaceholder(entry.name)}
                >
                  {`{{${entry.name}}}`}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {collections.map((collection) => {
        const item = template.items[collection]
        return (
          <div key={collection} className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              Format setiap item — {COLLECTION_LABELS[collection]}
            </p>
            <textarea
              className="min-h-16 w-full rounded-md border bg-transparent p-2 font-mono text-sm"
              value={item?.format ?? ""}
              disabled={disabled}
              onChange={(event) => updateItem(collection, { format: event.target.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Pemisah antar-item</span>
              <Select
                value={item?.separator ?? "NEWLINE"}
                disabled={disabled}
                onValueChange={(value) => {
                  if (isItemSeparator(value)) updateItem(collection, { separator: value })
                }}
              >
                <SelectTrigger className="w-56">
                  {/* Label ditulis eksplisit; SelectValue tanpa anak akan
                      menampilkan nilai mentah seperti BLANK_LINE. */}
                  <SelectValue>{SEPARATOR_LABELS[item?.separator ?? "NEWLINE"]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SEPARATOR_LABELS) as ItemSeparator[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {SEPARATOR_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Variabel item — hanya berlaku di dalam kotak ini
              </p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(ITEM_PLACEHOLDERS[collection]).map(([name, description]) => (
                  <Badge key={name} variant="outline" title={description as string}>
                    {`{{${name}}}`}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )
      })}

      {errors.length > 0 ? (
        <ul className="space-y-1 text-sm text-destructive">
          {errors.map((error, index) => (
            <li key={index}>{templateErrorMessage(error)}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1">
        <p className="text-sm font-medium">Pratinjau — data contoh</p>
        <p className="text-xs text-muted-foreground">
          Angka dan nama di bawah adalah contoh, bukan data hari ini. Pratinjau tidak
          mengirim pesan apa pun.
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border p-3 text-sm">
          {preview}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={disabled || saving || errors.length > 0}>
          Simpan template
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={resetAll}
          disabled={disabled || saving}
        >
          Kembalikan ke template bawaan
        </Button>
      </div>
    </div>
  )
}
