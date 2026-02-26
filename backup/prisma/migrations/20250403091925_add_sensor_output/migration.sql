-- CreateEnum
CREATE TYPE "OutputMode" AS ENUM ('MANUAL', 'AUTO_SUN', 'AUTO_DATETIME');

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "voltage" DOUBLE PRECISION NOT NULL,
    "ph" DOUBLE PRECISION NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "ldr" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Output" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Output_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputState" (
    "id" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "state" BOOLEAN NOT NULL,
    "mode" "OutputMode" NOT NULL,
    "turnOnAt" TIMESTAMP(3),
    "turnOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutputState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Output_name_key" ON "Output"("name");

-- AddForeignKey
ALTER TABLE "OutputState" ADD CONSTRAINT "OutputState_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;
