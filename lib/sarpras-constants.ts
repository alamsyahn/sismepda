/**
 * Shared Sarpras constants safe for both client and server bundles.
 * Kept out of the route handler so client components never import server code.
 */

/** Same ceiling the upload route enforces; the form checks it first for a fast error. */
export const MAX_SARPRAS_PHOTO_BYTES = 2 * 1024 * 1024

/** Upper bound on photos per item, so one record can't bloat the database. */
export const MAX_SARPRAS_PHOTOS_PER_ITEM = 6

/**
 * Authorized URL for one Sarpras photo.
 * Lives here rather than in server-sarpras.ts so client components can use it
 * without pulling Prisma (and the `pg` driver) into the browser bundle.
 */
export function sarprasPhotoUrl(photoId: string): string {
  return `/api/sarpras/photos/${photoId}`
}
