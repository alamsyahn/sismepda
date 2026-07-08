import { hasPermission, requirePermission } from "@/lib/auth-helpers";
import { getSystemSettings } from "@/lib/system-settings";
import { updateSystemSettingsAction } from "./actions";

type SettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requirePermission("setting.view");
  const params = await searchParams;

  const settings = await getSystemSettings();
  const canManageSettings = hasPermission(user, "setting.manage");

  return (
    <div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Pengaturan Sistem
        </h1>
        <p className="mt-2 text-slate-600">
          Atur identitas dasar aplikasi SISMEPDA.
        </p>
      </div>

      {params.success === "updated" && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Pengaturan berhasil disimpan.
        </div>
      )}

      {params.error === "invalid" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Data pengaturan tidak valid. Pastikan semua isian sudah diisi.
        </div>
      )}

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">Identitas Aplikasi</h2>

        <form action={updateSystemSettingsAction} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="appName"
              className="text-sm font-medium text-slate-700"
            >
              Nama Pendek Aplikasi
            </label>
            <input
              id="appName"
              name="appName"
              type="text"
              defaultValue={settings.appName}
              disabled={!canManageSettings}
              className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Contoh: SISMEPDA
            </p>
          </div>

          <div>
            <label
              htmlFor="appFullName"
              className="text-sm font-medium text-slate-700"
            >
              Nama Lengkap Aplikasi
            </label>
            <input
              id="appFullName"
              name="appFullName"
              type="text"
              defaultValue={settings.appFullName}
              disabled={!canManageSettings}
              className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Contoh: Sistem Informasi SMPN 2 Blitar
            </p>
          </div>

          <div>
            <label
              htmlFor="schoolName"
              className="text-sm font-medium text-slate-700"
            >
              Nama Sekolah
            </label>
            <input
              id="schoolName"
              name="schoolName"
              type="text"
              defaultValue={settings.schoolName}
              disabled={!canManageSettings}
              className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Nama sekolah yang ditampilkan di sistem.
            </p>
          </div>

          {canManageSettings ? (
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
            >
              Simpan Pengaturan
            </button>
          ) : (
            <p className="text-sm text-slate-500">
              Akun Anda hanya dapat melihat pengaturan, tidak dapat mengubah.
            </p>
          )}
        </form>
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow">
        <h2 className="font-semibold text-slate-900">Preview</h2>

        <div className="mt-4 rounded-lg border bg-slate-50 p-4">
          <p className="text-sm text-slate-500">{settings.appFullName}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {settings.appName}
          </p>
          <p className="mt-2 text-sm text-slate-600">{settings.schoolName}</p>
        </div>
      </div>
    </div>
  );
}