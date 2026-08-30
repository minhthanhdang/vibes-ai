import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { isGeneratedOrigin } from "@/lib/references/reference-filter";

const ASK = "Analyze this reference.";

export function analysisAskSaid({
  title,
  origin,
  generationPrompt,
}: {
  title?: string | null;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
}) {
  const named = (title ?? "").trim();
  const asked = (generationPrompt ?? "").trim();

  if (isGeneratedOrigin(origin)) {
    const drawn = "This picture was drawn by an image model rather than shot.";
    if (!asked) return named ? `${ASK} ${drawn} It is filed as "${named}".` : `${ASK} ${drawn}`;
    return `${ASK} ${drawn} It was asked for like this: "${asked}". Read what is in the frame — a drawing does not always hold everything it was asked for.`;
  }

  return named ? `${ASK} The user filed it as "${named}".` : ASK;
}
