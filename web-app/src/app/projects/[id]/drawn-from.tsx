"use client";

import { drawnFromSaid } from "@/lib/references/generated-image";

/// What a picture the assistant drew was drawn from, above the reading of it
/// rather than inside it: the analyzer says what a picture looks like, and this
/// says what it *is* — the only record of that until the reading lands, and the
/// one thing about this reference no photograph in the project has. The prompt
/// is quoted rather than paraphrased, since it is the user's own ask as the
/// assistant passed it on.
///
/// It stands wherever a picture's properties are shown, which is the three
/// surfaces `ReferenceProperties` stands on: the sidebar panel, the full-size
/// viewer and the board's inspector. A drawn backdrop is looked at from all
/// three — it is on a board more often than a photograph is, since it was drawn
/// to go there — and the analysis it sits above is minutes behind on the one
/// picture whose subject was written down before it existed.
///
/// Nothing at all for a reference nobody drew, which is most of them, and for a
/// cut of a drawn picture: a version was made out of a box on a frame rather
/// than out of words.
export function DrawnFrom({
  reference,
}: {
  reference: { generationPrompt?: string | null } | null | undefined;
}) {
  const prompt = drawnFromSaid(reference);
  if (!prompt) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
        Drawn from
      </h3>
      <p className="text-sm leading-relaxed opacity-80">“{prompt}”</p>
    </section>
  );
}
