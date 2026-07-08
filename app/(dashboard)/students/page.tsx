import { requirePermission, hasPermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { createStudentAction } from "./actions";

type StudentsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function StudentsPage({ searchParams }: StudentsPageProps) {
  const user = await requirePermission("student.view");
  const params = await searchParams;

  const canCreateStudent = hasPermission(user, "student.create");
  const canUpdateStudent = hasPermission(user, "student.update");
  const canImportStudent = hasPermission(user, "student.import");

  const [students, classes, activeAcademicYear] = await Promise.all([
    prisma.student.findMany({
      include: {
        classEnrollments: {
          where: {
            status: "ACTIVE",
          },
          include: {
            schoolClass: {
              include: {
                academicYear: true,
              },
            },
          },
          orderBy: {
            startDate: "desc",
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    }),

    prisma.schoolClass.findMany({
      where: {
        academicYear: {
          isActive: true,
        },
      },
      include: {
        academicYear: true,
      },
      orderBy: [
        {
          gradeLevel: "asc",
        },
        {
          name: "asc",
        },
      ],
    }),

    prisma.academicYear.findFirst({
      where: {
        isActive: true,
      },
      orderBy: {
        startDate: "desc",
      },
    }),
  ]);

  const defaultStartDate = activeAcademicYear
    ? formatDateInput(activeAcademicYear.startDate)
    : formatDateInput(new Date());

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Data Siswa</h1>
        <p className="mt-2 text-slate-600">
          Daftar siswa yang terdaftar di SISMEPDA.
        </p>

        {canImportStudent && (
          <a
            href="/students/import"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Import CSV
          </a>
        )}
      </div>

      {params.success === "created" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Data siswa berhasil ditambahkan.
        </div>
      )}

      {params.success === "deleted" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Data siswa berhasil dihapus permanen.
        </div>
      )}

      {params.error === "invalid" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Data siswa tidak valid. Pastikan semua isian sudah benar.
        </div>
      )}

      {params.error === "duplicate" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Siswa dengan NIS atau NISN tersebut sudah ada.
        </div>
      )}

      {params.error === "class_not_found" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Kelas yang dipilih tidak ditemukan.
        </div>
      )}

      {canCreateStudent && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow">
          <h2 className="font-semibold text-slate-900">Tambah Siswa</h2>

          {classes.length === 0 ? (
            <p className="mt-3 text-sm text-red-600">
              Belum ada kelas aktif. Tambahkan kelas terlebih dahulu di menu Data
              Kelas.
            </p>
          ) : (
            <form
              action={createStudentAction}
              className="mt-4 grid gap-4 md:grid-cols-3"
            >
              <div>
                <label
                  htmlFor="nis"
                  className="text-sm font-medium text-slate-700"
                >
                  NIS
                </label>
                <input
                  id="nis"
                  name="nis"
                  type="text"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="contoh: 25006"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="nisn"
                  className="text-sm font-medium text-slate-700"
                >
                  NISN
                </label>
                <input
                  id="nisn"
                  name="nisn"
                  type="text"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="opsional"
                />
              </div>

              <div>
                <label
                  htmlFor="name"
                  className="text-sm font-medium text-slate-700"
                >
                  Nama Siswa
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="Nama lengkap"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="gender"
                  className="text-sm font-medium text-slate-700"
                >
                  Jenis Kelamin
                </label>
                <select
                  id="gender"
                  name="gender"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  required
                >
                  <option value="MALE">Laki-laki</option>
                  <option value="FEMALE">Perempuan</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="schoolClassId"
                  className="text-sm font-medium text-slate-700"
                >
                  Kelas Aktif
                </label>
                <select
                  id="schoolClassId"
                  name="schoolClassId"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  required
                >
                  {classes.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>
                      {schoolClass.name} - {schoolClass.academicYear.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="startDate"
                  className="text-sm font-medium text-slate-700"
                >
                  Tanggal Mulai Masuk Kelas
                </label>
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={defaultStartDate}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  required
                />
              </div>

              <div className="md:col-span-3">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
                >
                  Tambah Siswa
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Daftar Siswa</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">No</th>
                <th className="px-6 py-3 font-medium">NIS</th>
                <th className="px-6 py-3 font-medium">NISN</th>
                <th className="px-6 py-3 font-medium">Nama</th>
                <th className="px-6 py-3 font-medium">JK</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Kelas Aktif</th>
                <th className="px-6 py-3 font-medium">Tahun Pelajaran</th>
                <th className="px-6 py-3 font-medium">Mulai</th>
                <th className="px-6 py-3 font-medium">Aksi</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {students.map((student, index) => {
                const activeEnrollment = student.classEnrollments[0];

                return (
                  <tr key={student.id}>
                    <td className="px-6 py-3">{index + 1}</td>
                    <td className="px-6 py-3">{student.nis ?? "-"}</td>
                    <td className="px-6 py-3">{student.nisn ?? "-"}</td>
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {student.name}
                    </td>
                    <td className="px-6 py-3">
                      {student.gender === "MALE"
                        ? "L"
                        : student.gender === "FEMALE"
                          ? "P"
                          : "-"}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={
                          student.status === "ACTIVE"
                            ? "rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700"
                            : "rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                        }
                      >
                        {student.status}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {activeEnrollment?.schoolClass.name ?? "-"}
                    </td>
                    <td className="px-6 py-3">
                      {activeEnrollment?.schoolClass.academicYear.name ?? "-"}
                    </td>
                    <td className="px-6 py-3">
                      {activeEnrollment
                        ? formatDateInput(activeEnrollment.startDate)
                        : "-"}
                    </td>
                    <td className="px-6 py-3">
                      {canUpdateStudent ? (
                        <a
                          href={`/students/${student.id}/edit`}
                          className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          Edit
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}

              {students.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada data siswa.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}