"use client"
import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

export type AttendanceDraft = { version: number; rows: { id: string; status: "H" | "S" | "I" | "A" | null; note: string }[]; dirty: boolean }
const DraftContext = createContext<Map<string, AttendanceDraft> | null>(null)
export function KesiswaanDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, AttendanceDraft>())
  useEffect(() => {
    const dirty = () => Array.from(drafts.values()).some(d => d.dirty)
    const unload = (e: BeforeUnloadEvent) => { if (dirty()) { e.preventDefault(); e.returnValue = "" } }
    const navigate = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest("a") : null
      if (!target || target.target === "_blank" || !dirty()) return
      const url = new URL(target.href, window.location.href)
      if (url.origin === window.location.origin && url.pathname.startsWith("/kesiswaan")) return
      if (!window.confirm("Ada draft presensi belum disimpan. Tetap meninggalkan modul?")) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true)
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true) }
  }, [drafts])
  return <DraftContext.Provider value={drafts}>{children}</DraftContext.Provider>
}
export function useKesiswaanDrafts() { const drafts = useContext(DraftContext); if (!drafts) throw new Error("Draft provider missing"); return drafts }
