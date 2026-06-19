-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "tag" TEXT,
    "serialNumber" TEXT,
    "imei" TEXT,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISPONIVEL',
    "condition" TEXT NOT NULL DEFAULT 'BOM',
    "purchaseDate" DATETIME,
    "supplier" TEXT,
    "invoiceNumber" TEXT,
    "invoiceValueCents" INTEGER,
    "warehouseId" TEXT,
    "departmentId" TEXT,
    "userId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "movementDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "requestId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetMovement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "type" TEXT NOT NULL DEFAULT 'GERAL',
    "departmentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryCount_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryCountItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "found" BOOLEAN,
    "foundLocation" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryCountItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_code_key" ON "InventoryItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountItem_countId_assetId_key" ON "InventoryCountItem"("countId", "assetId");

