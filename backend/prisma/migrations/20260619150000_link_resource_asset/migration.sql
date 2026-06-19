-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RequestResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "resourceItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestResource_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequestResource_resourceItemId_fkey" FOREIGN KEY ("resourceItemId") REFERENCES "ResourceItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequestResource_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RequestResource" ("createdAt", "id", "notes", "quantity", "requestId", "resourceItemId", "status") SELECT "createdAt", "id", "notes", "quantity", "requestId", "resourceItemId", "status" FROM "RequestResource";
DROP TABLE "RequestResource";
ALTER TABLE "new_RequestResource" RENAME TO "RequestResource";
CREATE UNIQUE INDEX "RequestResource_requestId_resourceItemId_key" ON "RequestResource"("requestId", "resourceItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

