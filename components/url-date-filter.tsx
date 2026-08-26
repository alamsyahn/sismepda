"use client"

import { usePathname, useRouter } from "next/navigation"
import { DateFilter } from "@/components/date-filter"

export function UrlDateFilter({ value, ariaLabel }: { value: string; ariaLabel?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  return <DateFilter value={value} ariaLabel={ariaLabel} onChange={(date) => router.replace(`${pathname}?date=${date}`)} />
}
