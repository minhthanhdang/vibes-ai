"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  shapeAsked,
  cropBoxOutline,
  versionCredit,
  versionNote,
} from "@/lib/references/reference-version";
import {
  REFERENCE_DRAG_MIME,
  encodeReferenceDrag,
  referenceDragItem,
} from "@/lib/canvas/moodboard-drop";
import { DrawnFrom } from "../../../../../_reference/components/drawn-from";
import { ReferenceProperties } from "../../../../../_reference/components/reference-properties";
import { ReferenceVersions } from "../../../../../_reference/components/reference-versions";
import { CaptionAction } from "./caption-action";
import { CropAction } from "./crop-action";
import { InspectorHeader } from "./inspector-header";
import { PaletteAction } from "./palette-action";

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

export function InspectedReference({
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
      <InspectorHeader title={reference?.title || "Reference"} onBack={onBack} onClose={onClose} />

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
                /// `shrink-0` for the reason the properties panel carries it:
                /// a flex item whose `overflow-hidden` has zeroed its minimum
                /// height gets squashed by a full inspector instead of the
                /// column scrolling, and a box pinned by percentages of a
                /// squashed frame is a box on the wrong part of the picture.
                className={`relative shrink-0 overflow-hidden rounded-lg ${
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