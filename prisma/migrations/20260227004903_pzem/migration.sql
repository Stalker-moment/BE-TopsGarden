-- CreateTable
CREATE TABLE "PzemDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shouldReset" BOOLEAN NOT NULL DEFAULT false,
    "lastResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PzemDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PzemLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "voltage" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "power" DOUBLE PRECISION NOT NULL,
    "energy" DOUBLE PRECISION NOT NULL,
    "frequency" DOUBLE PRECISION NOT NULL,
    "pf" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PzemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PzemDevice_name_key" ON "PzemDevice"("name");

-- CreateIndex
CREATE INDEX "PzemLog_deviceId_createdAt_idx" ON "PzemLog"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "PzemLog" ADD CONSTRAINT "PzemLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PzemDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
