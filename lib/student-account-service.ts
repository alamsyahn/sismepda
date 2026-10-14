import { studentAccountCreateSchema, type StudentAccountCreate } from "@/lib/student-account-schemas"

export class StudentAccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "StudentAccountError" }
}

export type StudentAccountResult = { id: string; name: string; email: string | null; active: boolean; studentId: string | null }
export type StudentAccountStudent = { id: string; name: string; active: boolean; gender: string | null; account: { id: string } | null }
export type StudentAccountRole = { id: string; key: string; isProtected: boolean; permissionKeys: string[] }
export type StudentAccountNew = StudentAccountCreate & { passwordHash: string; name: string; roleId: string; active: true; isTeacher: false; workbookSupervised: false; nip: null }
export type StudentAccountAudit = { actorId: string; userId: string; studentId: string; roleId: string; roleKey: string }
export interface StudentAccountStore {
  findStudent(id: string): Promise<StudentAccountStudent | null>
  findEmail(email: string): Promise<{ id: string } | null>
  findStudentRole(): Promise<StudentAccountRole | null>
  createAccount(input: Omit<StudentAccountNew, "password">): Promise<StudentAccountResult>
  audit(input: StudentAccountAudit): Promise<void>
}

/** Caller supplies one transaction; never update or attach an existing account. */
export async function provisionStudentAccount(
  input: unknown, actorId: string, store: StudentAccountStore,
  hashPassword: (password: string) => Promise<string>,
): Promise<StudentAccountResult> {
  const body = studentAccountCreateSchema.parse(input)
  const student = await store.findStudent(body.studentId)
  if (!student || !student.active || student.gender !== "PEREMPUAN") throw new StudentAccountError(404, "Siswi aktif tidak ditemukan")
  if (student.account) throw new StudentAccountError(409, "Siswa sudah memiliki akun")
  if (await store.findEmail(body.email)) throw new StudentAccountError(409, "Email sudah digunakan")
  const role = await store.findStudentRole()
  const required = ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own"]
  if (!role || role.key !== "siswa" || role.isProtected || role.permissionKeys.length !== required.length ||
      !required.every((key) => role.permissionKeys.includes(key))) {
    throw new StudentAccountError(503, "Konfigurasi role siswa di Pengaturan Akses harus memuat hanya euks.menstruation.read.own, euks.menstruation.create.own, dan euks.menstruation.update.own. Hubungi administrator sistem.")
  }
  const passwordHash = await hashPassword(body.password)
  const result = await store.createAccount({
    studentId: student.id, name: student.name, email: body.email, passwordHash,
    roleId: role.id, active: true, isTeacher: false, workbookSupervised: false, nip: null,
  })
  await store.audit({ actorId, userId: result.id, studentId: student.id, roleId: role.id, roleKey: role.key })
  return result
}
