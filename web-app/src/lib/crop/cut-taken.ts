import { attachmentOf, type ReferenceAttachment } from "@/lib/agent/shared/attachments";
import { looseShapeOf } from "@/lib/references/reference-version";

export type TakenCut = {
  referenceId: string;
  frameId: string;
  title: string;
  keeps: string;
  aspect: string | null;
  framed?: string | null;
  thumbUrl: string;
};

export function takenCutNote({ referenceId, frameId, title, keeps, aspect, framed }: TakenCut) {
  const named = title.trim() || "the cut";
  const kept = keeps.trim();
  const shape = aspect
    ? `at ${aspect}`
    : looseShapeOf(framed)
      ? `framed ${looseShapeOf(framed)?.label.toLowerCase()}`
      : "";
  const what = [kept && `keeps “${kept}”`, shape].filter(Boolean).join(", ");

  return [
    what ? `I cropped this myself: “${named}” — ${what}.` : `I cropped this myself: “${named}”.`,
    `It is filed as ${referenceId}, a cut of ${frameId} —`,
    "pass that id to a tool like any other reference.",
  ].join(" ");
}

export function takenCutAttachment({
  referenceId,
  frameId,
  title,
  keeps,
  thumbUrl,
}: TakenCut): ReferenceAttachment {
  return attachmentOf({
    id: referenceId,
    title,
    editIntent: keeps,
    thumbUrl,
    source: { id: frameId, title: "" },
  });
}
