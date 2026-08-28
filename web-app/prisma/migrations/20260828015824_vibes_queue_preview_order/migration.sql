-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'VIBES';

-- AlterTable
ALTER TABLE "Moodboard" ADD COLUMN     "previewOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
