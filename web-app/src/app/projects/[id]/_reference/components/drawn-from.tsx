"use client";

import { drawnFromSaid } from "@/lib/references/generated-image";

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
