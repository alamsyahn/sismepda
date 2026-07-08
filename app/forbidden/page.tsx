export default function ForbiddenPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-bold text-slate-900">
          Akses Ditolak
        </h1>

        <p className="mt-3 text-slate-600">
          Akun Anda tidak memiliki izin untuk membuka halaman ini.
        </p>

        <a
          href="/dashboard"
          className="mt-6 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Kembali ke Dashboard
        </a>
      </div>
    </main>
  );
}