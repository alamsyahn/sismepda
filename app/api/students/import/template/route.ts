export async function GET() {
  const csvContent = [
    "sep=;",
    "nis;nisn;name;gender;class_name;start_date",
    "25001;0012345678;Ahmad Fikri;L;VII A;2025-07-01",
    "25002;0012345679;Citra Ayu;P;VII A;2025-07-01",
    "25003;0012345680;Budi Santoso;L;VII B;2025-07-01",
  ].join("\n");

  return new Response(`\uFEFF${csvContent}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="template-import-siswa.csv"`,
    },
  });
}