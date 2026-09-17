"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

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
    <Tabs value={tab} onValueChange={(value) => setTab(value as ScheduleTab)} className="gap-4">
      <div className="overflow-x-auto">
        <TabsList className="w-max">
          {tabs.map((item) => (
            <TabsTrigger key={item} value={item}>
              {SCHEDULE_TAB_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {tabs.includes("saya") ? (
        <TabsContent value="saya">
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
        <TabsContent value="kelas">
          <ClassScheduleTab classes={master.classes} days={profile.days} todayDay={todayDay} />
        </TabsContent>
      ) : null}

      {tabs.includes("jam-kosong") ? (
        <TabsContent value="jam-kosong">
          <FreeTeachersTab days={profile.days} current={now.current} todayDay={todayDay} />
        </TabsContent>
      ) : null}

      {tabs.includes("kelola") ? (
        <TabsContent value="kelola">
          <ManageScheduleTab
            capabilities={capabilities}
            master={master}
            days={profile.days}
            todayDay={todayDay}
          />
        </TabsContent>
      ) : null}

      {tabs.includes("waktu") ? (
        <TabsContent value="waktu">
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
