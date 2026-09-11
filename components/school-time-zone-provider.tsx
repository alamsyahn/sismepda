"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  DEFAULT_SCHOOL_TIME_ZONE,
  formatSchoolTime,
  requireIanaTimeZone,
  schoolDateFromInstant,
  todayInSchoolTimeZone,
  type SchoolDate,
} from "@/lib/school-date"

type SchoolTimeZoneContextValue = {
  timeZone: string
  timeZoneLabel: string
  today: (now?: Date) => SchoolDate
  dateFromInstant: (instant: Date) => SchoolDate
  formatTime: (instant: Date, locale?: string) => string
}

const SchoolTimeZoneContext = createContext<SchoolTimeZoneContextValue | null>(null)

function shortTimeZoneLabel(timeZone: string): string {
  const part = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date()).find((item) => item.type === "timeZoneName")
  return part?.value ?? timeZone
}

export function SchoolTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string
  children?: ReactNode
}) {
  const value = useMemo<SchoolTimeZoneContextValue>(() => {
    const resolvedTimeZone = requireIanaTimeZone(timeZone)
    return {
      timeZone: resolvedTimeZone,
      timeZoneLabel: shortTimeZoneLabel(resolvedTimeZone),
      today: (now = new Date()) => todayInSchoolTimeZone(now, resolvedTimeZone),
      dateFromInstant: (instant) => schoolDateFromInstant(instant, resolvedTimeZone),
      formatTime: (instant, locale) => formatSchoolTime(instant, resolvedTimeZone, locale),
    }
  }, [timeZone])

  return <SchoolTimeZoneContext.Provider value={value}>{children}</SchoolTimeZoneContext.Provider>
}

export function useSchoolTimeZone(): SchoolTimeZoneContextValue {
  const value = useContext(SchoolTimeZoneContext)
  if (value) return value

  throw new Error("useSchoolTimeZone harus digunakan di dalam SchoolTimeZoneProvider")
}

export { DEFAULT_SCHOOL_TIME_ZONE }
