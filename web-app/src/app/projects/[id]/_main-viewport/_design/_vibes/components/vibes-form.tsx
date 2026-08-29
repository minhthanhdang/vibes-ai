"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { PAGE_PRESETS, PAGE_PRESET_IDS, type PagePresetId } from "@/lib/layout/moodboard-layouts";
import {
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
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

/// "Let's Vibes" — the form (compositor-v2.md §IX.1), now a stack of brief
/// cards with one submit (multi-vibes-and-preview-prd §II.7).
///
/// Every field is a *constraint* rather than an instruction: the difference is
/// that a constraint is something the finished board can be checked against.
/// That is why the palette is swatches and not a sentence, why the page count
/// is a row of numbers, and why the one field deliberately left unstructured —
/// the vibes — is the half of a brief that does not survive being turned into
/// a dropdown. The stack adds one more count per card — how many boards this
/// brief becomes — and the common case pays nothing for it: one card, one
/// design, is today's form with a row of one pressed button.
///
/// It decides nothing. `vibesBatchDraft` says what it opens holding,
/// `vibesCardRefusals` what to put beside a card's field, `vibesBatchRefusal`
/// what the button says about the sum, and `vibesBatch` on the server reads
/// the submission again — this file is the fields and the arithmetic of the
/// bill.

const PRESET_LABELS: Record<PagePresetId, string> = {
  LANDSCAPE_HD: "Landscape",
  PORTRAIT_HD: "Portrait",
  SQUARE: "Square",
};

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
  /// A reading of what is in the field, not a reason it cannot be submitted —
  /// drawn quietly and under the refusal, since a form that shows a fact in the
  /// same red as an error is a form that has taught the user to dismiss both.
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
      {/* Beside the field it belongs to, because a form that refuses itself in
          one line at the bottom is a form the user reads twice. */}
      {refusal ? <p className="text-[11px] text-red-500">{refusal}</p> : null}
      {note ? <p className="text-[11px] opacity-55">{note}</p> : null}
    </div>
  );
}

/// The palette, and the only field here that is a list. Each colour is its own
/// picker, shown in the order they were typed rather than sorted — that is the
/// order the prompt reads them in. No swatch is the ground: what the pages
/// stand on is the design agent's, not the form's.
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
          {/* Removable down to one: the palette is the constraint the model is
              held to, and a board with no colours in the ask is a board with
              no colours in the answer. */}
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

/// A row of small numbered buttons — the shape both counts on a card take,
/// because a count with a visible ceiling is a bill the user reads before
/// pressing it.
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

/// One brief card — today's five fields plus the designs row. Alone in the
/// stack it draws no chrome of its own, so the single-card form *is* the form
/// this dialog has always been; with company it gets a border, a number and a
/// remove button, and a refusing card wears its refusal on the border because
/// one card holds the whole batch (§II.7) and the held cards deserve to see
/// which one.
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
        hint="every page, and not changeable after"
        refusal={refusals.preset}
      >
        <div className="flex gap-1.5">
          {PAGE_PRESET_IDS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onCard({ preset })}
              aria-pressed={card.preset === preset}
              title={`${PAGE_PRESETS[preset].width} × ${PAGE_PRESETS[preset].height}`}
              className={`rounded-md border px-2 py-1 text-xs ${
                card.preset === preset
                  ? "border-current/60 bg-current/10 font-medium"
                  : "border-current/20 opacity-60 hover:opacity-100"
              }`}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </Field>

      {/* Said whatever has been typed elsewhere, because it is about the
          colours and not about the form (§IX.5). */}
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
        {/* The last card is not removable, so the stack never goes below one —
            the pure helper refuses too, but a button that does nothing is
            worse than no button. */}
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
  /// Agent 2's answer about every photograph in the project, as the canvas
  /// already holds it. Passed rather than fetched: the board is looking at the
  /// same query, so the seed costs no round trip of its own.
  palettes: readonly (readonly unknown[])[];
  onClose: () => void;
  onStarted: (run: { boardId: string }) => void;
}) {
  /// Seeded once per card at its creation. A palette that reseeded as the
  /// analysis queue settled would take back a colour the user had already
  /// removed.
  const [cards, setCards] = useState<VibesCardDraft[]>(() => vibesBatchDraft({ palettes }));
  /// Nothing is refused out loud until the form has been submitted once — a
  /// form that opens already telling the user the purpose is empty is a form
  /// scolding them for not having typed yet.
  const [asked, setAsked] = useState(false);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const start = useMutation(
    trpc.vibes.startBatch.mutationOptions({
      onSuccess: async ({ boards }) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
        });
        /// And the switcher, which has just gained a thread per board
        /// (orchestrator-tool-reference §VII.9). The column is deliberately not
        /// moved onto any of them — the user is watching the panel — but they
        /// have to be *there* to be walked into.
        await queryClient.invalidateQueries({
          queryKey: trpc.chat.conversations.queryKey({ projectId }),
        });
        /// Nothing is announced any more: `startBatch` filed each board's
        /// page-1 job before it answered, and this is what puts the cards up —
        /// the panel's poll is off while it has none, so the queue is asked
        /// again now (multi-vibes-and-preview-prd §II.6).
        await queryClient.invalidateQueries({
          queryKey: trpc.vibes.activeRuns.queryKey(),
        });
        /// The first board is the one to be looking at; the rest are the
        /// progress panel's to show (§II.3).
        const first = boards[0];
        if (first) onStarted({ boardId: first.boardId });
      },
    }),
  );

  const refusals = cards.map((card) => (asked ? vibesCardRefusals(card) : {}));
  const overBudget = asked ? vibesBatchRefusal(cards) : "";
  const boardCount = cards.reduce((sum, card) => sum + card.designs, 0);

  /// Only the button calls this. The form itself refuses to submit at all
  /// (below), so a brief is never spent by an Enter pressed in a field.
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
        /// Nothing here submits implicitly: the boards cost money, so they are
        /// started by pressing the button and by nothing else. Enter in a field
        /// types a newline or does nothing, never a batch.
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

        {/* The card list is what scrolls; the title above and the bill below
            stay pinned, because the button carries the sum and a sum that
            scrolls away with its cards is a bill nobody read (§II.7). */}
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

        {/* The batch ceiling is a property of the sum, not of any card, so its
            refusal renders here at the button that says the sum. */}
        {overBudget ? <p className="text-[11px] text-red-500">{overBudget}</p> : null}

        {/* The one thing that starts the batch. It says what it is on the top
            line and what it costs on the second, because a button labelled only
            with its bill reads as a caption rather than a control. */}
        <button
          type="button"
          onClick={submit}
          disabled={start.isPending}
          className="flex flex-col items-center gap-0.5 rounded-md bg-current/90 px-3 py-2 text-[var(--background)] disabled:opacity-50"
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
