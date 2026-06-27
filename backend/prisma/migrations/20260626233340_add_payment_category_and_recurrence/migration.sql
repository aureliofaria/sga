-- CreateTable
CREATE TABLE "PaymentRecurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paymentCategory" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "supplier" TEXT,
    "costCenter" TEXT,
    "justification" TEXT,
    "intervalUnit" TEXT NOT NULL DEFAULT 'MONTH',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentRecurrence_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "FlowTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRecurrence_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "sectorId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "targetEmployee" TEXT,
    "targetDepartment" TEXT,
    "startDate" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "supplier" TEXT,
    "costCenter" TEXT,
    "justification" TEXT,
    "paymentCategory" TEXT,
    "recurrenceId" TEXT,
    "vacancyType" TEXT,
    "replacementName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "FlowTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Request_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "PaymentRecurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Request" ("amountCents", "costCenter", "createdAt", "currency", "currentStep", "description", "flowId", "id", "initiatorId", "justification", "replacementName", "sectorId", "startDate", "status", "supplier", "targetDepartment", "targetEmployee", "title", "updatedAt", "vacancyType") SELECT "amountCents", "costCenter", "createdAt", "currency", "currentStep", "description", "flowId", "id", "initiatorId", "justification", "replacementName", "sectorId", "startDate", "status", "supplier", "targetDepartment", "targetEmployee", "title", "updatedAt", "vacancyType" FROM "Request";
DROP TABLE "Request";
ALTER TABLE "new_Request" RENAME TO "Request";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PaymentRecurrence_isActive_nextRunAt_idx" ON "PaymentRecurrence"("isActive", "nextRunAt");
