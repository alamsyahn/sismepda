"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export function WhatsAppReportCard({
  title,
  description,
  text,
}: {
  title: string
  description: string
  text: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function copyReport() {
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard tidak tersedia", {
        description: "Salin teks secara manual dari area preview.",
      })
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("Laporan berhasil disalin")
    } catch {
      toast.error("Laporan gagal disalin", {
        description: "Izinkan akses clipboard atau salin teks secara manual.",
      })
    }
  }

  return (
    <Card className="min-w-0 border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[32rem] min-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-muted/45 p-4 font-sans text-sm leading-6 text-foreground sm:p-5">
          {text}
        </pre>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={copyReport} className="w-full sm:w-auto">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Berhasil Disalin" : "Salin ke WhatsApp"}
        </Button>
      </CardFooter>
    </Card>
  )
}
