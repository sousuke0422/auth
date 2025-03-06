-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "id_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    CONSTRAINT "UserIdentity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'openid profile email'
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_user_id_key" ON "UserIdentity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_provider_sub_key" ON "UserIdentity"("provider", "sub");
