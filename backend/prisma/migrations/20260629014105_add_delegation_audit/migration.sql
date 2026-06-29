-- CreateTable
CREATE TABLE "DelegationAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectorId" TEXT NOT NULL,
    "lider1MemberId" TEXT NOT NULL,
    "delegateMemberId" TEXT,
    "delegateUserId" TEXT,
    "action" TEXT NOT NULL,
    "until" DATETIME,
    "byUserId" TEXT NOT NULL,
    "byUserName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DelegationAuditLog_sectorId_idx" ON "DelegationAuditLog"("sectorId");

-- CreateIndex
CREATE INDEX "DelegationAuditLog_byUserId_idx" ON "DelegationAuditLog"("byUserId");
