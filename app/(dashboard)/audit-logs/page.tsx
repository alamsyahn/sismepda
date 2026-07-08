import { requirePermission } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

type AuditLogsPageProps = {
  searchParams: Promise<{
    action?: string;
  }>;
};

function formatDateTime(date: Date) {
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatJson(value: unknown) {
  if (!value) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

export default async function AuditLogsPage({
  searchParams,
}: AuditLogsPageProps) {
  await requirePermission("audit.view");

  const params = await searchParams;
  const selectedAction = params.action ?? "";

  const actions = await prisma.auditLog.findMany({
    select: {
      action: true,
    },
    distinct: ["action"],
    orderBy: {
      action: "asc",
    },
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: selectedAction
      ? {
          action: selectedAction,
        }
      : undefined,
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Audit Log</h1>
        <p className="mt-2 text-slate-600">
          Riwayat aksi penting yang terjadi di SISMEPDA.
        </p>
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">Filter</h2>

        <form method="GET" action="/audit-logs" className="mt-4 flex gap-3">
          <select
            name="action"
            defaultValue={selectedAction}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Semua aksi</option>
            {actions.map((item) => (
              <option key={item.action} value={item.action}>
                {item.action}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Tampilkan
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-xl bg-white shadow">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Daftar Audit Log</h2>
          <p className="mt-1 text-sm text-slate-500">
            Menampilkan maksimal 100 log terbaru.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-6 py-3 font-medium">Waktu</th>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-6 py-3 font-medium">Aksi</th>
                <th className="px-6 py-3 font-medium">Tabel</th>
                <th className="px-6 py-3 font-medium">Record ID</th>
                <th className="px-6 py-3 font-medium">Data Baru</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {auditLogs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="whitespace-nowrap px-6 py-3">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-6 py-3">
                    <p className="font-medium text-slate-900">
                      {log.user?.name ?? "-"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {log.user?.username ?? ""}
                    </p>
                  </td>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {log.action}
                  </td>
                  <td className="px-6 py-3">{log.tableName ?? "-"}</td>
                  <td className="max-w-[160px] truncate px-6 py-3">
                    {log.recordId ?? "-"}
                  </td>
                  <td className="px-6 py-3">
                    <pre className="max-h-40 max-w-md overflow-auto rounded bg-slate-100 p-3 text-xs">
                      {formatJson(log.newValue)}
                    </pre>
                  </td>
                </tr>
              ))}

              {auditLogs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    Belum ada audit log.
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