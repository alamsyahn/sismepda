"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"
import { SCAN_OUTCOMES, type ScanResult } from "@/lib/scan"

export type ScanFeedback = {
  id: number
  success: boolean
  title: string
  name?: string
  className?: string
  message?: string
}

export function attendanceFeedback(result: ScanResult): Omit<ScanFeedback, "id"> {
  const success = result.outcome === "PRESENT" || result.outcome === "REPEAT"
  return {
    success,
    title: result.outcome === "PRESENT" ? "Hadir tercatat" : (SCAN_OUTCOMES[result.outcome] ?? "Scan gagal"),
    name: result.student?.name,
    className: result.student?.className,
    message:
      result.outcome === "REPEAT"
        ? "Scan ulang dicatat"
        : result.outcome === "CONFLICT"
          ? `Status ${result.existingStatus ?? "kehadiran"} tetap dipertahankan. Hubungi petugas.`
          : undefined,
  }
}

export function ScanFeedbackPopup({ feedback, onDismiss }: { feedback: ScanFeedback | null; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => onDismiss(feedback.id), 800)
    return () => window.clearTimeout(timer)
  }, [feedback, onDismiss])

  if (!feedback) return null
  const Icon = feedback.success ? Check : X
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4">
      <div
        key={feedback.id}
        data-scan-feedback={feedback.success ? "success" : "error"}
        role={feedback.success ? "status" : "alert"}
        aria-atomic="true"
        className={`max-h-[calc(100dvh-2rem)] w-full max-w-[400px] overflow-y-auto rounded-[22px] px-6 py-7 text-center text-white shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100 sm:px-8 sm:py-8 ${feedback.success ? "bg-[#15803d]" : "bg-[#c62836]"}`}
      >
        <Icon aria-hidden="true" className="mx-auto mb-4 size-20 sm:size-[88px]" strokeWidth={3.5} />
        <p className="text-sm font-bold uppercase tracking-wider">{feedback.title}</p>
        {feedback.name && <p className="mt-3 break-words text-[25px] leading-tight font-bold sm:text-[27px]">{feedback.name}</p>}
        {feedback.className && <p className="mt-2 text-lg">Kelas {feedback.className}</p>}
        {feedback.message && <p className="mt-3 break-words text-sm leading-relaxed">{feedback.message}</p>}
      </div>
    </div>,
    document.body,
  )
}
