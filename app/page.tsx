import { appConfig } from "@/lib/app-config";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-md rounded-xl bg-white p-8 shadow">
        <p className="text-sm font-medium text-slate-500">
          {appConfig.appFullName}
        </p>

        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
          {appConfig.appName}
        </h1>

        <p className="mt-4 text-slate-600">
          Sistem informasi sekolah untuk rekap absensi siswa.
        </p>

        <div className="mt-6">
          <a
            href="/login"
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Masuk ke Aplikasi
          </a>
        </div>
      </div>
    </main>
  );
}