"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PRESET_DELIMITERS = [",", ";", "\t", "|"] as const

function delimiterMode(delimiter: string): string {
  return PRESET_DELIMITERS.includes(delimiter as (typeof PRESET_DELIMITERS)[number])
    ? delimiter
    : "custom"
}

export function CsvDelimiterField({
  value,
  onChange,
  disabled = false,
  description = "Pilih delimiter yang sama dengan file CSV Anda.",
}: {
  value: string
  onChange: (delimiter: string) => void
  disabled?: boolean
  description?: string
}) {
  const mode = delimiterMode(value)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:flex-row sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="csv-delimiter">Pemisah kolom (delimiter)</Label>
        <Select
          value={mode}
          onValueChange={(nextValue) => onChange(nextValue === "custom" ? ":" : String(nextValue))}
          disabled={disabled}
        >
          <SelectTrigger id="csv-delimiter" className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=",">Koma (,)</SelectItem>
            <SelectItem value=";">Titik koma (;)</SelectItem>
            <SelectItem value="\t">Tab</SelectItem>
            <SelectItem value="|">Pipa (|)</SelectItem>
            <SelectItem value="custom">Karakter lain</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "custom" ? (
        <div className="space-y-1.5">
          <Label htmlFor="csv-custom-delimiter">Karakter delimiter</Label>
          <Input
            id="csv-custom-delimiter"
            aria-label="Karakter delimiter khusus"
            className="w-24 font-mono"
            value={value}
            maxLength={1}
            disabled={disabled}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const character = event.target.value.slice(-1)
              if (character && character !== '"' && character !== "\r" && character !== "\n") {
                onChange(character)
              }
            }}
          />
        </div>
      ) : null}
      <p className="pb-0.5 text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
