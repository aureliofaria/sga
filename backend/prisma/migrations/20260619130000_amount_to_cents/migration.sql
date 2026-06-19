-- Converte valores monetários de Float (reais) para Int (centavos),
-- eliminando erros de arredondamento de ponto flutuante nas comparações de alçada.
-- Valores existentes são convertidos via ROUND(valor * 100).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AuthorizationLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowStepId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minValueCents" INTEGER,
    "maxValueCents" INTEGER,
    "requiredApprovers" INTEGER NOT NULL DEFAULT 1,
    "approverRole" TEXT NOT NULL,
    "deadlineHours" INTEGER,
    CONSTRAINT "AuthorizationLevel_flowStepId_fkey" FOREIGN KEY ("flowStepId") REFERENCES "FlowStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AuthorizationLevel" ("id", "flowStepId", "name", "minValueCents", "maxValueCents", "requiredApprovers", "approverRole", "deadlineHours")
SELECT "id", "flowStepId", "name",
       CAST(ROUND("minValue" * 100) AS INTEGER),
       CAST(ROUND("maxValue" * 100) AS INTEGER),
       "requiredApprovers", "approverRole", "deadlineHours"
FROM "AuthorizationLevel";
DROP TABLE "AuthorizationLevel";
ALTER TABLE "new_AuthorizationLevel" RENAME TO "AuthorizationLevel";

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
    "vacancyType" TEXT,
    "replacementName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "FlowTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Request" ("id", "flowId", "initiatorId", "sectorId", "title", "description", "status", "currentStep", "targetEmployee", "targetDepartment", "startDate", "amountCents", "currency", "supplier", "costCenter", "justification", "vacancyType", "replacementName", "createdAt", "updatedAt")
SELECT "id", "flowId", "initiatorId", "sectorId", "title", "description", "status", "currentStep", "targetEmployee", "targetDepartment", "startDate",
       CAST(ROUND("amount" * 100) AS INTEGER),
       "currency", "supplier", "costCenter", "justification", "vacancyType", "replacementName", "createdAt", "updatedAt"
FROM "Request";
DROP TABLE "Request";
ALTER TABLE "new_Request" RENAME TO "Request";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
