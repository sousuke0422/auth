-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "avatar_url" TEXT,
    "mail" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "password_id" TEXT,
    CONSTRAINT "User_password_id_fkey" FOREIGN KEY ("password_id") REFERENCES "UserPassword" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPassword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "password" TEXT NOT NULL,
    "password_reset_token" TEXT,
    "password_reset_expires" DATETIME
);
