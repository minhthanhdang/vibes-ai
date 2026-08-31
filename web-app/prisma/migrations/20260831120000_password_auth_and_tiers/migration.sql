-- CreateEnum
CREATE TYPE "AccountTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "googleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "tier" "AccountTier" NOT NULL DEFAULT 'TIER_3';
ALTER TABLE "User" ADD COLUMN "vibesBoardsUsed" INTEGER NOT NULL DEFAULT 0;

UPDATE "User" SET "tier" = 'TIER_2';

ALTER TABLE "User" ADD CONSTRAINT "User_signin_method_present"
  CHECK ("googleId" IS NOT NULL OR "passwordHash" IS NOT NULL);
