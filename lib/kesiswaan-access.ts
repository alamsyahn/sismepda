import { getAuthorizationContext, ForbiddenError } from "@/lib/rbac-access"

export async function kesiswaanViewer() {
  const context = await getAuthorizationContext()
  const all = context.grants.has("kesiswaan.read.all")
  if (!all && !context.grants.has("kesiswaan.read.own")) throw new ForbiddenError()
  return {
    id: context.user.id,
    all,
    manage: all && context.grants.has("kesiswaan.manage"),
    write: context.grants.has(all ? "kesiswaan.write.all" : "kesiswaan.write.own"),
    verify: all && context.grants.has("kesiswaan.verify"),
    export: context.grants.has(all ? "kesiswaan.export.all" : "kesiswaan.export.own"),
  }
}
export type KsViewer = Awaited<ReturnType<typeof kesiswaanViewer>>
export function activityScope(viewer: KsViewer) {
  return viewer.all ? {} : { coaches: { some: { userId: viewer.id } } }
}
