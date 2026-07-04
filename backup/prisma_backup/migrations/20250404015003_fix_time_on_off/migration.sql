/*
  Warnings:

  - You are about to drop the column `turnOffAt` on the `OutputState` table. All the data in the column will be lost.
  - You are about to drop the column `turnOnAt` on the `OutputState` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OutputState" DROP COLUMN "turnOffAt",
DROP COLUMN "turnOnAt",
ADD COLUMN     "turnOffTime" TEXT,
ADD COLUMN     "turnOnTime" TEXT;
