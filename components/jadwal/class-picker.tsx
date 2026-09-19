"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatClassShortName, groupClassesByGrade } from "@/lib/schedule-presentation"

export type PickableClass = { id: string; name: string; grade: string }

/**
 * Pemilih kelas untuk tab "Jadwal Kelas".
 *
 * Sengaja `Select`, BUKAN combobox yang dapat diketik. Satu sekolah hanya
 * punya puluhan kelas dengan nama sangat pendek ("7A"…"9I") yang sudah
 * terurut; kotak pencarian di atas daftar sependek itu hanya menambah satu
 * langkah sebelum pengguna dapat menunjuk kelas yang sudah terlihat. Guru
 * tidak perlu mengetik nama kelas.
 *
 * Nama ditampilkan RINGKAS lewat `formatClassShortName()`. Itu murni lapisan
 * tampilan: `value` setiap opsi tetap `SchoolClass.id`, sehingga penyaringan
 * jadwal dan relasinya tidak bergantung pada bentuk tulisan ini.
 *
 * Antar tingkat dipisahkan garis tipis, bukan judul "Tingkat VII": pada daftar
 * "7A…7I, 8A…8I" batas tingkatnya sudah terbaca dari angkanya sendiri, dan
 * judul kelompok hanya menambah tinggi daftar tanpa menambah informasi.
 *
 * Papan ketik, tetikus, dan sentuh mengikuti primitif `Select` Base UI —
 * tidak ada penanganan tombol buatan sendiri yang perilakunya menyimpang.
 */
export function ClassPicker({
  id,
  classes,
  value,
  onValueChange,
  placeholder = "Pilih kelas",
}: {
  id?: string
  classes: readonly PickableClass[]
  value: string
  onValueChange: (classId: string) => void
  placeholder?: string
}) {
  const groups = groupClassesByGrade(classes)
  const labelById = new Map(
    groups.flatMap((group) => group.classes.map((item) => [item.id, formatClassShortName(item)] as const)),
  )

  return (
    <Select
      value={value ? value : null}
      disabled={classes.length === 0}
      onValueChange={(next) => onValueChange(typeof next === "string" ? next : "")}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder}>
          {(selected: string) => labelById.get(selected) ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group, index) => (
          <div key={group.grade || `tingkat-${index}`}>
            {/* Pemisah HANYA antar kelompok: garis sebelum kelompok pertama
                akan tampak seperti padding atas yang timpang. */}
            {index > 0 ? <SelectSeparator /> : null}
            {group.classes.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {formatClassShortName(item)}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}
