-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('BROWSER', 'ANALYZER', 'CROPPER', 'COMPOSITOR', 'PRESENTER', 'ORCHESTRATOR', 'LAYOUT_READER', 'IMAGE_GENERATOR');

-- CreateEnum
CREATE TYPE "ReferenceOrigin" AS ENUM ('UPLOADED', 'IMPORTED', 'GENERATED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "libraryItems" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "gcsUri" TEXT NOT NULL,
    "thumbGcsUri" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "width" INTEGER,
    "height" INTEGER,
    "contentHash" TEXT,
    "sourceReferenceId" TEXT,
    "editIntent" TEXT NOT NULL DEFAULT '',
    "editRationale" TEXT NOT NULL DEFAULT '',
    "cropBox" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "editAspect" TEXT NOT NULL DEFAULT '',
    "origin" "ReferenceOrigin" NOT NULL DEFAULT 'UPLOADED',
    "generationPrompt" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "colorPalette" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lighting" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "texture" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "composition" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contrastDepth" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crop" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "gcsUri" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT '',
    "boxYmin" INTEGER NOT NULL,
    "boxXmin" INTEGER NOT NULL,
    "boxYmax" INTEGER NOT NULL,
    "boxXmax" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Moodboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled board',
    "widthPx" INTEGER NOT NULL DEFAULT 1920,
    "heightPx" INTEGER NOT NULL DEFAULT 1080,
    "renderUri" TEXT,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "appState" JSONB NOT NULL DEFAULT '{}',
    "renderRevision" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "pageNames" TEXT[],
    "layout" TEXT,
    "layoutSlots" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Moodboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodboardTile" (
    "id" TEXT NOT NULL,
    "moodboardId" TEXT NOT NULL,
    "cropId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "z" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MoodboardTile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moodboardId" TEXT,
    "slidesFileId" TEXT,
    "webViewLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "sessionId" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "model" TEXT,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Reference_projectId_isFavorite_createdAt_idx" ON "Reference"("projectId", "isFavorite", "createdAt");

-- CreateIndex
CREATE INDEX "Reference_projectId_createdAt_idx" ON "Reference"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Reference_projectId_contentHash_idx" ON "Reference"("projectId", "contentHash");

-- CreateIndex
CREATE INDEX "Reference_sourceReferenceId_createdAt_idx" ON "Reference"("sourceReferenceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_referenceId_key" ON "Analysis"("referenceId");

-- CreateIndex
CREATE INDEX "Crop_referenceId_idx" ON "Crop"("referenceId");

-- CreateIndex
CREATE INDEX "Moodboard_projectId_createdAt_idx" ON "Moodboard"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "MoodboardTile_moodboardId_z_idx" ON "MoodboardTile"("moodboardId", "z");

-- CreateIndex
CREATE INDEX "MoodboardTile_cropId_idx" ON "MoodboardTile"("cropId");

-- CreateIndex
CREATE INDEX "Deck_projectId_createdAt_idx" ON "Deck"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Deck_moodboardId_idx" ON "Deck"("moodboardId");

-- CreateIndex
CREATE INDEX "AgentRun_projectId_startedAt_idx" ON "AgentRun"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_sourceReferenceId_fkey" FOREIGN KEY ("sourceReferenceId") REFERENCES "Reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "Reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crop" ADD CONSTRAINT "Crop_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "Reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moodboard" ADD CONSTRAINT "Moodboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodboardTile" ADD CONSTRAINT "MoodboardTile_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodboardTile" ADD CONSTRAINT "MoodboardTile_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "Crop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

