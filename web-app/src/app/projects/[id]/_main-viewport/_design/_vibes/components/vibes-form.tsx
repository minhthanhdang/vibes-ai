"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_SIZE_MAX,
  VIBES_SIZE_MIN,
  VIBES_TEXT_LIMIT,
} from "@/lib/vibes/vibes-brief";
import {
  VIBES_DEFAULT_COLOUR,
  addVibesCard,
  removeVibesCard,
  updateVibesCard,
  vibesBatchBill,
  vibesBatchDraft,
  vibesBatchRefusal,
  vibesBatchSubmittable,
  vibesCardRefusals,
  vibesPaletteNote,
  type VibesCardDraft,
  type VibesCardRefusals,
} from "@/lib/vibes/vibes-form";

function Field({
  label,
  hint,
  refusal,
  note,
  children,
}: {
  label: string;
  hint?: string;
  refusal?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide uppercase opacity-60">{label}</span>
        {hint ? <span className="text-[11px] opacity-45">{hint}</span> : null}
      </div>
      {children}
      {refusal ? <p className="text-[11px] text-red-500">{refusal}</p> : null}
      {note ? <p className="text-[11px] opacity-55">{note}</p> : null}
    </div>
  );
}

function Palette({
  colours,
  onChange,
}: {
  colours: string[];
  onChange: (colours: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colours.map((colour, index) => (
        <span key={index} className="relative">
          <input
            type="color"
            value={colour}
            onChange={(event) =>
              onChange(colours.map((held, at) => (at === index ? event.target.value : held)))
            }
            aria-label={`Colour ${index + 1}`}
            title={colour}
            className="size-8 cursor-pointer rounded-md border border-current/20 bg-transparent p-0"
          />
          {colours.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange(colours.filter((_, at) => at !== index))}
              aria-label={`Remove ${colour}`}
              className="absolute -top-1.5 -right-1.5 size-4 rounded-full border border-current/20 bg-[var(--background)] text-[10px] leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {colours.length < VIBES_PALETTE_LIMIT ? (
        <button
          type="button"
          onClick={() => onChange([...colours, VIBES_DEFAULT_COLOUR])}
          className="size-8 rounded-md border border-dashed border-current/25 text-xs opacity-60 hover:opacity-100"
        >
          +
        </button>
      ) : null}
    </div>
  );
}

function CountRow({
  limit,
  held,
  label,
  onPress,
}: {
  limit: number;
  held: number;
  label: (count: number) => string;
  onPress: (count: number) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
        <button
          key={count}
          type="button"
          onClick={() => onPress(count)}
          aria-pressed={held === count}
          aria-label={label(count)}
          className={`size-8 rounded-md border text-xs ${
            held === count
              ? "border-current/60 bg-current/10 font-medium"
              : "border-current/20 opacity-60 hover:opacity-100"
          }`}
        >
          {count}
        </button>
      ))}
    </div>
  );
}

function BriefCard({
  card,
  index,
  alone,
  refusals,
  autoFocus,
  onCard,
  onRemove,
}: {
  card: VibesCardDraft;
  index: number;
  alone: boolean;
  refusals: VibesCardRefusals;
  autoFocus: boolean;
  onCard: (patch: Partial<VibesCardDraft>) => void;
  onRemove?: () => void;
}) {
  const fields = (
    <>
      <Field
        label="What is being made"
        hint={`${card.purpose.trim().length}/${VIBES_TEXT_LIMIT}`}
        refusal={refusals.purpose}
      >
        <textarea
          value={card.purpose}
          onChange={(event) => onCard({ purpose: event.target.value })}
          placeholder="a welcome sign for a rustic autumn wedding"
          autoFocus={autoFocus}
          rows={3}
          className="resize-none rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
        />
      </Field>

      <Field label="Pages" hint="one design call each" refusal={refusals.pages}>
        <CountRow
          limit={VIBES_PAGE_LIMIT}
          held={card.pages}
          label={(count) => `${count} page${count === 1 ? "" : "s"}`}
          onPress={(pages) => onCard({ pages })}
        />
      </Field>

      <Field
        label="Samples"
        hint="how many samples do you want to generate"
        refusal={refusals.designs}
      >
        <CountRow
          limit={VIBES_DESIGN_LIMIT}
          held={card.designs}
          label={(count) => `${count} sample${count === 1 ? "" : "s"}`}
          onPress={(designs) => onCard({ designs })}
        />
      </Field>

      <Field
        label="Page size"
        hint="width × height in pixels, every page, not changeable after"
        refusal={refusals.width ?? refusals.height}
      >
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min={VIBES_SIZE_MIN}
            max={VIBES_SIZE_MAX}
            step={1}
            value={Number.isFinite(card.width) ? card.width : ""}
            onChange={(event) => onCard({ width: event.target.valueAsNumber })}
            aria-label="Width"
            className="w-24 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
          />
          <span className="text-xs opacity-60">×</span>
          <input
            type="number"
            inputMode="numeric"
            min={VIBES_SIZE_MIN}
            max={VIBES_SIZE_MAX}
            step={1}
            value={Number.isFinite(card.height) ? card.height : ""}
            onChange={(event) => onCard({ height: event.target.valueAsNumber })}
            aria-label="Height"
            className="w-24 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
          />
        </div>
      </Field>

      <Field
        label="Palette"
        hint="the colours the pages are designed in"
        refusal={refusals.palette}
        note={vibesPaletteNote(card.palette)}
      >
        <Palette colours={card.palette} onChange={(palette) => onCard({ palette })} />
      </Field>

      <Field
        label="Vibes"
        hint={`${card.vibes.trim().length}/${VIBES_TEXT_LIMIT}`}
        refusal={refusals.vibes}
      >
        <input
          value={card.vibes}
          onChange={(event) => onCard({ vibes: event.target.value })}
          placeholder="warm, intimate, candlelit"
          className="rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
        />
      </Field>
    </>
  );

  if (alone) return fields;

  const refusing = Object.keys(refusals).length > 0;
  return (
    <section
      aria-label={`Brief ${index + 1}`}
      className={`flex flex-col gap-4 rounded-lg border p-3 ${
        refusing ? "border-red-500/50" : "border-current/15"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide uppercase opacity-60">
          Brief {index + 1}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove brief ${index + 1}`}
            className="text-xs opacity-50 hover:opacity-100"
          >
            ×
          </button>
        ) : null}
      </div>
      {fields}
    </section>
  );
}

export function VibesForm({
  projectId,
  palettes,
  onClose,
  onStarted,
}: {
  projectId: string;
  palettes: readonly (readonly unknown[])[];
  onClose: () => void;
  onStarted: (run: { boardId: string }) => void;
}) {
  const [cards, setCards] = useState<VibesCardDraft[]>(() => vibesBatchDraft({ palettes }));
  const [asked, setAsked] = useState(false);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const start = useMutation(
    trpc.vibes.startBatch.mutationOptions({
      onSuccess: async ({ boards }) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.chat.conversations.queryKey({ projectId }),
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.vibes.activeRuns.queryKey(),
        });
        const first = boards[0];
        if (first) onStarted({ boardId: first.boardId });
      },
    }),
  );

  const refusals = cards.map((card) => (asked ? vibesCardRefusals(card) : {}));
  const overBudget = asked ? vibesBatchRefusal(cards) : "";
  const boardCount = cards.reduce((sum, card) => sum + card.designs, 0);

  function submit() {
    setAsked(true);
    if (!vibesBatchSubmittable(cards) || start.isPending) return;
    start.mutate({
      projectId,
      forms: cards.map((card) => ({
        ...card,
        purpose: card.purpose.trim(),
        vibes: card.vibes.trim(),
      })),
    });
  }

  return (
    <div
      data-board-overlay
      className="absolute inset-0 z-20 grid place-items-center bg-black/30 p-4"
    >
      <form
        onSubmit={(event) => event.preventDefault()}
        aria-label="Let's Vibes"
        className="flex max-h-full w-full max-w-md flex-col gap-4 rounded-xl border border-current/10 bg-[var(--background)] p-4 text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Let&rsquo;s Vibes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xs opacity-50 hover:opacity-100"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {cards.map((card, index) => (
            <BriefCard
              key={index}
              card={card}
              index={index}
              alone={cards.length === 1}
              refusals={refusals[index] ?? {}}
              autoFocus={index === 0}
              onCard={(patch) => setCards((held) => updateVibesCard(held, index, patch))}
              onRemove={
                cards.length > 1
                  ? () => setCards((held) => removeVibesCard(held, index))
                  : undefined
              }
            />
          ))}

          {cards.length < VIBES_FORM_LIMIT ? (
            <button
              type="button"
              onClick={() => setCards((held) => addVibesCard(held, { palettes }))}
              className="rounded-md border border-dashed border-current/25 px-2 py-1.5 text-xs opacity-60 hover:opacity-100"
            >
              + Add another brief
            </button>
          ) : null}
        </div>

        {start.error ? (
          <p className="text-[11px] text-red-500">
            The boards could not be started — {start.error.message}
          </p>
        ) : null}

        {overBudget ? <p className="text-[11px] text-red-500">{overBudget}</p> : null}

        <button
          type="button"
          onClick={submit}
          disabled={start.isPending}
          className="flex flex-col items-center gap-0.5 rounded-md bg-[var(--foreground)] px-3 py-2 text-[var(--background)] hover:opacity-90 disabled:opacity-50"
        >
          <span className="text-sm font-medium">
            {start.isPending
              ? boardCount === 1
                ? "Making the board…"
                : "Making the boards…"
              : "Let’s Vibes"}
          </span>
          {start.isPending ? null : (
            <span className="text-[11px] opacity-75">{vibesBatchBill(cards)}</span>
          )}
        </button>
      </form>
    </div>
  );
}
