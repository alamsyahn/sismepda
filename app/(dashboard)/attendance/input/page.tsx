import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { saveAttendanceAction } from "./actions";

type AttendanceInputPageProps = {
  searchParams: Promise<{
    schoolClassId?: string;
    attendanceDate?: string;
    success?: string;
    error?: string;
  }>;
};

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function AttendanceInputPage({
  searchParams,
}: AttendanceInputPageProps) {
  await requirePermission("attendance.input.today");

  const params = await searchParams;

  const today = formatDateInput(new Date());
  const selectedDate = params.attendanceDate ?? today;
  const selectedClassId = params.schoolClassId ?? "";

  const attendanceDateValue = new Date(`${selectedDate}T00:00:00.000Z`);

  const [classes, attendanceStatuses] = await Promise.all([
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

    prisma.attendanceStatus.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
    }),
  ]);

  const selectedClass = selectedClassId
    ? await prisma.schoolClass.findUnique({
        where: {
          id: selectedClassId,
        },
        include: {
          academicYear: true,
        },
      })
    : null;

  const enrollments =
    selectedClassId.length > 0
      ? await prisma.classEnrollment.findMany({
          where: {
            schoolClassId: selectedClassId,
            startDate: {
              lte: attendanceDateValue,
            },
            OR: [
              {
                endDate: null,
              },
              {
                endDate: {
                  gte: attendanceDateValue,
                },
              },
            ],
            status: "ACTIVE",
          },
          include: {
            student: true,
          },
          orderBy: {
            student: {
              name: "asc",
            },
          },
        })
      : [];

  const existingSession =
    selectedClassId.length > 0
      ? await prisma.attendanceSession.findUnique({
          where: {
            schoolClassId_attendanceDate: {
              schoolClassId: selectedClassId,
              attendanceDate: attendanceDateValue,
            },
          },
          include: {
            attendanceRecords: {
              include: {
                status: true,
              },
            },
            submittedBy: true,
          },
        })
      : null;

  const existingRecordMap = new Map(
    existingSession?.attendanceRecords.map((record) => [
      record.studentId,
      record,
    ]) ?? []
  );

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Input Absensi</h1>
        <p className="mt-2 text-slate-600">
          Pilih tanggal dan kelas, lalu input status kehadiran siswa.
        </p>
      </div>

      {params.success === "saved" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Absensi berhasil disimpan dan kelas sudah ditandai sebagai sudah rekap.
        </div>
      )}

      {params.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Terjadi kesalahan saat memproses absensi.
        </div>
      )}

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">Pilih Kelas</h2>

        <form method="GET" action="/attendance/input" className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label
              htmlFor="attendanceDate"
              className="text-sm font-medium text-slate-700"
            >
              Tanggal
            </label>
            <input
              id="attendanceDate"
              name="attendanceDate"
              type="date"
              defaultValue={selectedDate}
              className="mt-1 w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label
              htmlFor="schoolClassId"
              className="text-sm font-medium text-slate-700"
            >
              Kelas
            </label>
            <select
              id="schoolClassId"
              name="schoolClassId"
              defaultValue={selectedClassId}
              className="mt-1 w-full rounded-md border px-3 py-2"
              required
            >
              <option value="">Pilih kelas</option>
              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name} - {schoolClass.academicYear.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
            >
              Tampilkan Siswa
            </button>
          </div>
        </form>
      </div>

      {selectedClass && (
        <div className="mt-6 rounded-xl bg-white shadow">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold text-slate-900">
              Absensi {selectedClass.name}
            </h2>

            <p className="mt-1 text-sm text-slate-600">
              Tanggal: {selectedDate} · Tahun Pelajaran:{" "}
              {selectedClass.academicYear.name}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {attendanceStatuses.map((status) => (
                <span
                  key={status.id}
                  className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700"
                >
                  <span className="font-semibold">{status.code}</span> = {status.name}
                </span>
              ))}
            </div>

            {!existingSession && (
              <p className="mt-3 text-xs text-slate-500">
                Belum ada data rekap untuk kelas dan tanggal ini. Status yang belum dipilih
                akan disimpan sebagai Hadir.
              </p>
            )}

            {existingSession && (
              <p className="mt-1 text-sm text-amber-700">
                Kelas ini sudah pernah direkap. Data yang tampil adalah data
                terakhir dan bisa diperbarui.
              </p>
            )}
          </div>

          {enrollments.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500">
              Tidak ada siswa aktif pada kelas dan tanggal ini.
            </div>
          ) : (
            <form action={saveAttendanceAction}>
              <input
                type="hidden"
                name="schoolClassId"
                value={selectedClass.id}
              />
              <input
                type="hidden"
                name="attendanceDate"
                value={selectedDate}
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-6 py-3 font-medium">No</th>
                      <th className="px-6 py-3 font-medium">NIS</th>
                      <th className="px-6 py-3 font-medium">Nama Siswa</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Catatan</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y">
                    {enrollments.map((enrollment, index) => {
                      const student = enrollment.student;
                      const existingRecord = existingRecordMap.get(student.id);
                      const defaultStatusCode = existingRecord?.status.code;

                      return (
                        <tr key={student.id}>
                          <td className="px-6 py-3">{index + 1}</td>
                          <td className="px-6 py-3">{student.nis ?? "-"}</td>
                          <td className="px-6 py-3 font-medium text-slate-900">
                            {student.name}
                          </td>
                          <td className="px-6 py-3">
                            <input
                              type="hidden"
                              name="studentId"
                              value={student.id}
                            />

                            <div className="flex flex-wrap gap-2">
                              {attendanceStatuses.map((status) => {
                                const inputId = `status-${student.id}-${status.code}`;

                                return (
                                  <div key={status.id}>
                                    <input
                                      id={inputId}
                                      type="radio"
                                      name={`status-${student.id}`}
                                      value={status.code}
                                      defaultChecked={defaultStatusCode === status.code}
                                      className="peer sr-only"
                                    />

                                    <label
                                      htmlFor={inputId}
                                      title={status.name}
                                      className="inline-flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 peer-checked:border-slate-500 peer-checked:bg-slate-200 peer-checked:text-slate-900 peer-checked:hover:bg-slate-300"
                                    >
                                      {status.code}
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <input
                              name={`note-${student.id}`}
                              type="text"
                              defaultValue={existingRecord?.note ?? ""}
                              placeholder="Opsional"
                              className="w-full rounded-md border px-3 py-2"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sticky bottom-0 flex items-center justify-between border-t bg-white px-6 py-4 shadow-[0_-8px_20px_rgba(15,23,42,0.08)]">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Total siswa aktif: {enrollments.length}
                  </p>
                  <p className="text-xs text-slate-500">
                    Pastikan status siswa sudah benar sebelum menyimpan.
                  </p>
                </div>

                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  Simpan Absensi
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}