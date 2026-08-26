"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ExportType } from "@/lib/export-data"

type ExportParams = Record<string, string | null | undefined>

export function exportHref(type: ExportType, params: ExportParams = {}): string {
  const search = new URLSearchParams({ type })
  Object.entries(params).forEach(([key, value]) => {
    if (value && value !== "all") search.set(key, value)
  })
  return `/api/export?${search.toString()}`
}

export function ExportButton({
  type,
  params,
  label = "Export CSV",
  className,
}: {
  type: ExportType
  params?: ExportParams
  label?: string
  className?: string
}) {
  return (
    <Button
      render={<a href={exportHref(type, params)} download />}
      variant="outline"
      className={className}
    >
      <Download className="size-4" />
      {label}
    </Button>
  )
}
