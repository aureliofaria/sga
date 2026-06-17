-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FlowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowTemplateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiredRole" TEXT,
    "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
    "deadlineHours" INTEGER,
    "handlingSectorId" TEXT,
    "slaExpiry" TEXT NOT NULL DEFAULT 'KEEP_WITH_RESPONSIBLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowStep_flowTemplateId_fkey" FOREIGN KEY ("flowTemplateId") REFERENCES "FlowTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowStep_handlingSectorId_fkey" FOREIGN KEY ("handlingSectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FlowStep" ("createdAt", "deadlineHours", "description", "flowTemplateId", "handlingSectorId", "id", "name", "order", "requiredRole", "requiresAttachment") SELECT "createdAt", "deadlineHours", "description", "flowTemplateId", "handlingSectorId", "id", "name", "order", "requiredRole", "requiresAttachment" FROM "FlowStep";
DROP TABLE "FlowStep";
ALTER TABLE "new_FlowStep" RENAME TO "FlowStep";
CREATE TABLE "new_RequestTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "notes" TEXT,
    "slaEscalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequestTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequestTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FlowStep" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequestTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RequestTask" ("assigneeId", "completedAt", "createdAt", "description", "dueDate", "id", "notes", "requestId", "status", "stepId", "title", "updatedAt") SELECT "assigneeId", "completedAt", "createdAt", "description", "dueDate", "id", "notes", "requestId", "status", "stepId", "title", "updatedAt" FROM "RequestTask";
DROP TABLE "RequestTask";
ALTER TABLE "new_RequestTask" RENAME TO "RequestTask";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
