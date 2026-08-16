"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  EDIT_INTENT_LIMIT,
  cropBoxOf,
  cropCoverageLabel,
  cropSizeLabel,
  cropSoftOnBoard,
  existingCut,
  sameCut,
  versionLabel,
  versionNote,
} from "@/lib/reference-version";
import {
  REFERENCE_DRAG_MIME,
  encodeReferenceDrag,
  referenceDragItem,
} from "@/lib/moodboard-drop";
import { referenceUsageIndex, usageSummary, usingBoards } from "@/lib/reference-usage";
import type { TrailStep } from "@/lib/reference-trail";
import { useBoardPlacement } from "./board-placement";
import { useReferenceCrop, type CropStage } from "./crop-reference";
import { RemoveReferenceButton } from "./remove-reference";

/// The other half of a reference's properties: not what this photograph is, but
/// the ways it has been used.
///
/// A version has no tile in the gallery on purpose — the grid is the photos of
/// the project, and a cut of one is not a second photo. It lives here instead,
/// under the frame it came out of, which is also where the director asks for it:
/// the prompt below is agent 3, and the row it produces appears in the list
/// above the moment it lands. It lands only when the box the cropper answered
/// with — drawn on the frame at the top of this panel — is taken, since nothing
/// has been cut of it until then.
///
/// A cut that was already taken can be asked to move as well: a row's own box is
/// the same kind of box as the one under review, so "Adjust" sends it back to
/// the cropper and the answer arrives as an offer to take or decline. It files a
/// new cut rather than rewriting the row — the row may be on a board, and a
/// board is held up by the reference it points at.
///
/// Not being in the gallery costs it nothing on the board: each row here is a
/// drag source carrying the same payload a gallery tile does, so a cut is placed
/// exactly as the frame it came out of is — which is also the affordance agent 4
/// stands on, since to the board an original and a modification of it are two
/// references with two ids.

const STAGE_LABEL: Record<Exclude<CropStage, "idle">, string> = {
  asking: "Reading the frame…",
  cutting: "Cutting…",
  filing: "Saving…",
};

type ListedVersion = { id: string; width: number | null; height: number | null };

/// One row, one reference: the strip drags a *selection* because a board is
/// built from a set of photos, and the cuts of a single frame are alternatives
/// to each other rather than a set — two of them on the board is the exception,
/// so it costs two drags.
function startVersionDrag(event: React.DragEvent<HTMLElement>, version: ListedVersion) {
  const drawn = event.currentTarget.querySelector("img");
  event.dataTransfer.setData(
    REFERENCE_DRAG_MIME,
    encodeReferenceDrag([referenceDragItem(version, drawn)]),
  );
  event.dataTransfer.effectAllowed = "copy";
}

export function ReferenceVersions({
  projectId,
  referenceId,
  frame,
  onOpen,
  onPoint,
  onPropose,
}: {
  projectId: string;
  referenceId: string;
  /// The frame these cuts are of, for its stored pixels. A proposed box is a
  /// share of the frame, and what that share is *worth* is its size in the
  /// photograph — which the image on screen cannot say, since the panel is
  /// shown the grid-sized copy.
  frame?: { width?: number | null; height?: number | null };
  /// Walking into a cut: it has properties of its own — a palette read off what
  /// it kept — and versions of its own, and this list is the only door to
  /// either, since a version has no gallery tile to open.
  onOpen?: (version: TrailStep) => void;
  /// Which cut the director is pointing at, so the frame above can show where in
  /// it that cut is. Null when the pointer leaves — a box left drawn is a claim
  /// about a row nobody is looking at.
  onPoint?: (cropBox: number[] | null) => void;
  /// The box the cropper just answered with, before anything has been cut of
  /// it — drawn on the frame above by the same overlay a filed cut is pointed
  /// at with, because the frame at panel width is where a box can be judged and
  /// this card is far too small to judge one in.
  onPropose?: (cropBox: number[] | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listOptions = trpc.reference.versions.queryOptions({ referenceId });
  const { data: versions } = useQuery(listOptions);
  const queryKey = listOptions.queryKey;
  const { ask, refine, adjust, keep, discard, proposal, stage, moving, error, dismissError } =
    useReferenceCrop({ projectId, referenceId });
  const [prompt, setPrompt] = useState("");
  /// Kept apart from the first ask's field: the two are never on screen at once,
  /// but a discarded offer must not put the words that moved its box back into
  /// the box that asks for a new one. Shared with the field a filed row opens,
  /// which is the same sentence about the same kind of box — and the two cannot
  /// be on screen together, since a row cannot be adjusted while an offer stands.
  const [adjustment, setAdjustment] = useState("");
  const [armedId, setArmedId] = useState<string | null>(null);
  /// Which filed cut is being asked to move. A row rather than the section: the
  /// nudge is about *that* box, and it is typed under the row whose thumbnail
  /// and outline say which box that is.
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const placed = useBoardPlacement()?.counts;

  const busy = stage !== "idle";

  /// Published upward rather than drawn here. `onPropose` is stable per frame —
  /// the panel rebuilds it only when the step changes, which is the same event
  /// that unmounts this section — so an effect is safe, and a remount answering
  /// null is what clears a box the director walked away from mid-review.
  useEffect(() => {
    onPropose?.(proposal?.cropBox ?? null);
  }, [onPropose, proposal]);

  /// The offer in the lines it is read as: what it was taken to be, what the
  /// cropper made of the asking, how much of the photograph it keeps — and, when
  /// this frame has already been cut there, which of the rows below it repeats.
  const offered = proposal && {
    label: versionLabel({ editIntent: proposal.editIntent }),
    note: versionNote(proposal),
    coverage: cropCoverageLabel(proposal.cropBox),
    /// The other half of that judgement: a share of the frame is a picture or a
    /// smear depending on what the frame is, and the cut is made once — there
    /// are no more pixels to be had afterwards.
    size: cropSizeLabel(proposal.cropBox, frame ?? {}),
    soft: cropSoftOnBoard(proposal.cropBox, frame ?? {}),
    /// Compared against the cuts of this frame, which is the list this one would
    /// join. Two askings of one shot land a unit or two apart at temperature
    /// 0.2, so what the offer is measured against is the region a row names, not
    /// the words it is filed under. The row an adjustment started at is left out
    /// — it is the box being moved, and naming it says nothing.
    repeats: existingCut(proposal.cropBox, versions, { except: proposal.origin?.id }),
    /// The cut this offer was moved from, when the ask started at a filed row.
    moved: proposal.origin,
    /// A nudge the model did not take: the box came back where it was, so the
    /// card is offering to file a second copy of the row it was asked to
    /// improve on — under that row's own label.
    unmoved: proposal.origin ? sameCut(proposal.cropBox, proposal.origin.cropBox) : false,
  };

  /// The same scan the gallery arms a removal behind, for the same reason: a cut
  /// is deleted here and *used* on a board in the other column, and the board is
  /// where the loss shows up. Read only once a removal is being considered, and
  /// `staleTime: 0` because a board is rewritten by its autosave — an answer
  /// cached half a minute ago can miss exactly the board this cut was just
  /// dragged onto.
  const { data: usageSource, isFetching, isError: usageFailed } = useQuery(
    trpc.moodboard.referenceUsage.queryOptions(
      { projectId },
      { enabled: armedId !== null, staleTime: 0 },
    ),
  );
  const usage = useMemo(
    () => (usageSource ? referenceUsageIndex(usageSource) : null),
    [usageSource],
  );
  const isChecking = isFetching || (usage === null && !usageFailed);

  /// Deleting a version is `reference.remove` — a cut is a reference, and what
  /// removing one means (the row, its bucket objects, and any cut made of it)
  /// does not change with where in the app it is asked for. Written into the
  /// list before the round trip because the delete waits on two object deletes,
  /// which is long enough for the click to feel unregistered.
  const remove = useMutation(
    trpc.reference.remove.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (current) =>
          current?.filter((version) => version.id !== id),
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot.previous);
      },
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey });
        /// The frame's tile in the grid counts its cuts, and one fewer is now
        /// there — the count is the gallery's only word about versions.
        await queryClient.invalidateQueries({
          queryKey: trpc.reference.versionCountsByProject.queryOptions({ projectId }).queryKey,
        });
      },
    }),
  );

  return (
    <section className="flex flex-col gap-3 border-t border-current/10 pt-4">
      <h3 className="text-[11px] font-medium tracking-widest uppercase opacity-45">Versions</h3>

      {offered ? (
        /* What agent 3 answered, before it is anything. The box is on the frame
           above; this says what it was read as, why it is where it is, and how
           much of the photograph it keeps — the three things a director needs
           to decline, which until now could only be done by filing the cut and
           then deleting it. */
        <div className="flex flex-col gap-2 rounded-md border border-current/20 p-2.5">
          <span className="text-[11px] font-medium tracking-widest uppercase opacity-45">
            {offered.moved ? "Adjusted crop" : "Proposed crop"}
          </span>
          {/* Which cut this box came out of. An adjustment files a *new* row —
              the one it was moved from stays where it is — so the review has to
              say which row that was, or the director takes a second cut without
              knowing they still hold the first. */}
          {offered.moved ? (
            <span className="text-[11px] opacity-60">
              Moved from “{versionLabel(offered.moved)}”
            </span>
          ) : null}
          <span className="text-xs">{offered.label}</span>
          {offered.note ? <span className="text-[11px] opacity-60">{offered.note}</span> : null}
          {/* A box looks like a shot at any size on a panel-width image; this is
              where a cut too small to place large says so. */}
          {offered.coverage ? (
            <span className="text-[11px] opacity-45">
              {offered.coverage}
              {/* And what that share is in pixels of this photograph, which is
                  what decides whether the cut can be placed: the same 4% is a
                  1200px picture of a 6000px frame and a 160px smear of a
                  screenshot. */}
              {offered.size ? ` — ${offered.size}` : null}
            </span>
          ) : null}
          {/* Soft before it is even taken. Said here rather than discovered on
              the board, because the cut is made once from the original and a
              version's bytes are all any later placement has. */}
          {offered.soft ? (
            <span className="text-[11px] opacity-60">
              Fewer pixels than the board draws a dropped image with — it will
              look soft there
            </span>
          ) : null}
          {/* The same ask twice — a different wording of one shot — comes back
              as the same box, and taken again it is a second copy of a cut this
              frame already has, under a second spelling of its label. Said, not
              refused: the box is the director's, and they may be replacing the
              row they are being pointed at. */}
          {offered.repeats ? (
            <span className="text-[11px] opacity-60">
              Already cut here — “{versionLabel(offered.repeats)}”
            </span>
          ) : null}
          {/* The adjustment that did not take. Nothing on the frame changed, so
              without this line the card reads as a fresh answer and taking it
              files the same picture twice. Said rather than refused, like every
              other duplicate here: the box is still the director's. */}
          {offered.unmoved && offered.moved ? (
            <span className="text-[11px] opacity-60">
              The box did not move — this is still “{versionLabel(offered.moved)}”
            </span>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void keep()}
              disabled={busy}
              className="rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-40"
            >
              {offered.repeats || offered.unmoved ? "Keep anyway" : "Keep"}
            </button>
            <button
              type="button"
              onClick={() => {
                discard();
                setAdjustment("");
              }}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-xs opacity-60 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
            >
              Discard
            </button>
          </div>
          {/* The third answer to a box, and the commonest one: not this and not
              nothing, but this moved. The cropper is given the box it is being
              asked about, so a nudge adjusts that answer instead of reading the
              frame again from nothing — and the offer stays on the frame above
              while it does, which is what the nudge was written against. */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void refine(adjustment);
              setAdjustment("");
            }}
            className="flex gap-2 border-t border-current/10 pt-2"
          >
            <input
              value={adjustment}
              onChange={(event) => setAdjustment(event.target.value)}
              maxLength={EDIT_INTENT_LIMIT}
              disabled={busy}
              placeholder="Not quite? e.g. tighter, more headroom"
              aria-label="What to change about this box"
              className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || adjustment.trim().length === 0}
              className="shrink-0 rounded-md px-3 py-1.5 text-xs opacity-70 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
            >
              Adjust
            </button>
          </form>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            /// Cleared on submit rather than on success: the ask is out for
            /// seconds, and a field still holding the last prompt is one a
            /// director types the next one into the middle of.
            void ask(prompt);
            setPrompt("");
          }}
          className="flex gap-2"
        >
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={EDIT_INTENT_LIMIT}
            disabled={busy}
            placeholder="Crop to… e.g. just the hands"
            aria-label="What to crop this reference to"
            className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || prompt.trim().length === 0}
            className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-40"
          >
            Crop
          </button>
        </form>
      )}

      {busy ? (
        <p className="flex items-center gap-2 text-xs opacity-60" aria-live="polite">
          <span className="size-3 animate-spin rounded-full border-2 border-current/25 border-t-current" />
          {/* The same call, said as what it is doing: a first ask reads the
              frame, and one made about a box — the offer on screen, or a cut
              already filed under this frame — moves that box. */}
          {stage === "asking" && moving ? "Moving the box…" : STAGE_LABEL[stage]}
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 text-xs text-red-500">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={dismissError} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </p>
      ) : null}

      {versions && versions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => {
            /// How many elements of the open board show this cut — the same
            /// question the strip answers for a photo, and undefined here is
            /// either "not placed" or "no board open", which look alike on
            /// purpose: nothing is claimed while the gallery is up.
            const onBoard = placed?.get(version.id);
            const label = versionLabel(version);
            /// What the cropper made of the asking — the only place a director
            /// reads that what they asked for was not in the frame and this box
            /// is the nearest thing that is. Absent on a crop drawn by hand.
            const note = versionNote(version);
            const armed = armedId === version.id;
            const adjusting = adjustingId === version.id;
            /// A row asking a question of its own — delete this, or move this —
            /// is a row that is not also a handle and not also a door.
            const asking = armed || adjusting;
            return (
              <li
                key={version.id}
                /// An armed row is not a drag source: the confirm is two buttons
                /// inside the thing being dragged, and a press that starts a drag
                /// is a press that never becomes the click it was meant to be.
                /// A row holding a field is not one either — a drag begun in a
                /// text input is a drag of the text.
                draggable={!asking}
                onDragStart={(event) => startVersionDrag(event, version)}
                /// Pointing at a row shows the row's box on the frame above.
                /// Focus as well as hover, and on the row rather than on the
                /// button inside it, so tabbing through the list draws the same
                /// boxes hovering it does — React's focus events bubble.
                /// A row being adjusted keeps its box drawn: it is the thing the
                /// sentence being typed is about, and a pointer that wandered
                /// off to the frame to look at it is not the director changing
                /// their mind about which cut they meant.
                onMouseEnter={() => onPoint?.(version.cropBox)}
                onMouseLeave={() => !adjusting && onPoint?.(null)}
                onFocus={() => onPoint?.(version.cropBox)}
                onBlur={() => !adjusting && onPoint?.(null)}
                title={`${label}${onBoard ? " — on this board" : ""} — drag onto the moodboard`}
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md text-xs hover:bg-current/5 ${
                  asking ? "" : "cursor-grab active:cursor-grabbing"
                }`}
              >
                {/* The way into a cut's own properties — and the only one: a
                    version has no gallery tile, so the panel walks from here.
                    A click on a draggable row that was never dragged is still a
                    click, which is what lets the row be both. Dead while the
                    row is armed, for the reason its drag is: a row asking
                    whether to delete this cut is not also a way into it. */}
                <button
                  type="button"
                  disabled={!onOpen || asking}
                  onClick={() =>
                    onOpen?.({
                      id: version.id,
                      title: version.title,
                      thumbUrl: version.thumbUrl,
                      label,
                      /// Carried in: a cut of this cut is measured against
                      /// what this cut actually has, which is already less
                      /// than the photograph had.
                      width: version.width,
                      height: version.height,
                    })
                  }
                  title={`${version.title} — open its properties`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left disabled:cursor-default"
                >
                  {/* The image's own native drag would carry a URL instead of the
                      reference, and it starts before the row's. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={version.thumbUrl}
                    alt={label}
                    loading="lazy"
                    draggable={false}
                    className="size-12 shrink-0 rounded-md object-cover"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{label}</span>
                    {/* Under the asking, not instead of it: the label is what
                        the director asked for and this is what the cropper did
                        with it. Truncated to a line here and shown whole on
                        hover — the list is a way of telling cuts apart, not a
                        place to read a paragraph. */}
                    {note ? (
                      <span className="truncate text-[11px] opacity-50" title={note}>
                        {note}
                      </span>
                    ) : null}
                  </span>
                </button>
                {onBoard ? (
                  <span
                    aria-label="On this board"
                    className="shrink-0 rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] opacity-70"
                  >
                    on board
                  </span>
                ) : null}
                {/* Not every cut is wrong — most are nearly right, and what is
                    wrong with one is where its edges are. Asking the frame again
                    reads the photograph from nothing and answers some other
                    shot; cropping the cut can only take less of it. This asks
                    the cropper to move *this* box, which is what the director
                    meant. Hidden while an offer stands — one box is under review
                    at a time — and hidden on a row with no box of its own, which
                    is a cut with nothing to move: for that one, asking the frame
                    again in the field above is the whole of what can be done. */}
                {!proposal && !armed && cropBoxOf(version.cropBox) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAdjustingId(adjusting ? null : version.id);
                      setAdjustment("");
                      onPoint?.(adjusting ? null : version.cropBox);
                    }}
                    aria-expanded={adjusting}
                    title={`Ask for “${label}” moved`}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] opacity-55 hover:bg-current/8 hover:opacity-100 disabled:opacity-30"
                  >
                    {adjusting ? "Cancel" : "Adjust"}
                  </button>
                ) : null}
                {/* A cut the director did not want is the commonest thing agent 3
                    produces, and until now the only way out of one was deleting
                    the photograph it came from. */}
                <RemoveReferenceButton
                  isArmed={armed}
                  isChecking={isChecking}
                  summary={
                    usageFailed ? "Boards not checked" : usageSummary(usingBoards(usage, version.id))
                  }
                  onArm={() => setArmedId(version.id)}
                  onCancel={() => setArmedId(null)}
                  onConfirm={() => {
                    setArmedId(null);
                    remove.mutate({ id: version.id });
                  }}
                />
                {/* Under the row it is about, so the thumbnail and the box drawn
                    on the frame above say which cut this sentence moves. What
                    comes back is an offer like any other — the row stays until
                    the director deletes it, since a cut on a board is holding
                    that board up. */}
                {adjusting ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void adjust(
                        { id: version.id, cropBox: version.cropBox, editIntent: version.editIntent },
                        adjustment,
                      );
                      setAdjustingId(null);
                      setAdjustment("");
                      /// The answer is drawn where this box is, and a pointed-at
                      /// row outranks an offer — so what was being moved has to
                      /// let go of the frame before the offer lands on it.
                      onPoint?.(null);
                    }}
                    className="flex w-full gap-2 pt-1"
                  >
                    <input
                      value={adjustment}
                      onChange={(event) => setAdjustment(event.target.value)}
                      maxLength={EDIT_INTENT_LIMIT}
                      autoFocus
                      placeholder="What to change — e.g. wider, more headroom"
                      aria-label={`What to change about “${label}”`}
                      className="min-w-0 flex-1 rounded-md border border-current/20 bg-transparent px-2.5 py-1.5 text-xs placeholder:opacity-40"
                    />
                    <button
                      type="submit"
                      disabled={adjustment.trim().length === 0}
                      className="shrink-0 rounded-md border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-30"
                    >
                      Ask
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        !busy && (
          <p className="text-xs opacity-45">
            No versions yet. Ask for part of this frame — the box is shown on it for a look before
            the cut is kept here, beside the original.
          </p>
        )
      )}
    </section>
  );
}
