-- AlterTable
ALTER TABLE "Request" ADD COLUMN "correctionReturnStep" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "comments" TEXT,
    "forwardedToId" TEXT,
    "forwardedToRole" TEXT,
    "round" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_forwardedToId_fkey" FOREIGN KEY ("forwardedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("approverId", "comments", "createdAt", "decision", "id", "requestId", "stepOrder") SELECT "approverId", "comments", "createdAt", "decision", "id", "requestId", "stepOrder" FROM "Approval";
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE UNIQUE INDEX "Approval_requestId_stepOrder_approverId_round_key" ON "Approval"("requestId", "stepOrder", "approverId", "round");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
