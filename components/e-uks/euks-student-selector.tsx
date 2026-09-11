"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { EuksClassOption } from "@/lib/server-euks"
import type { EuksStudentOption } from "@/lib/euks"

type Props = {
  classes: EuksClassOption[]
  students: Array<EuksStudentOption & { classId: string }>
  selectedClassId: string
  selectedStudentId: string
}

/**
 * Class then student selector. Selection lives in the URL so the server
 * component can load the chosen student's data without client-side fetching.
 */
export function EuksStudentSelector({ classes, students, selectedClassId, selectedStudentId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const push = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/e-uks/pantauan-kesehatan?${params.toString()}`)
  }

  const visibleStudents = selectedClassId
    ? students.filter((student) => student.classId === selectedClassId)
    : students

  return (
    <div className="grid gap-3 sm:max-w-sm">
      <div className="grid gap-2">
        <Label htmlFor="euks-class">Kelas</Label>
        <Select
          value={selectedClassId}
          onValueChange={(value: string | null) => push({ classId: value, studentId: null })}
        >
          <SelectTrigger id="euks-class">
            <SelectValue placeholder="Pilih kelas" />
          </SelectTrigger>
          <SelectContent>
            {classes.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="euks-student">Nama</Label>
        <Select
          value={selectedStudentId}
          onValueChange={(value: string | null) => push({ studentId: value })}
          disabled={visibleStudents.length === 0}
        >
          <SelectTrigger id="euks-student">
            <SelectValue placeholder={selectedClassId ? "Pilih siswa" : "Pilih kelas terlebih dahulu"} />
          </SelectTrigger>
          <SelectContent>
            {visibleStudents.map((student) => (
              <SelectItem key={student.id} value={student.id}>
                {student.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
