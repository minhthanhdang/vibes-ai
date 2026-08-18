"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { analysisView } from "@/lib/analysis/analysis-view";
import { captionText } from "@/lib/canvas/moodboard-caption";
import { mergedPalette } from "@/lib/canvas/moodboard-palette";
import {
  shapeAsked,
  cropBoxOutline,
  referenceCaption,
  versionCredit,
  versionNote,
} from "@/lib/references/reference-version";
import {
  REFERENCE_DRAG_MIME,
  encodeReferenceDrag,
  referenceDragItem,
} from "@/lib/canvas/moodboard-drop";
import type { BoardSelection } from "@/lib/canvas/moodboard-selection";
import { ColorPalette } from "@/components/color-palette";
import { DrawnFrom } from "./drawn-from";
import { ReferenceProperties } from "./reference-properties";
import { ReferenceVersions } from "./reference-versions";

/// The board's own second level: what agent 2 made of the photo the user
/// has just selected, read without leaving the canvas. Excalidraw's left island
/// already says everything there is to say about the *element* — opacity, layer,
/// crop — so this only ever says what the element is a picture of.
///
/// Docked to the right edge because the left is where that island appears the
/// moment an image is selected, and the two would sit on top of each other.
///
/// It is also the third surface a photograph's properties are shown on, so the
/// cuts of it belong here as well — and this is the surface where a user is
/// most likely to want one. "Just the hands" is a thought that arrives while the
/// wide shot is sitting on the board next to four others, not while browsing the
/// grid, and until now answering it meant finding the same photo in the sidebar
/// strip — which cannot be done at all when the thing on the board is itself a
/// cut, since a version has no tile there.
///
/// And when the thing on the board *is* a cut, the panel walks up: the frame it
/// came out of, the region of that frame this cut is, and the other cuts made of
/// it — every one of them a drag onto the canvas. A composition made of pieces
/// of photographs is otherwise a board whose pieces cannot be traced back to
/// what they are pieces of.
export function MoodboardInspector({
  projectId,
  selection,
  captionable,
  croppable,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  selection: BoardSelection;
  /// How many of the selected photos could take a caption, so the offer is not
  /// made for a photo that already has one.
  captionable: number;
  /// How many of them are showing a crop that is not yet a photo of its own.
  croppable: number;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  /// Opened once, then it follows the selection — rather than opening itself on
  /// every selection. Dropping a batch of references selects each one as it
  /// lands, and a panel that appeared for each would be in the way of the one
  /// thing the user is doing at that moment, which is arranging them.
  const [open, setOpen] = useState(false);

  if (selection.kind === "none") return null;

  if (!open) {
    return (
      <div data-board-overlay className="absolute top-16 right-3 z-10">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white shadow-lg"
        >
          Properties
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Reference properties"
      /// Over the board, not part of it: a cut dragged out of the list below and
      /// released back on this panel is a drag abandoned, not a photo placed
      /// under the panel it was released on.
      data-board-overlay
      className="absolute top-16 right-3 bottom-16 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-current/10 bg-[var(--background)] text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {selection.kind === "reference" ? (
        /// Keyed on the reference so selecting another photo remounts rather
        /// than showing the previous one's palette until the next query settles.
        <Reference
          key={selection.referenceId}
          projectId={projectId}
          referenceId={selection.referenceId}
          captionable={captionable}
          croppable={croppable}
          onClose={() => setOpen(false)}
          onAddPalette={onAddPalette}
          onCaption={onCaption}
          onKeepCrop={onKeepCrop}
        />
      ) : (
        <>
          <Header title={`${selection.referenceIds.length} references`} onClose={() => setOpen(false)} />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <p className="text-xs opacity-60">
              Select a single reference to read its properties.
            </p>
            {/* The one question worth asking of several photos at once, and the
                one a per-reference panel cannot answer: what colour are they
                together. */}
            <PaletteAction
              referenceIds={selection.referenceIds}
              label="Add their palette to the board"
              onAddPalette={onAddPalette}
            />
            <CropAction count={croppable} onKeepCrop={onKeepCrop} />
          </div>
        </>
      )}
    </aside>
  );
}

function Header({
  title,
  onBack,
  onClose,
}: {
  title: string;
  /// Set only while the panel is reading a frame it stepped up to. It takes the
  /// close button's place rather than sitting beside it, as the sidebar panel's
  /// own walk does: the way out of a frame is back to the picture on the board,
  /// and closing the panel from there would put away the thing the user
  /// stepped up from.
  onBack?: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
      <button
        type="button"
        onClick={onBack ?? onClose}
        aria-label={onBack ? "Back to the selected reference" : "Close properties"}
        className="shrink-0 rounded-md border border-current/20 px-1.5 py-0.5 text-[11px] opacity-70 hover:opacity-100"
      >
        {onBack ? "←" : "✕"}
      </button>
    </div>
  );
}

/// The palette agent 2 read out of these references, as an object on the board.
///
/// A colour that can only be read in a panel is not part of the board a
/// user shows anyone — or of the deck agent 5 builds from it — so the one
/// thing this panel can do that the gallery's cannot is put it on the canvas.
/// It reads the same per-reference query the panel body polls, so the colours
/// offered are always the colours on screen, and a selection of five costs five
/// small reads of rows that are usually already cached.
function PaletteAction({
  referenceIds,
  label,
  onAddPalette,
}: {
  referenceIds: readonly string[];
  label: string;
  onAddPalette: (colors: string[]) => void;
}) {
  const trpc = useTRPC();
  const results = useQueries({
    queries: referenceIds.map((referenceId) =>
      trpc.reference.properties.queryOptions({ referenceId }),
    ),
  });

  const palettes = results.map((result) => {
    const view = result.data ? analysisView(result.data) : null;
    return view?.kind === "ready" ? view.properties.colorPalette : [];
  });
  const colors = mergedPalette(palettes);

  /// Nothing analyzed yet, or analyzed and colourless: the panel already says
  /// which of the two it is, and an offer to place an empty bar would be a
  /// button that does nothing.
  if (colors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-current/10 pt-3">
      <ColorPalette colors={colors} size="sm" />
      <button
        type="button"
        onClick={() => onAddPalette(colors)}
        className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
      >
        {label}
      </button>
    </div>
  );
}

/// What the reference is, put on the board as a caption grouped with the photo.
///
/// A moodboard is images and what is said about them, and until now saying it
/// meant drawing a text element that knew nothing about the photo — separated
/// from it by the first tidy, and left behind by the first drag. Grouping the
/// two is what makes a caption belong to a photo, and what the user already
/// said about the reference is the caption they would have typed: its title for
/// a photograph, and for a cut the frame plus what that cut keeps, since every
/// cut of one frame carries one title between them (`referenceCaption`).
function CaptionAction({
  reference,
  count,
  onCaption,
}: {
  reference: Parameters<typeof referenceCaption>[0];
  count: number;
  onCaption: (text: string) => void;
}) {
  const text = captionText(referenceCaption(reference));
  if (!text) return null;

  return (
    <button
      type="button"
      onClick={() => onCaption(text)}
      title={`Add “${text}” under ${count === 1 ? "the photo" : `each of the ${count} photos`}, grouped with it so it moves and tidies as one`}
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1
        ? /// A cut's caption is not its title, and a button that says it is
          /// offers the "(crop 2)" name this deliberately does not use.
          reference.source
          ? "Caption with what it is"
          : "Caption with its title"
        : `Caption ${count} photos`}
    </button>
  );
}

/// The crop the user framed on the board, kept as a photo of the project.
///
/// Excalidraw's crop is a window onto the whole file, and everything outside the
/// canvas keeps seeing the file: the gallery shows the frame that was cut away,
/// agent 2 reads a palette off it, a deck built from these references gets the
/// wide shot, and the board downloads the whole photograph to draw a corner of
/// it. "This part of this frame is the shot" is a judgement worth keeping, so
/// this is where it stops being a property of one element on one board.
function CropAction({ count, onKeepCrop }: { count: number; onKeepCrop: () => void }) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onKeepCrop}
      title={
        count === 1
          ? "Save the cropped area as a reference of its own and point this image at it — nothing moves on the board"
          : "Save each cropped area as a reference of its own and point its image at it — nothing moves on the board"
      }
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1 ? "Keep this crop as a reference" : `Keep ${count} crops as references`}
    </button>
  );
}

/// A frame dragged out of the panel onto the canvas, carrying exactly what a
/// gallery tile and a version row carry: one reference and the shape it should
/// land at. The stored dimensions if the row has them, the drawn thumbnail's
/// own otherwise — the one rule for what size a reference drags at.
function startFrameDrag(
  event: React.DragEvent<HTMLElement>,
  reference: { id: string; width?: number | null; height?: number | null },
) {
  const drawn = event.currentTarget.querySelector("img");
  event.dataTransfer.setData(
    REFERENCE_DRAG_MIME,
    encodeReferenceDrag([referenceDragItem(reference, drawn)]),
  );
  event.dataTransfer.effectAllowed = "copy";
}

/// The frame the panel has stepped up to, and the cut it stepped up from.
///
/// A cut on a board is a piece of a photograph that is not itself on the board,
/// and until now the credit line only *named* that photograph — reaching it
/// meant leaving the canvas and finding the frame in the sidebar strip by its
/// title, which every cut of it shares. Stepping up shows it here instead: the
/// wide shot, where in it this cut is, and the other cuts made of it, each one a
/// drag away from the board the user is composing.
type FrameStep = { frameId: string; cutBox: number[] };

function Reference({
  projectId,
  referenceId,
  captionable,
  croppable,
  onClose,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  referenceId: string;
  captionable: number;
  croppable: number;
  onClose: () => void;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  /// One step at a time rather than a trail: a frame that is itself a cut can be
  /// stepped up from again, and back is back to what is on the board — the
  /// selection is where the panel came from and the only place it has to
  /// return to, since the board's own verbs are offered nowhere else.
  const [step, setStep] = useState<FrameStep | null>(null);

  return (
    <ShownReference
      /// Keyed on what is being read: stepping up is being shown another
      /// picture, and the box pointed at, the crop under review and the prompt
      /// that asked for it all belong to the one that was on screen.
      key={step?.frameId ?? referenceId}
      projectId={projectId}
      referenceId={step?.frameId ?? referenceId}
      cutFromHere={step?.cutBox ?? null}
      onStepUp={setStep}
      onBack={step ? () => setStep(null) : null}
      captionable={captionable}
      croppable={croppable}
      onClose={onClose}
      onAddPalette={onAddPalette}
      onCaption={onCaption}
      onKeepCrop={onKeepCrop}
    />
  );
}

/// One reference read in the panel: the one the board has selected, or a frame
/// stepped up to from it.
function ShownReference({
  projectId,
  referenceId,
  cutFromHere,
  onStepUp,
  onBack,
  captionable,
  croppable,
  onClose,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  referenceId: string;
  /// The box of the cut that was stepped up from, drawn on this frame — "the
  /// picture on the board is this part of this photograph", which is the
  /// question stepping up was asked in order to answer. Null while the panel is
  /// on the selection itself.
  cutFromHere: number[] | null;
  onStepUp: (step: FrameStep) => void;
  onBack: (() => void) | null;
  captionable: number;
  croppable: number;
  onClose: () => void;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  const trpc = useTRPC();
  /// Read by id rather than found in the gallery list. The element points at
  /// whichever reference was dropped on it, and a modified version is not in
  /// that list by design — scanning it called every cut on the board a deleted
  /// reference, which is the one thing the panel is here to be right about.
  ///
  /// Not retried, and read for *which* failure it was: a row that is gone is the
  /// answer, and repeating the ask four times before saying so is four round
  /// trips to reach a certainty the first one already had. Anything else is the
  /// network, and saying "no longer in the project" about a reference that is
  /// still there would be the same wrong claim in the other direction.
  const { data: reference, error } = useQuery(
    trpc.reference.summary.queryOptions({ referenceId }, { retry: false }),
  );
  const missing = error?.data?.code === "NOT_FOUND";
  /// Which photograph this is a piece of — the frame is in the sidebar strip,
  /// not on the canvas, so a cut on a board says nothing about where it is from
  /// until this does.
  const credit = reference ? versionCredit(reference) : null;
  /// And why that piece is the piece it is, in the cropper's own words. Said
  /// here as well as in the sidebar list because a board is looked at long after
  /// the crop was asked for, often by someone who did not ask for it.
  const note = reference ? versionNote(reference) : null;
  /// And what shape it was asked at, when it was asked for at one — a format, or
  /// the loose word it was framed as. Null for a photograph and for a cut nobody
  /// named a shape for.
  const shape = shapeAsked(reference?.editAspect)?.label ?? null;

  /// Which part of this photograph a cut is, drawn on the photograph — the cut
  /// being pointed at in the list below, or the box the cropper has just
  /// answered with. No reference id is carried beside them as it is in the
  /// viewer: this component is keyed on the reference, so selecting another
  /// photo on the board remounts it and there is no box left over to be a claim
  /// about the wrong frame.
  const [pointed, setPointed] = useState<number[] | null>(null);
  const [proposed, setProposed] = useState<number[] | null>(null);
  /// Pointing wins while it lasts, as it does in the other two panels: a
  /// user reading the offer can still check where an existing cut is, and
  /// the offer comes back when the pointer leaves. Under both is the cut that
  /// was stepped up from, which is not a passing highlight but the reason this
  /// frame is on screen — so it is what the picture falls back to rather than
  /// going bare.
  const outline = cropBoxOutline(pointed ?? proposed ?? cutFromHere);
  /// The frame this is a cut of, when there is one to step up to.
  const frame = reference?.source ?? null;
  const onSelection = !onBack;

  return (
    <>
      <Header title={reference?.title || "Reference"} onBack={onBack} onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {missing ? (
          /// The element is still on the board pointing at a row that is gone —
          /// excalidraw draws it as a placeholder, and this says why.
          <p className="text-xs opacity-60">This reference is no longer in the project.</p>
        ) : (
          <>
            {error ? <p className="text-xs text-red-500">{error.message}</p> : null}
            {reference ? (
              /* The picture, and the region of it a cut names. The box is
                 pinned by percentages, so it lands on the image at whatever
                 width this panel is — which is what the box being stored
                 against the frame rather than in pixels of one copy is for.

                 A frame stepped up to is also a drag handle: it is a picture the
                 board does not have — the user is looking at it because the
                 cut of it on the canvas is too tight — and the cuts listed below
                 it are already draggable. The selection itself is not, since it
                 is on the board by definition. */
              <div
                draggable={!onSelection}
                onDragStart={(event) => startFrameDrag(event, reference)}
                title={onSelection ? undefined : "Drag onto the moodboard"}
                className={`relative overflow-hidden rounded-lg ${
                  onSelection ? "" : "cursor-grab active:cursor-grabbing"
                }`}
              >
                {/* The image's own native drag would carry a URL instead of the
                    reference, and it starts before this one's. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reference.thumbUrl}
                  alt={reference.title}
                  draggable={false}
                  className="block w-full"
                />
                {outline ? (
                  <div
                    aria-hidden
                    style={{
                      left: `${outline.left}%`,
                      top: `${outline.top}%`,
                      width: `${outline.width}%`,
                      height: `${outline.height}%`,
                    }}
                    className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                  />
                ) : null}
              </div>
            ) : null}
            {!onSelection && cutFromHere && !pointed && !proposed ? (
              /// What the box on the picture above is, while it is the one this
              /// panel stepped up from. The other two boxes are drawn by
              /// something the user is doing — pointing at a row, reading an
              /// offer — and say what they are by being drawn as it happens;
              /// this one is already on screen when the frame arrives.
              <p className="text-[11px] opacity-55">Outlined: the cut on the board.</p>
            ) : null}
            {credit ? (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] opacity-55">
                  {credit}
                  {/* The format this cut was held to, where composing happens: a
                      board being built to one shape needs to be able to see
                      which of the pictures on it are that shape, and the box
                      cannot say it afterwards. */}
                  {shape ? <span className="opacity-70"> · {shape}</span> : null}
                </p>
                {note ? <p className="text-[11px] leading-relaxed opacity-40">{note}</p> : null}
              </div>
            ) : null}
            {reference && frame ? (
              /// The way to the photograph the credit line names. A cut is on the
              /// board without its frame — that is what a cut is — so the wide
              /// shot, where in it this cut sits, and the other cuts of it are
              /// all reachable only from here: a version has no tile in the
              /// sidebar strip, and the frame's own tile is one of dozens
              /// carrying the title every cut of it repeats.
              <button
                type="button"
                onClick={() => onStepUp({ frameId: frame.id, cutBox: reference.cropBox })}
                title={`Show “${frame.title}” — the whole frame this was cut from, and its other cuts`}
                className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
              >
                Show the frame
              </button>
            ) : null}
            {/* What the picture on the canvas was drawn from, where a drawn
                picture is most often looked at: it was made to go on a board,
                so this is the panel that opens on it — and the reading below is
                the last thing to arrive about a backdrop drawn a minute ago. */}
            <DrawnFrom reference={reference} />
            <ReferenceProperties referenceId={referenceId} />
            {/* The board's own verbs act on the *selected element*, so they are
                offered only while what is being read is that element: a caption
                composed from a frame the user stepped up to would be written
                under the cut on the canvas in words about another picture, and
                "keep this crop" is about an excalidraw crop of the selection
                that the frame on screen knows nothing about. The palette is the
                exception and stays — it is offered for the picture being looked
                at and says so, and the colours of the frame are as placeable as
                the colours of a piece of it. */}
            {onSelection ? <CropAction count={croppable} onKeepCrop={onKeepCrop} /> : null}
            {onSelection && reference && captionable > 0 ? (
              <CaptionAction
                reference={reference}
                count={captionable}
                onCaption={onCaption}
              />
            ) : null}
            <PaletteAction
              referenceIds={[referenceId]}
              label="Add palette to the board"
              onAddPalette={onAddPalette}
            />
            {/* The cuts of whatever is being read — the selection, or the frame
                stepped up to — and the prompt that asks for another. Last, under
                the board's own verbs: those act on the selection that is already
                arranged, while this is where a *new* picture is made — and it is
                a list that grows, so it takes the bottom of a panel that
                scrolls. Asking here while stepped up asks it of the frame, which
                is the one way to widen a shot the board is showing too tight.

                Rows are drag handles here. This panel sits inside the board's
                own drop target rather than over a backdrop, so a cut asked for
                while composing goes onto the canvas without leaving it. No row
                is a door: the walk this panel does is *up*, to the frame named
                by the credit line, and from there this same list is the frame's
                other cuts — which is what a user looking at one cut of a
                photograph on the board actually wants to see. */}
            <ReferenceVersions
              projectId={projectId}
              referenceId={referenceId}
              frame={reference}
              onPoint={setPointed}
              onPropose={setProposed}
            />
          </>
        )}
      </div>
    </>
  );
}
