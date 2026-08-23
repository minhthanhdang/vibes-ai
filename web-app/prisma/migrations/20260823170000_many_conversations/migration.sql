-- The first migration in this repo to carry data statements
-- (orchestrator-tool-reference §VII.8).
--
-- Prisma's own diff for this schema emits one destructive
-- `ALTER TABLE "ChatMessage" DROP COLUMN "projectId", ADD COLUMN "conversationId" TEXT NOT NULL`,
-- which fails outright on a non-empty table and, on an empty one, silently loses
-- which project every message belonged to. So that statement is split and the
-- drop moved last, with the backfill in between. Every identifier below is
-- Prisma's own, verbatim: a hand-picked constraint or index name is invisible to
-- `migrate deploy` and then makes the *next* `migrate dev` generate a phantom
-- corrective migration, because the shadow database replays this file and diffs
-- the result against the schema.
--
-- All of it runs inside the one transaction `migrate deploy` wraps a migration
-- in, so a failure at `SET NOT NULL` leaves the old column and no half-adopted
-- rows.

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_projectId_updatedAt_idx" ON "Conversation"("projectId", "updatedAt");

-- AlterTable: nullable for the length of the backfill.
ALTER TABLE "ChatMessage" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "Moodboard" ADD COLUMN     "conversationId" TEXT;

-- Backfill: one conversation per project that has messages, and it adopts all of
-- them. `createdAt`/`updatedAt` come off the message range rather than off the
-- clock, so the switcher's ordering is right on the first load instead of
-- showing every old project as touched at migration time. `title` stays empty —
-- the thread derives its own name from its own first message the way a new one
-- does, and no label is invented for it (§VII.8).
--
-- The ids are uuids where the app writes cuids. Both are opaque strings behind
-- `@id` and nothing in the app parses one.
INSERT INTO "Conversation" ("id", "projectId", "title", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."projectId", '', MIN(m."createdAt"), MAX(m."createdAt")
FROM "ChatMessage" m
GROUP BY m."projectId";

UPDATE "ChatMessage" m
SET "conversationId" = c."id"
FROM "Conversation" c
WHERE c."projectId" = m."projectId";

ALTER TABLE "ChatMessage" ALTER COLUMN "conversationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_seq_idx" ON "ChatMessage"("conversationId", "seq");

-- CreateIndex
CREATE INDEX "Moodboard_conversationId_idx" ON "Moodboard"("conversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moodboard" ADD CONSTRAINT "Moodboard_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Last, so everything above could still read the column it replaces. Dropping
-- the column takes its foreign key with it.
-- DropIndex
DROP INDEX "ChatMessage_projectId_seq_idx";

ALTER TABLE "ChatMessage" DROP COLUMN "projectId";
