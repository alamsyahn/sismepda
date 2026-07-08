import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { importStudentsCsvAction } from "./actions";

type ImportStudentsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    logId?: string;
  }>;
};

export default async function ImportStudentsPage({
  searchParams,
}: ImportStudentsPageProps) {
  await requirePermission("student.import");

  const params = await searchParams;

  const importLog = params.logId
    ? await prisma.importLog.findUnique({
        where: {
          id: params.logId,
        },
      })
    : null;

  const activeClasses = await prisma.schoolClass.findMany({
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
  });

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Import Siswa CSV
        </h1>
        <p className="mt-2 text-slate-600">
          Upload data siswa sekaligus dan otomatis masukkan ke kelas aktif.
        </p>
      </div>

      <a
        href="/api/students/import/template"
        className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50"
      >
        Download Template CSV
      </a>

      <div className="mt-4 flex gap-2">
        <a
          href="/students"
          className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
        >
          ← Kembali ke Data Siswa
        </a>
      </div>

      {params.success === "imported" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Import siswa berhasil.
        </div>
      )}

      {params.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Import gagal. Periksa format CSV dan detail log di bawah.
        </div>
      )}

      {importLog && (
        <div className="mt-4 rounded-xl bg-white p-6 shadow">
          <h2 className="font-semibold text-slate-900">Import Log</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <p className="text-sm text-slate-500">Total Baris</p>
              <p className="text-2xl font-bold text-slate-900">
                {importLog.totalRows}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">Berhasil</p>
              <p className="text-2xl font-bold text-green-700">
                {importLog.successRows}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">Gagal</p>
              <p className="text-2xl font-bold text-red-700">
                {importLog.failedRows}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-500">File</p>
              <p className="font-medium text-slate-900">
                {importLog.fileName ?? "-"}
              </p>
            </div>
          </div>

          {importLog.note && (
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-100 p-4 text-sm whitespace-pre-wrap">
              {importLog.note}
            </pre>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-6 shadow lg:col-span-2">
          <h2 className="font-semibold text-slate-900">Upload File CSV</h2>

          <form action={importStudentsCsvAction} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="csvFile"
                className="text-sm font-medium text-slate-700"
              >
                File CSV
              </label>
              <input
                id="csvFile"
                name="csvFile"
                type="file"
                accept=".csv,text/csv"
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              />
              <label className="flex items-start gap-3 rounded-md border bg-slate-50 p-3 text-sm">
                <input
                  type="checkbox"
                  name="skipExisting"
                  value="yes"
                  defaultChecked
                  className="mt-1"
                />

                <span>
                  <span className="font-medium text-slate-900">
                    Lewati siswa yang sudah ada
                  </span>
                  <span className="mt-1 block text-slate-600">
                    Jika NIS atau NISN sudah ada di database, baris tersebut tidak akan
                    di-update dan akan dilewati.
                  </span>
                </span>
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Gunakan format CSV dengan header: nis, nisn, name, gender,
                class_name, start_date.
              </p>
            </div>

            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
            >
              Import CSV
            </button>
          </form>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          <h2 className="font-semibold text-slate-900">Format CSV</h2>

          <pre className="mt-4 overflow-auto rounded-lg bg-slate-100 p-4 text-xs">
            {`nis;nisn;name;gender;class_name;start_date
            25001;001;Ahmad Fikri;L;VII A;2025-07-01
            25002;002;Budi Santoso;L;VII A;2025-07-01
            25003;003;Citra Ayu;P;VII B;2025-07-01`}
          </pre>

          <p className="mt-4 text-sm text-slate-600">
            Nama kelas harus sesuai dengan data kelas yang sudah dibuat.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">
          Kelas Aktif yang Tersedia
        </h2>

        <div className="mt-4 flex flex-wrap gap-2">
          {activeClasses.map((schoolClass) => (
            <span
              key={schoolClass.id}
              className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              {schoolClass.name} - {schoolClass.academicYear.name}
            </span>
          ))}

          {activeClasses.length === 0 && (
            <p className="text-sm text-red-600">
              Belum ada kelas aktif. Buat kelas terlebih dahulu.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}