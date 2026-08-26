"use client"

import { PenLine, Upload } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ManualInputForm } from "@/components/siswa/manual-input-form"
import { CsvUpload } from "@/components/siswa/csv-upload"

export default function SiswaInputPage() {
  return (
    <PageContainer>
      <div className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex items-center gap-1.5">
            <li>Data Siswa</li>
            <li aria-hidden>/</li>
            <li className="font-medium text-foreground">Input Siswa</li>
          </ol>
        </nav>
        <PageHeading
          title="Input Data Siswa"
          description="Tambahkan siswa secara manual atau impor beberapa siswa melalui file CSV"
        />
      </div>

      <Tabs defaultValue="manual" className="gap-4">
        <TabsList>
          <TabsTrigger value="manual">
            <PenLine className="size-4" />
            Input Manual
          </TabsTrigger>
          <TabsTrigger value="csv">
            <Upload className="size-4" />
            Upload CSV
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <ManualInputForm />
        </TabsContent>
        <TabsContent value="csv">
          <CsvUpload />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
