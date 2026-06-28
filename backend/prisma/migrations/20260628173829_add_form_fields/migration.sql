-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowStepId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sensitiveType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormField_flowStepId_fkey" FOREIGN KEY ("flowStepId") REFERENCES "FlowStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequestFieldValue_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequestFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FormField_flowStepId_idx" ON "FormField"("flowStepId");

-- CreateIndex
CREATE UNIQUE INDEX "FormField_flowStepId_key_key" ON "FormField"("flowStepId", "key");

-- CreateIndex
CREATE INDEX "RequestFieldValue_requestId_idx" ON "RequestFieldValue"("requestId");

-- CreateIndex
CREATE INDEX "RequestFieldValue_fieldId_idx" ON "RequestFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestFieldValue_requestId_fieldId_key" ON "RequestFieldValue"("requestId", "fieldId");
