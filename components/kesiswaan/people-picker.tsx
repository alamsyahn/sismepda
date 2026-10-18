"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"

/** Keeps selected IDs independent of the search results, including historical people. */
export function PeoplePicker({
  name,
  label,
  options,
  initial,
  multiple,
  onSelectionChange,
}: {
  name: string
  label: string
  options: { value: string; label: string }[]
  initial: string[]
  multiple: boolean
  onSelectionChange: () => void
}) {
  const [selected, setSelected] = useState(initial),
    [query, setQuery] = useState("")
  const matches = options.filter((o) =>
    o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  return (
    <div role="group" aria-label={label} className="rounded-lg border bg-background p-3">
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="mb-2 flex flex-wrap gap-2">
        {selected.map((id) => (
          <Button
            key={id}
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Hapus pilihan ${options.find((o) => o.value === id)?.label ?? id}`}
            onClick={() => {
              setSelected((ids) => ids.filter((v) => v !== id))
              onSelectionChange()
            }}
          >
            {options.find((o) => o.value === id)?.label ?? id} ×
          </Button>
        ))}
      </div>
      <input
        type="search"
        aria-label={`Cari ${label}`}
        placeholder="Cari nama, kelas atau nomor induk…"
        className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="my-2 text-xs text-muted-foreground" aria-live="polite">
        {selected.length} dipilih · {matches.length} hasil
        {matches.length > 20 ? " (20 pertama, persempit pencarian)" : ""}
      </p>
      <div className="max-h-52 space-y-1 overflow-y-auto">
        {matches.slice(0, 20).map((o) => (
          <label
            key={o.value}
            className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
          >
            <input
              type={multiple ? "checkbox" : "radio"}
              name={`pick-${name}`}
              checked={selected.includes(o.value)}
              onChange={() => {
                setSelected((ids) =>
                  multiple
                    ? ids.includes(o.value)
                      ? ids.filter((id) => id !== o.value)
                      : [...ids, o.value]
                    : [o.value],
                )
                onSelectionChange()
                if (!multiple) setQuery("")
              }}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
