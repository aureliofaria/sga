-- CreateTable
CREATE TABLE "FinanceParam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectorId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "ceilingCents" INTEGER NOT NULL,
    "overrideConsumedCents" INTEGER,
    "updatedById" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceParam_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinanceParam_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinanceParamAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectorId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FinanceParam_sectorId_idx" ON "FinanceParam"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceParam_sectorId_year_month_key" ON "FinanceParam"("sectorId", "year", "month");

-- CreateIndex
CREATE INDEX "FinanceParamAuditLog_sectorId_idx" ON "FinanceParamAuditLog"("sectorId");

-- CreateIndex
CREATE INDEX "FinanceParamAuditLog_userId_idx" ON "FinanceParamAuditLog"("userId");
