"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { SidebarNav } from "./sidebar-nav"

// Rute yang memakai layout autentikasi tersendiri (tanpa sidebar & topbar).
const BARE_ROUTES = ["/login"]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  if (BARE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return <>{children}</>
  }

  return (
    <div className="min-h-svh bg-background lg:flex">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu navigasi</SheetTitle>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Buka menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              S
            </span>
            <span className="font-semibold text-foreground">SISMEPDA</span>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
