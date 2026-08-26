"use client"

import { PenLine, Upload } from "lucide-react"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GuruInputForm } from "@/components/guru/guru-input-form"
import { GuruCsvUpload } from "@/components/guru/guru-csv-upload"

export default function GuruInputPage() {
  return (
    <PageContainer>
      <div className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <ol className="flex items-center gap-1.5">
            <li>Data Guru</li>
            <li aria-hidden>/</li>
            <li className="font-medium text-foreground">Input Guru</li>
          </ol>
        </nav>
        <PageHeading
          title="Input Data Guru"
          description="Tambahkan guru secara manual atau impor beberapa guru melalui file CSV"
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
          <GuruInputForm />
        </TabsContent>
        <TabsContent value="csv">
          <GuruCsvUpload />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
