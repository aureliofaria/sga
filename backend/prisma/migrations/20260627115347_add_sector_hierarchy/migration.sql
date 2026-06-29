-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SectorMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'MEMBRO',
    "reportsToId" TEXT,
    "delegateToId" TEXT,
    "delegateUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectorMember_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SectorMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SectorMember_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "SectorMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SectorMember_delegateToId_fkey" FOREIGN KEY ("delegateToId") REFERENCES "SectorMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SectorMember" ("createdAt", "id", "role", "sectorId", "userId") SELECT "createdAt", "id", "role", "sectorId", "userId" FROM "SectorMember";
DROP TABLE "SectorMember";
ALTER TABLE "new_SectorMember" RENAME TO "SectorMember";
CREATE UNIQUE INDEX "SectorMember_sectorId_userId_role_key" ON "SectorMember"("sectorId", "userId", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: deriva o nível (level) a partir do papel legado (role).
UPDATE "SectorMember" SET "level" = 'LIDER_1' WHERE "role" = 'LIDER';
UPDATE "SectorMember" SET "level" = 'MEMBRO' WHERE "role" = 'PROTETOR';

-- Invariante: no máximo 1 LIDER_1 por setor (índice único parcial).
CREATE UNIQUE INDEX "SectorMember_one_lider1_per_sector" ON "SectorMember"("sectorId") WHERE "level" = 'LIDER_1';
