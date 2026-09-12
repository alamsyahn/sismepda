/** Exact Phase 5 Sarpras permissions and UI capability mapping. */

export const SARPRAS_ROUTE_PERMISSIONS = {
  overview: { GET: "sarpras.read" },
  history: { GET: "sarpras.history.read" },
  photoCollection: {
    GET: "sarpras.photos.read",
    POST: "sarpras.photos.create",
    DELETE: "sarpras.photos.delete",
  },
  photoResource: { GET: "sarpras.photos.read" },
  locations: {
    POST: "sarpras.locations.create",
    PATCH: "sarpras.locations.update",
    DELETE: "sarpras.locations.delete",
  },
  itemTypes: {
    POST: "sarpras.item_types.create",
    PATCH: "sarpras.item_types.update",
    DELETE: "sarpras.item_types.delete",
  },
  items: {
    POST: "sarpras.items.create",
    PATCH: "sarpras.items.update",
    DELETE: "sarpras.items.delete",
  },
} as const

export type SarprasRuntimePermission =
  | "sarpras.read"
  | "sarpras.history.read"
  | "sarpras.photos.read"
  | "sarpras.locations.create"
  | "sarpras.locations.update"
  | "sarpras.locations.delete"
  | "sarpras.item_types.create"
  | "sarpras.item_types.update"
  | "sarpras.item_types.delete"
  | "sarpras.items.create"
  | "sarpras.items.update"
  | "sarpras.items.delete"
  | "sarpras.photos.create"
  | "sarpras.photos.delete"

export function sarprasCapabilitiesFromGrants(grants: ReadonlySet<string>) {
  const has = (permission: SarprasRuntimePermission) => grants.has(permission)
  return {
    read: has("sarpras.read"),
    historyRead: has("sarpras.history.read"),
    locations: {
      create: has("sarpras.locations.create"),
      update: has("sarpras.locations.update"),
      delete: has("sarpras.locations.delete"),
    },
    itemTypes: {
      create: has("sarpras.item_types.create"),
      update: has("sarpras.item_types.update"),
      delete: has("sarpras.item_types.delete"),
    },
    items: {
      create: has("sarpras.items.create"),
      update: has("sarpras.items.update"),
      delete: has("sarpras.items.delete"),
    },
    photos: {
      read: has("sarpras.photos.read"),
      create: has("sarpras.photos.create"),
      delete: has("sarpras.photos.delete"),
    },
  }
}

export type SarprasCapabilities = ReturnType<typeof sarprasCapabilitiesFromGrants>
