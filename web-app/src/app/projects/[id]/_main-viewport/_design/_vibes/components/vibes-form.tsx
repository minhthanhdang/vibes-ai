"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { PAGE_PRESETS, PAGE_PRESET_IDS, type PagePresetId } from "@/lib/layout/moodboard-layouts";
import { VIBES_PAGE_LIMIT, VIBES_PALETTE_LIMIT, VIBES_TEXT_LIMIT } from "@/lib/vibes/vibes-brief";
import {
  VIBES_DEFAULT_COLOUR,
  vibesDraft,
  vibesPaletteNote,
  vibesRefusals,
  vibesSubmittable,
  type VibesDraft,
} from "@/lib/vibes/vibes-form";
import { announceVibesRun } from "../../../../_events/vibes-run";

/// "Let's Vibes" — the form (compositor-v2.md §IX.1).
///
/// Five fields, and every one of them is a *constraint* rather than an
/// instruction: the difference is that a constraint is something the finished
/// board can be checked against. That is why the palette is swatches and not a
/// sentence, why the page count is a row of numbers, and why the one field
/// deliberately left unstructured — the vibes — is the half of a brief that
/// does not survive being turned into a dropdown.
///
/// It decides nothing. `vibesDraft` says what it opens holding, `vibesRefusals`
/// says what to put beside a field, and `vibesBrief` on the server reads the
/// submission again — this file is the fields and the arithmetic of the bill.

/// What the run costs, said on the button that starts it. Six design calls is
/// the most expensive single action in this product and it is one click from
/// the canvas (§IX.4); a button reading "Start" would be the only place that
/// cost is not visible.
function cost(pages: number) {
  return pages === 1 ? "Design 1 page" : `Design ${pages} pages`;
}

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
/// picker: the first is the theme colour — the one every page is printed on
/// before a single design call runs — so the order is shown rather than sorted,
/// and it is said out loud on the swatch that carries it.
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
            aria-label={index === 0 ? "Theme colour" : `Colour ${index + 1}`}
            title={
              index === 0
                ? "The theme colour — every page is printed on this one before it is designed"
                : colour
            }
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
  onStarted: (run: { boardId: string; pageIds: string[] }) => void;
}) {
  /// Seeded once. A palette that reseeded as the analysis queue settled would
  /// take back a colour the user had already removed.
  const [draft, setDraft] = useState<VibesDraft>(() => vibesDraft({ palettes }));
  /// Nothing is refused out loud until the form has been submitted once — a
  /// form that opens already telling the user the purpose is empty is a form
  /// scolding them for not having typed yet.
  const [asked, setAsked] = useState(false);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const start = useMutation(
    trpc.vibes.start.mutationOptions({
      onSuccess: async (run) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
        });
        /// And the switcher, which has just gained the run's own thread
        /// (orchestrator-tool-reference §VII.9). The column is deliberately not
        /// moved onto it — the user is watching the panel — but it has to be
        /// *there* to be walked into.
        await queryClient.invalidateQueries({
          queryKey: trpc.chat.conversations.queryKey({ projectId }),
        });
        /// The run is announced from here rather than handed up through the
        /// canvas: this form is the last thing that knows what was asked for,
        /// and the board it made is about to replace the one this component is
        /// mounted on (§IX.2).
        announceVibesRun({
          boardId: run.boardId,
          title: run.title,
          total: run.pageIds.length,
          steps: run.pageIds.map((pageId, index) => ({ pageId, index })),
        });
        onStarted({ boardId: run.boardId, pageIds: run.pageIds });
      },
    }),
  );

  const refusals = asked ? vibesRefusals(draft) : {};
  const field = <K extends keyof VibesDraft>(key: K, value: VibesDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAsked(true);
    if (!vibesSubmittable(draft) || start.isPending) return;
    start.mutate({ projectId, ...draft, purpose: draft.purpose.trim(), vibes: draft.vibes.trim() });
  }

  return (
    <div
      data-board-overlay
      className="absolute inset-0 z-20 grid place-items-center bg-black/30 p-4"
    >
      <form
        onSubmit={submit}
        aria-label="Let's Vibes"
        className="flex w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl border border-current/10 bg-[var(--background)] p-4 text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
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

        <Field
          label="What is being made"
          hint={`${draft.purpose.trim().length}/${VIBES_TEXT_LIMIT}`}
          refusal={refusals.purpose}
        >
          <input
            value={draft.purpose}
            onChange={(event) => field("purpose", event.target.value)}
            placeholder="a welcome sign for a rustic autumn wedding"
            autoFocus
            className="rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
          />
        </Field>

        <Field label="Pages" hint="one design call each" refusal={refusals.pages}>
          <div className="flex gap-1.5">
            {Array.from({ length: VIBES_PAGE_LIMIT }, (_, index) => index + 1).map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => field("pages", count)}
                aria-pressed={draft.pages === count}
                className={`size-8 rounded-md border text-xs ${
                  draft.pages === count
                    ? "border-current/60 bg-current/10 font-medium"
                    : "border-current/20 opacity-60 hover:opacity-100"
                }`}
              >
                {count}
              </button>
            ))}
          </div>
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
                onClick={() => field("preset", preset)}
                aria-pressed={draft.preset === preset}
                title={`${PAGE_PRESETS[preset].width} × ${PAGE_PRESETS[preset].height}`}
                className={`rounded-md border px-2 py-1 text-xs ${
                  draft.preset === preset
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
          hint="the first is the theme colour"
          refusal={refusals.palette}
          note={vibesPaletteNote(draft.palette)}
        >
          <Palette colours={draft.palette} onChange={(colours) => field("palette", colours)} />
        </Field>

        <Field
          label="Vibes"
          hint={`${draft.vibes.trim().length}/${VIBES_TEXT_LIMIT}`}
          refusal={refusals.vibes}
        >
          <input
            value={draft.vibes}
            onChange={(event) => field("vibes", event.target.value)}
            placeholder="warm, intimate, candlelit"
            className="rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
          />
        </Field>

        {start.error ? (
          <p className="text-[11px] text-red-500">
            The board could not be started — {start.error.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={start.isPending}
          className="rounded-md bg-current/90 px-3 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-50"
        >
          {start.isPending ? "Making the board…" : cost(draft.pages)}
        </button>
      </form>
    </div>
  );
}
