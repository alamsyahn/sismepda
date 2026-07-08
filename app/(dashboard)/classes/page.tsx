import { requirePermission, hasPermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { createClassAction } from "./actions";

type ClassesPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function ClassesPage({ searchParams }: ClassesPageProps) {
  const user = await requirePermission("class.view");
  const params = await searchParams;

  const canCreateClass = hasPermission(user, "class.create");

  const [classes, academicYears] = await Promise.all([
    prisma.schoolClass.findMany({
      include: {
        academicYear: true,
        homeroomTeacher: true,
        classEnrollments: {
          where: {
            status: "ACTIVE",
          },
        },
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

    prisma.academicYear.findMany({
      orderBy: {
        startDate: "desc",
      },
    }),
  ]);

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Data Kelas</h1>
        <p className="mt-2 text-slate-600">
          Daftar kelas/rombel yang terdaftar di SISMEPDA.
        </p>
      </div>

      {params.success === "created" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Data kelas berhasil ditambahkan.
        </div>
      )}

      {params.error === "invalid" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Data kelas tidak valid. Pastikan semua isian sudah benar.
        </div>
      )}

      {params.error === "duplicate" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Kelas dengan nama dan tahun pelajaran tersebut sudah ada.
        </div>
      )}

      {canCreateClass && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow">
          <h2 className="font-semibold text-slate-900">Tambah Kelas</h2>

          <form action={createClassAction} className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <label
                htmlFor="name"
                className="text-sm font-medium text-slate-700"
              >
                Nama Kelas
              </label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder="contoh: VII C"
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              />
            </div>

            <div>
              <label
                htmlFor="gradeLevel"
                className="text-sm font-medium text-slate-700"
              >
                Tingkat
              </label>
              <select
                id="gradeLevel"
                name="gradeLevel"
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              >
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="academicYearId"
                className="text-sm font-medium text-slate-700"
              >
                Tahun Pelajaran
              </label>
              <select
                id="academicYearId"
                name="academicYearId"
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              >
                {academicYears.map((academicYear) => (
                  <option key={academicYear.id} value={academicYear.id}>
                    {academicYear.name}
                    {academicYear.isActive ? " - Aktif" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
              >
                Tambah Kelas
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Daftar Kelas</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">No</th>
                <th className="px-6 py-3 font-medium">Nama Kelas</th>
                <th className="px-6 py-3 font-medium">Tingkat</th>
                <th className="px-6 py-3 font-medium">Tahun Pelajaran</th>
                <th className="px-6 py-3 font-medium">Wali Kelas</th>
                <th className="px-6 py-3 font-medium">Jumlah Siswa Aktif</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {classes.map((schoolClass, index) => (
                <tr key={schoolClass.id}>
                  <td className="px-6 py-3">{index + 1}</td>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {schoolClass.name}
                  </td>
                  <td className="px-6 py-3">{schoolClass.gradeLevel}</td>
                  <td className="px-6 py-3">{schoolClass.academicYear.name}</td>
                  <td className="px-6 py-3">
                    {schoolClass.homeroomTeacher?.name ?? "-"}
                  </td>
                  <td className="px-6 py-3">
                    {schoolClass.classEnrollments.length}
                  </td>
                </tr>
              ))}

              {classes.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada data kelas.
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