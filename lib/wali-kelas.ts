export type Teacher = {
  id: string
  prefix: string
  nama: string
  nip: string
}

// Nama lengkap dengan prefix, mis. "Bpk. Ahmad Santoso".
export function teacherFullName(t: Teacher): string {
  return [t.prefix, t.nama].filter(Boolean).join(" ")
}

export type WaliKelasClass = {
  id: string
  name: string
}

// Daftar kelas (memakai data sekolah yang sudah ada: VII A - IX I).
