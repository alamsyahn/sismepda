import { requirePagePermission } from "@/lib/page-guards"
import { readStudentAccountRoster } from "@/lib/student-account-server"
import { StudentAccountManager } from "@/components/students/student-account-manager"

export default async function StudentAccountsPage() {
  await requirePagePermission("students.accounts.manage")
  const students = await readStudentAccountRoster()
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">Akun Siswa</h1><p className="text-muted-foreground">Pembuatan akun pribadi yang ditautkan ke data siswa.</p></div><StudentAccountManager students={students} /></div>
}
