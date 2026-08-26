"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PrefixComboboxProps = {
  id?: string
  value: string
  options: string[]
  onChange: (value: string) => void
  onAddOption: (value: string) => void
  placeholder?: string
}

export function PrefixCombobox({
  id,
  value,
  options,
  onChange,
  onAddOption,
  placeholder = "Pilih atau masukkan prefix",
}: PrefixComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  // Tutup dropdown saat klik di luar komponen.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const trimmed = query.trim()
  const filtered = trimmed
    ? options.filter((o) => o.toLowerCase().includes(trimmed.toLowerCase()))
    : options
  const canAdd =
    trimmed.length > 0 && !options.some((o) => o.toLowerCase() === trimmed.toLowerCase())

  function commit(next: string) {
    onChange(next)
    setQuery("")
    setOpen(false)
  }

  function addNew() {
    if (!canAdd) return
    onAddOption(trimmed)
    commit(trimmed)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : value}
        onFocus={() => {
          setOpen(true)
          setQuery("")
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (canAdd) addNew()
            else if (filtered.length > 0) commit(filtered[0])
          } else if (e.key === "Escape") {
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
            {filtered.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt}
                  onClick={() => commit(opt)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    value === opt && "bg-accent/60",
                  )}
                >
                  <span>{opt}</span>
                  {value === opt ? <Check className="size-4 text-primary" /> : null}
                </button>
              </li>
            ))}

            {canAdd ? (
              <li>
                <button
                  type="button"
                  onClick={addNew}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-accent"
                >
                  <Plus className="size-4" />
                  Tambah &ldquo;{trimmed}&rdquo;
                </button>
              </li>
            ) : null}

            {filtered.length === 0 && !canAdd ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">Tidak ada pilihan</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
