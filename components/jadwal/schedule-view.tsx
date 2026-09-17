"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarCog, CalendarDays, Clock3, School, Timer } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClassScheduleTab } from "@/components/jadwal/class-schedule-tab"
import { FreeTeachersTab } from "@/components/jadwal/free-teachers-tab"
import { ManageScheduleTab } from "@/components/jadwal/manage-schedule-tab"
import { MyScheduleTab } from "@/components/jadwal/my-schedule-tab"
import { TimeStructureTab } from "@/components/jadwal/time-structure-tab"
import {
  SCHEDULE_TAB_LABELS,
  visibleScheduleTabs,
  type ScheduleCapabilities,
  type ScheduleTab,
} from "@/lib/schedule-authorization"
import type { ScheduleDay } from "@/lib/schedule-constants"
import { cn } from "@/lib/utils"
import type {
  ScheduleMasterData,
  ScheduleNowContext,
  ScheduleTimeProfileView,
  ScheduleTimeTemplateView,
} from "@/lib/server-schedule"

/**
 * Kerangka modul Jadwal: satu halaman, beberapa tab.
 *
 * Data awal (profil waktu, konteks "sekarang", data master) dialirkan dari
 * server component supaya tab pertama tidak berkedip; tab lain mengambil
 * datanya sendiri saat dibuka.
 */
/**
 * Ikon per tab.
 *
 * Satu ikon per tab, bukan satu warna per tab: lima warna berbeda akan
 * membuat navigasi tampak seperti lima aplikasi terpisah. Ikon membantu
 * pengenalan, warna tetap satu — primary untuk tab aktif.
 */
const SCHEDULE_TAB_ICONS: Record<ScheduleTab, typeof CalendarDays> = {
  saya: CalendarDays,
  kelas: School,
  "jam-kosong": Clock3,
  kelola: CalendarCog,
  waktu: Timer,
}

/**
 * Penjaga tampilan panel tab.
 *
 * Base UI 1.6.0 menyisakan panel yang BARU DITINGGALKAN tetap ter-mount: ia
 * memberi atribut `inert`, tetapi tidak memberi `hidden`, sehingga isi tab
 * lama masih terbaca di bawah tab yang sedang dibuka. Efeknya dua panel
 * tampak sekaligus.
 *
 * `inert` adalah penanda paling tepercaya di sini (hanya panel non-aktif yang
 * memilikinya), jadi panel itu disembunyikan lewat CSS saja — tanpa menyentuh
 * komponen `components/ui/tabs.tsx` yang dipakai modul lain.
 */
const TAB_PANEL_CLASS = "[&[inert]]:hidden"

export function ScheduleView({
  viewerId,
  viewerIsTeacher,
  capabilities,
  profile,
  templates,
  now,
  master,
}: {
  viewerId: string
  viewerIsTeacher: boolean
  capabilities: ScheduleCapabilities
  profile: ScheduleTimeProfileView
  templates: readonly ScheduleTimeTemplateView[]
  now: ScheduleNowContext
  master: ScheduleMasterData
}) {
  const router = useRouter()
  const [, startRefresh] = useTransition()
  const tabs = visibleScheduleTabs(capabilities)
  const [tab, setTab] = useState<ScheduleTab>(tabs[0] ?? "saya")

  if (tabs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Anda belum memiliki izin untuk melihat bagian mana pun dari modul Jadwal.
      </p>
    )
  }

  const todayDay: ScheduleDay | null = now.todayDay

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ScheduleTab)} className="gap-5">
      {/* Mobile menggeser mendatar daripada mengecilkan label sampai terpotong. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="h-auto w-max gap-1 bg-muted/60 p-1">
          {tabs.map((item) => {
            const Icon = SCHEDULE_TAB_ICONS[item]
            return (
              <TabsTrigger
                key={item}
                value={item}
                className={cn(
                  "h-9 gap-2 rounded-md px-3 text-sm transition-colors duration-150",
                  "data-active:bg-primary/10 data-active:font-semibold data-active:text-primary",
                  "data-active:shadow-none dark:data-active:bg-primary/15",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {SCHEDULE_TAB_LABELS[item]}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </div>

      {tabs.includes("saya") ? (
        <TabsContent value="saya" className={TAB_PANEL_CLASS}>
          <MyScheduleTab
            viewerId={viewerId}
            viewerIsTeacher={viewerIsTeacher}
            canPickTeacher={capabilities.teacherRead}
            teachers={master.teachers}
            todayDay={todayDay}
          />
        </TabsContent>
      ) : null}

      {tabs.includes("kelas") ? (
        <TabsContent value="kelas" className={TAB_PANEL_CLASS}>
          <ClassScheduleTab
            classes={master.classes}
            days={profile.days}
            todayDay={todayDay}
            current={now.current}
          />
        </TabsContent>
      ) : null}

      {tabs.includes("jam-kosong") ? (
        <TabsContent value="jam-kosong" className={TAB_PANEL_CLASS}>
          <FreeTeachersTab days={profile.days} current={now.current} todayDay={todayDay} />
        </TabsContent>
      ) : null}

      {tabs.includes("kelola") ? (
        <TabsContent value="kelola" className={TAB_PANEL_CLASS}>
          <ManageScheduleTab
            capabilities={capabilities}
            master={master}
            days={profile.days}
            todayDay={todayDay}
          />
        </TabsContent>
      ) : null}

      {tabs.includes("waktu") ? (
        <TabsContent value="waktu" className={TAB_PANEL_CLASS}>
          <TimeStructureTab
            profile={profile}
            templates={templates}
            canManage={capabilities.timeManage}
            // Struktur waktu dipakai hampir semua tab lain, jadi setiap mutasi
            // harus memuat ulang server component induknya. Tanpa ini layar
            // tetap menampilkan nilai lama sampai peramban di-refresh manual.
            onSaved={() => startRefresh(() => router.refresh())}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
