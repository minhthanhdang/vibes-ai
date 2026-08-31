import type { ReferenceOrigin } from "@/generated/prisma/enums";

export const SEED_PREFIX = "seeds/";

export type SeedAnalysis = {
  title: string;
  colorPalette: string[];
  lighting: string[];
  texture: string[];
  composition: string[];
  subject: string[];
  contrastDepth: string[];
  rationale: string;
  model: string;
};

export type SeedReference = {
  object: string;
  thumbObject: string | null;
  title: string;
  width: number | null;
  height: number | null;
  contentHash: string | null;
  origin: ReferenceOrigin;
  generationPrompt: string | null;
  analysis: SeedAnalysis | null;
};

export type SeedManifest = {
  slug: string;
  title: string;
  brief: string;
  references: SeedReference[];
};
