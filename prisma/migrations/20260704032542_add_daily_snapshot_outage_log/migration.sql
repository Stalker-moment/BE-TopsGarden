-- CreateTable
CREATE TABLE "PzemDailySnapshot" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "energyKwh" DOUBLE PRECISION NOT NULL,
    "deltaKwh" DOUBLE PRECISION,
    "isResetDay" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PzemDailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerOutageLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "lastVoltage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerOutageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PzemDailySnapshot_deviceId_date_idx" ON "PzemDailySnapshot"("deviceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PzemDailySnapshot_deviceId_date_key" ON "PzemDailySnapshot"("deviceId", "date");

-- CreateIndex
CREATE INDEX "PowerOutageLog_deviceId_startedAt_idx" ON "PowerOutageLog"("deviceId", "startedAt");

-- AddForeignKey
ALTER TABLE "PzemDailySnapshot" ADD CONSTRAINT "PzemDailySnapshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PzemDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerOutageLog" ADD CONSTRAINT "PowerOutageLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PzemDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
