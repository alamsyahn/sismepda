import { hasPermission, requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  deleteStudentPermanentlyAction,
  endStudentEnrollmentAction,
  updateStudentAction,
} from "../../actions";
import { notFound } from "next/navigation";

type EditStudentPageProps = {
  params: Promise<{
    studentId: string;
  }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

function formatDateInput(date: Date | null) {
  if (!date) {
    return "-";
  }

  return date.toISOString().slice(0, 10);
}

export default async function EditStudentPage({
  params,
  searchParams,
}: EditStudentPageProps) {
  const user = await requirePermission("student.update");

  const { studentId } = await params;
  const query = await searchParams;

  const canDeleteStudent = hasPermission(user, "student.delete");

  const student = await prisma.student.findUnique({
    where: {
      id: studentId,
    },
    include: {
      classEnrollments: {
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
  });

  if (!student) {
    notFound();
  }

  const [enrollmentCount, attendanceRecordCount] = await Promise.all([
    prisma.classEnrollment.count({
      where: {
        studentId,
      },
    }),

    prisma.attendanceRecord.count({
      where: {
        studentId,
      },
    }),
  ]);

  const activeEnrollment = student.classEnrollments.find(
    (enrollment) => enrollment.status === "ACTIVE"
  );

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Edit Data Siswa</h1>
        <p className="mt-2 text-slate-600">
          Perbaiki identitas siswa atau hapus permanen data salah input.
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <a
          href="/students"
          className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
        >
          ← Kembali ke Data Siswa
        </a>
      </div>

      {query.success === "updated" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Data siswa berhasil diperbarui.
        </div>
      )}

      {query.success === "enrollment_ended" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Siswa berhasil dikeluarkan dari kelas aktif.
        </div>
      )}

      {query.error === "duplicate" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          NIS atau NISN sudah digunakan oleh siswa lain.
        </div>
      )}

      {query.error === "confirm_delete" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Konfirmasi hapus salah. Ketik HAPUS untuk menghapus permanen.
        </div>
      )}

      {query.error === "invalid_end_date" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Tanggal selesai tidak valid.
        </div>
      )}

      {query.error === "enrollment_not_found" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Data enrollment siswa tidak ditemukan.
        </div>
      )}

      {query.error === "enrollment_not_active" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Enrollment siswa ini sudah tidak aktif.
        </div>
      )}

      {query.error === "end_before_start" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Tanggal selesai tidak boleh lebih awal dari tanggal mulai masuk kelas.
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-6 shadow lg:col-span-2">
          <h2 className="font-semibold text-slate-900">Identitas Siswa</h2>

          <form action={updateStudentAction} className="mt-4 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="studentId" value={student.id} />

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
                defaultValue={student.nis ?? ""}
                className="mt-1 w-full rounded-md border px-3 py-2"
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
                defaultValue={student.nisn ?? ""}
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="Opsional"
              />
            </div>

            <div className="md:col-span-2">
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
                defaultValue={student.name}
                className="mt-1 w-full rounded-md border px-3 py-2"
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
                defaultValue={student.gender ?? "MALE"}
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              >
                <option value="MALE">Laki-laki</option>
                <option value="FEMALE">Perempuan</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="status"
                className="text-sm font-medium text-slate-700"
              >
                Status Siswa
              </label>
              <select
                id="status"
                name="status"
                defaultValue={student.status}
                className="mt-1 w-full rounded-md border px-3 py-2"
                required
              >
                <option value="ACTIVE">Aktif</option>
                <option value="INACTIVE">Nonaktif</option>
                <option value="TRANSFERRED_OUT">Pindah/Keluar</option>
                <option value="DROPPED_OUT">Putus Sekolah</option>
                <option value="GRADUATED">Lulus</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          <h2 className="font-semibold text-slate-900">Ringkasan Data</h2>

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-slate-500">Kelas Aktif</p>
              <p className="font-medium text-slate-900">
                {activeEnrollment
                  ? `${activeEnrollment.schoolClass.name} - ${activeEnrollment.schoolClass.academicYear.name}`
                  : "-"}
              </p>
            </div>

            <div>
              <p className="text-slate-500">Enrollment</p>
              <p className="font-medium text-slate-900">{enrollmentCount}</p>
            </div>

            <div>
              <p className="text-slate-500">Attendance Records</p>
              <p className="font-medium text-slate-900">
                {attendanceRecordCount}
              </p>
            </div>

            <div>
              <p className="text-slate-500">Dibuat</p>
              <p className="font-medium text-slate-900">
                {student.createdAt.toLocaleString("id-ID", {
                  timeZone: "Asia/Jakarta",
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Riwayat Kelas</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">Kelas</th>
                <th className="px-6 py-3 font-medium">Tahun Pelajaran</th>
                <th className="px-6 py-3 font-medium">Mulai</th>
                <th className="px-6 py-3 font-medium">Selesai</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {student.classEnrollments.map((enrollment) => (
                <tr key={enrollment.id}>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {enrollment.schoolClass.name}
                  </td>
                  <td className="px-6 py-3">
                    {enrollment.schoolClass.academicYear.name}
                  </td>
                  <td className="px-6 py-3">
                    {formatDateInput(enrollment.startDate)}
                  </td>
                  <td className="px-6 py-3">
                    {formatDateInput(enrollment.endDate)}
                  </td>
                  <td className="px-6 py-3">{enrollment.status}</td>
                </tr>
              ))}

              {student.classEnrollments.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada riwayat kelas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {activeEnrollment && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-900">
            Keluarkan Siswa dari Kelas Aktif
          </h2>

          <p className="mt-2 text-sm text-amber-800">
            Gunakan fitur ini untuk siswa nyata yang pindah/keluar dari sekolah.
            Riwayat absensi lama tetap disimpan, tetapi siswa tidak akan muncul lagi
            di input absensi setelah tanggal selesai aktif.
          </p>

          <div className="mt-4 rounded-md bg-white p-4 text-sm text-amber-900">
            <p>
              Kelas aktif saat ini:{" "}
              <strong>
                {activeEnrollment.schoolClass.name} -{" "}
                {activeEnrollment.schoolClass.academicYear.name}
              </strong>
            </p>
            <p className="mt-1">
              Mulai aktif: <strong>{formatDateInput(activeEnrollment.startDate)}</strong>
            </p>
          </div>

          <form action={endStudentEnrollmentAction} className="mt-4 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="enrollmentId" value={activeEnrollment.id} />

            <div>
              <label
                htmlFor="endDate"
                className="text-sm font-medium text-amber-900"
              >
                Tanggal Terakhir Aktif
              </label>
              <input
                id="endDate"
                name="endDate"
                type="date"
                className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-amber-800">
                Siswa masih muncul di absensi sampai tanggal ini.
              </p>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="note"
                className="text-sm font-medium text-amber-900"
              >
                Catatan
              </label>
              <input
                id="note"
                name="note"
                type="text"
                className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2"
                placeholder="Contoh: Pindah sekolah / keluar / mutasi"
              />
            </div>

            <div className="md:col-span-3">
              <button
                type="submit"
                className="rounded-md bg-amber-700 px-4 py-2 text-white hover:bg-amber-800"
              >
                Keluarkan dari Kelas
              </button>
            </div>
          </form>
        </div>
      )}

      {canDeleteStudent && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-900">
            Hapus Permanen Data Salah Input
          </h2>

          <p className="mt-2 text-sm text-red-700">
            Aksi ini akan menghapus data siswa, riwayat kelas, dan record
            absensi siswa ini secara permanen. Gunakan hanya jika data ini memang
            salah input.
          </p>

          <div className="mt-4 rounded-md bg-white p-4 text-sm text-red-800">
            <p>
              Data terkait yang akan dihapus:{" "}
              <strong>{enrollmentCount}</strong> enrollment dan{" "}
              <strong>{attendanceRecordCount}</strong> attendance record.
            </p>
          </div>

          <form action={deleteStudentPermanentlyAction} className="mt-4 space-y-3">
            <input type="hidden" name="studentId" value={student.id} />

            <div>
              <label
                htmlFor="confirmText"
                className="text-sm font-medium text-red-900"
              >
                Ketik HAPUS untuk konfirmasi
              </label>
              <input
                id="confirmText"
                name="confirmText"
                type="text"
                className="mt-1 w-full max-w-xs rounded-md border border-red-300 px-3 py-2"
                placeholder="HAPUS"
                required
              />
            </div>

            <button
              type="submit"
              className="rounded-md bg-red-700 px-4 py-2 text-white hover:bg-red-800"
            >
              Hapus Permanen
            </button>
          </form>
        </div>
      )}
    </div>
  );
}