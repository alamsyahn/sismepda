export function databaseSchema(connectionString: string): string {
  try {
    return new URL(connectionString).searchParams.get("schema")?.trim() || "public"
  } catch {
    return "public"
  }
}
