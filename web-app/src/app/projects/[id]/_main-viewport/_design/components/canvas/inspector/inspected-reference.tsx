"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  shapeAsked,
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
import { EditOverlay, type EditMark } from "@/app/projects/[id]/_reference/components/edit-overlay";
import type { EditOp } from "@/lib/edit/edit-ops";
import { editShape, versionCredit } from "@/lib/references/reference-edit";

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

type FrameStep = { frameId: string; cutBox: EditOp[] };

export function InspectedReference({
  projectId,
  referenceId,
  held,
  captionable,
  croppable,
  onClose,
  onAddPalette,
  onCaption,
  onKeepCrop,
}: {
  projectId: string;
  referenceId: string;
  held: boolean;
  captionable: number;
  croppable: number;
  onClose: () => void;
  onAddPalette: (colors: string[]) => void;
  onCaption: (text: string) => void;
  onKeepCrop: () => void;
}) {
  const [step, setStep] = useState<FrameStep | null>(null);

  return (
    <ShownReference
      key={step?.frameId ?? referenceId}
      projectId={projectId}
      referenceId={step?.frameId ?? referenceId}
      held={held}
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

function ShownReference({
  projectId,
  referenceId,
  held,
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
  held: boolean;
  cutFromHere: EditMark;
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
  const { data: reference, error } = useQuery(
    trpc.reference.summary.queryOptions({ referenceId }, { retry: false }),
  );
  const missing = error?.data?.code === "NOT_FOUND";
  const credit = reference ? versionCredit(reference) : null;
  const note = reference ? versionNote(reference) : null;
  const shape = shapeAsked(editShape(reference?.edit))?.label ?? null;

  const [pointed, setPointed] = useState<EditMark>(null);
  const [proposed, setProposed] = useState<EditMark>(null);
  const highlighted = pointed ?? proposed ?? cutFromHere;
  const frame = reference?.source ?? null;
  const onSelection = !onBack;
  const canPlace = !held;

  return (
    <>
      <InspectorHeader title={reference?.title || "Reference"} onBack={onBack} onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {missing ? (
          <p className="text-xs opacity-60">This reference is no longer in the project.</p>
        ) : (
          <>
            {error ? <p className="text-xs text-red-500">{error.message}</p> : null}
            {reference ? (
              <div
                draggable={!onSelection}
                onDragStart={(event) => startFrameDrag(event, reference)}
                title={onSelection ? undefined : "Drag onto the moodboard"}
                className={`relative shrink-0 overflow-hidden rounded-lg ${
                  onSelection ? "" : "cursor-grab active:cursor-grabbing"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reference.thumbUrl}
                  alt={reference.title}
                  draggable={false}
                  className="block w-full"
                />
                <EditOverlay mark={highlighted} />
              </div>
            ) : null}
            {!onSelection && cutFromHere && !pointed && !proposed ? (
              <p className="text-[11px] opacity-55">Outlined: the cut on the board.</p>
            ) : null}
            {credit ? (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] opacity-55">
                  {credit}
                  {shape ? <span className="opacity-70"> · {shape}</span> : null}
                </p>
                {note ? <p className="text-[11px] leading-relaxed opacity-40">{note}</p> : null}
              </div>
            ) : null}
            {reference && frame ? (
              <button
                type="button"
                onClick={() => onStepUp({ frameId: frame.id, cutBox: reference.edit })}
                title={`Show “${frame.title}” — the whole frame this was cut from, and its other cuts`}
                className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
              >
                Show the frame
              </button>
            ) : null}
            <DrawnFrom reference={reference} />
            <ReferenceProperties referenceId={referenceId} />
            {onSelection && canPlace ? (
              <CropAction count={croppable} onKeepCrop={onKeepCrop} />
            ) : null}
            {onSelection && canPlace && reference && captionable > 0 ? (
              <CaptionAction
                reference={reference}
                count={captionable}
                onCaption={onCaption}
              />
            ) : null}
            {canPlace ? (
              <PaletteAction
                referenceIds={[referenceId]}
                label="Add palette to the board"
                onAddPalette={onAddPalette}
              />
            ) : null}
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