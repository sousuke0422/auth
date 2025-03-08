-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'openid profile email',
    "is_misskey" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Providers" ("client_id", "client_secret", "id", "name", "scope", "url") SELECT "client_id", "client_secret", "id", "name", "scope", "url" FROM "Providers";
DROP TABLE "Providers";
ALTER TABLE "new_Providers" RENAME TO "Providers";
CREATE UNIQUE INDEX "Providers_name_key" ON "Providers"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
