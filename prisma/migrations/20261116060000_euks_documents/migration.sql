BEGIN;

CREATE TABLE "EuksDocument" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EuksDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EuksDocument_content_size" CHECK ("size" BETWEEN 1 AND 5242880 AND octet_length("content") = "size")
);

CREATE INDEX "EuksDocument_shared_updatedAt_id_idx" ON "EuksDocument"("shared", "updatedAt", "id");

INSERT INTO "Permission" ("id", "key", "resource", "action", "label", "module", "createdAt", "updatedAt") VALUES
 ('perm:euks.documents.read', 'euks.documents.read', 'euks.documents', 'read', 'Lihat semua dokumen UKS', 'euks', NOW(), NOW()),
 ('perm:euks.shared_documents.read', 'euks.shared_documents.read', 'euks.shared_documents', 'read', 'Lihat dokumen UKS yang dibagikan', 'euks', NOW(), NOW()),
 ('perm:euks.documents.manage', 'euks.documents.manage', 'euks.documents', 'manage', 'Kelola dokumen UKS', 'euks', NOW(), NOW());

WITH grants AS (
    INSERT INTO "RolePermission" ("roleId", "permissionId")
    SELECT role."id", permission."id"
    FROM (VALUES
      ('guru', 'euks.shared_documents.read'),
      ('pengurus_uks', 'euks.documents.read'),
      ('pengurus_uks', 'euks.documents.manage')
    ) AS assignment("roleKey", "permissionKey")
    JOIN "RbacRole" AS role ON role."key" = assignment."roleKey"
    JOIN "Permission" AS permission ON permission."key" = assignment."permissionKey"
    ON CONFLICT DO NOTHING
    RETURNING "roleId"
)
UPDATE "RbacRole"
SET "version" = "version" + 1, "updatedAt" = NOW()
WHERE "id" IN (SELECT "roleId" FROM grants);

COMMIT;
