import type { ReferenceOrigin } from "@/generated/prisma/enums";
import { isGeneratedOrigin } from "@/lib/references/reference-filter";

const ASK = "Analyze this reference.";

/// What agent 2 is told about a picture before it looks at one.
///
/// The analyzer is handed the image and one sentence of context, and that
/// sentence used to be "The user filed it as …" about every reference in the
/// project. On a picture `generate_image` drew, both halves of it are false:
/// the user filed nothing and named nothing — the title is an opening clause
/// cut out of the assistant's own description, numbered where the project
/// already held that name. Told that a person chose those words, a model that
/// is asked to name the picture and to read its look reads them as the user's
/// intent about a photograph they took.
///
/// The truth is worth more than the correction, too. A drawing is the one
/// reference in the project whose subject was written down *before* it existed,
/// and the description is a far better statement of what is in the frame than
/// any filename — which is what the upload branch is quoting.
///
/// It is quoted whole, and it is quoted with a warning. Image models drop parts
/// of a prompt, so a description asking for rain on a window is evidence rather
/// than fact, and an analyzer that reads the request instead of the picture
/// would tag a dimension nothing in the frame supports. Agent 2's standing rule
/// is "describe only what is in the frame"; this is the one input that could
/// tempt it off that rule, so the sentence carrying it says so.
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
    /// A cut of a drawn picture inherits the origin and not the words — only
    /// the frame was ever asked for — so the name it was filed under is all
    /// this branch has left to say.
    if (!asked) return named ? `${ASK} ${drawn} It is filed as "${named}".` : `${ASK} ${drawn}`;
    return `${ASK} ${drawn} It was asked for like this: "${asked}". Read what is in the frame — a drawing does not always hold everything it was asked for.`;
  }

  return named ? `${ASK} The user filed it as "${named}".` : ASK;
}
