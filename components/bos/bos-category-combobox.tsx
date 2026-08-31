"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { categorySlug, type BosCategoryOption } from "@/lib/bos"

type CategoryComboboxProps = {
  id?: string
  value: string
  categories: BosCategoryOption[]
  canCreate: boolean
  onChange: (categoryId: string) => void
  /** Creates the category server-side and returns it, so it can be selected at once. */
  onCreate: (name: string) => Promise<BosCategoryOption | null>
  placeholder?: string
}

/**
 * Searchable category picker with an inline "+ Tambah kategori baru" affordance,
 * so a new category never forces the user out of the entry form.
 */
export function BosCategoryCombobox({
  id,
  value,
  categories,
  canCreate,
  onChange,
  onCreate,
  placeholder = "Pilih kategori",
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const selected = categories.find((category) => category.id === value)
  const trimmed = query.trim()
  // Inactive categories stay selectable only when they are already the value.
  const selectable = categories.filter((category) => category.active || category.id === value)
  const filtered = trimmed
    ? selectable.filter((category) => category.name.toLowerCase().includes(trimmed.toLowerCase()))
    : selectable
  const canAdd =
    canCreate &&
    trimmed.length >= 2 &&
    !categories.some((category) => categorySlug(category.name) === categorySlug(trimmed))

  function commit(categoryId: string) {
    onChange(categoryId)
    setQuery("")
    setOpen(false)
  }

  async function addNew() {
    if (!canAdd || creating) return
    setCreating(true)
    try {
      const created = await onCreate(trimmed)
      if (created) commit(created.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : selected?.name ?? ""}
        onFocus={() => {
          setOpen(true)
          setQuery("")
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            if (filtered.length > 0) commit(filtered[0].id)
            else if (canAdd) void addNew()
          } else if (event.key === "Escape") {
            setOpen(false)
          }
        }}
        className="pr-9"
      />
      <ChevronsUpDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />

      {open ? (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <ul className="max-h-56 overflow-y-auto" role="listbox">
            {filtered.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === category.id}
                  onClick={() => commit(category.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    value === category.id && "bg-accent/60",
                  )}
                >
                  <span className="truncate">
                    {category.name}
                    {category.active ? "" : " · nonaktif"}
                  </span>
                  {value === category.id ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            ))}

            {canAdd ? (
              <li>
                <button
                  type="button"
                  onClick={() => void addNew()}
                  disabled={creating}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Tambah kategori baru &ldquo;{trimmed}&rdquo;
                </button>
              </li>
            ) : null}

            {filtered.length === 0 && !canAdd ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">
                {categories.length === 0 ? "Belum ada kategori" : "Tidak ada kategori yang cocok"}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
