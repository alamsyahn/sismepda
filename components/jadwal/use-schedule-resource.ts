"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Pengambilan data klien untuk modul Jadwal.
 *
 * Satu tempat supaya setiap tab memperlakukan loading, error, dan pembatalan
 * permintaan basi dengan cara yang sama. Permintaan lama yang datang terlambat
 * tidak boleh menimpa hasil filter terbaru — itu membuat tabel menampilkan hari
 * atau kelas yang sudah tidak dipilih lagi.
 */
export type ScheduleRequestState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

export async function scheduleFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Permintaan gagal diproses"
    throw new Error(message)
  }
  return payload as T
}

export function useScheduleResource<T>(url: string | null): ScheduleRequestState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    if (!url) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    const ticket = ++latest.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    scheduleFetch<T>(url, { signal: controller.signal })
      .then((payload) => {
        if (ticket !== latest.current) return
        setData(payload)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || ticket !== latest.current) return
        setData(null)
        setError(cause instanceof Error ? cause.message : "Permintaan gagal diproses")
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false)
      })

    return () => controller.abort()
  }, [url, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload }
}
