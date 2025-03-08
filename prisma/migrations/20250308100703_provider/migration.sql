/*
  Warnings:

  - You are about to drop the column `provider` on the `UserIdentity` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Providers` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `provider_id` to the `UserIdentity` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_id" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "id_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    CONSTRAINT "UserIdentity_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Providers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserIdentity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserIdentity" ("access_token", "expires_at", "id", "id_token", "refresh_token", "sub", "user_id") SELECT "access_token", "expires_at", "id", "id_token", "refresh_token", "sub", "user_id" FROM "UserIdentity";
DROP TABLE "UserIdentity";
ALTER TABLE "new_UserIdentity" RENAME TO "UserIdentity";
CREATE UNIQUE INDEX "UserIdentity_user_id_key" ON "UserIdentity"("user_id");
CREATE UNIQUE INDEX "UserIdentity_provider_id_sub_key" ON "UserIdentity"("provider_id", "sub");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Providers_name_key" ON "Providers"("name");
