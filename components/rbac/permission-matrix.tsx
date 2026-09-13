"use client"

import { useMemo } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { PermissionRow } from "@/lib/server-rbac-admin"

/**
 * Matriks permission per modul.
 *
 * "Pilih semua" memilih setiap key secara EKSPLISIT. Tidak ada wildcard yang
 * disimpan: notasi keluarga seperti `rbac.*` hanya metadata untuk menandai
 * sensitivitas, bukan grant runtime. Menyimpan wildcard akan membuat role
 * diam-diam memperoleh permission rilis mendatang.
 */
export function PermissionMatrix({
  catalog,
  selected,
  disabled,
  onChange,
}: {
  catalog: PermissionRow[]
  selected: Set<string>
  disabled?: boolean
  onChange: (next: Set<string>) => void
}) {
  const byModule = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>()
    for (const permission of catalog) {
      const list = groups.get(permission.module) ?? []
      list.push(permission)
      groups.set(permission.module, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])

  function toggle(key: string) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  function setModule(keys: string[], checked: boolean) {
    const next = new Set(selected)
    // Key ditulis satu per satu — inilah alasan tidak ada wildcard tersimpan.
    for (const key of keys) {
      if (checked) next.add(key)
      else next.delete(key)
    }
    onChange(next)
  }

  return (
    <div className="space-y-6">
      {byModule.map(([module, permissions]) => {
        const keys = permissions.map((permission) => permission.key)
        const allChecked = keys.every((key) => selected.has(key))

        return (
          <div key={module} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold capitalize">{module.replace(/_/g, " ")}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => setModule(keys, !allChecked)}
              >
                {allChecked ? "Kosongkan" : "Pilih semua"}
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {permissions.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 rounded-md border border-border/70 p-2 text-sm"
                >
                  <Checkbox
                    checked={selected.has(permission.key)}
                    disabled={disabled}
                    onCheckedChange={() => toggle(permission.key)}
                  />
                  <span className="space-y-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>{permission.label}</span>
                      {permission.sensitive ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Sensitif
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {permission.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
