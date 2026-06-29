-- AlterTable
ALTER TABLE "FlowStep" ADD COLUMN "escalationDay1" INTEGER;
ALTER TABLE "FlowStep" ADD COLUMN "escalationDay2" INTEGER;
ALTER TABLE "FlowStep" ADD COLUMN "escalationDay3" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "escalationStage" INTEGER NOT NULL DEFAULT 0,
    "delayJustification" TEXT,
    "delayJustifiedAt" DATETIME,
    "delayJustifiedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequestTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequestTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FlowStep" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequestTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequestTask_delayJustifiedById_fkey" FOREIGN KEY ("delayJustifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RequestTask" ("assigneeId", "completedAt", "createdAt", "description", "dueDate", "id", "notes", "requestId", "slaEscalated", "status", "stepId", "title", "updatedAt") SELECT "assigneeId", "completedAt", "createdAt", "description", "dueDate", "id", "notes", "requestId", "slaEscalated", "status", "stepId", "title", "updatedAt" FROM "RequestTask";
DROP TABLE "RequestTask";
ALTER TABLE "new_RequestTask" RENAME TO "RequestTask";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
