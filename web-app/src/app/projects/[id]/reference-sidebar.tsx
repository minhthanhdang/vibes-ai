"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  attachmentKey,
  attachmentTarget,
  type AttachmentTarget,
  type ChatAttachment,
  type CropAttachment,
} from "@/lib/agent-tools";
import type { CropPreview } from "@/lib/crop-offer";
import type { BoardPreview as BoardPreviewData } from "@/lib/board-preview";

/// A reply is words and, when the orchestrator showed something, pictures. They
/// are one message rather than two: what it said and what it pointed at are the
/// same answer, and separating them puts a caption above an unrelated bubble the
/// moment a second turn arrives.
type Message = { role: "user" | "model"; text: string; attachments?: ChatAttachment[] };

/// The orchestrator's seat. The director talks through the look they are after,
/// and the assistant answers with the project's own pictures — clicking one
/// opens its properties, so a reply is a way into the gallery rather than a
/// description of it.
export function ReferenceSidebar({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (target: AttachmentTarget) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const send = useMutation(
    trpc.orchestrator.send.mutationOptions({
      onSuccess: async (result) => {
        setMessages((current) => [
          ...current,
          { role: "model", text: result.reply, attachments: result.attachments },
        ]);

        /// A board the assistant composed is a row the tab list has never seen,
        /// and the tab list is what decides which board the click can open. The
        /// thing that learned the board exists is the thing that says so.
        const boards = result.attachments.filter((attachment) => attachment.kind === "board");
        if (boards.length) {
          /// A rebuilt board is a scene the cache already holds an older copy of,
          /// and that copy is pinned — the editor is initialised from a document,
          /// so `moodboard.scene` is fetched once and never refetched on mount.
          /// Dropping it is what makes opening the board show the arrangement the
          /// assistant just wrote instead of the one it replaced. A board that is
          /// new has nothing cached and this is a no-op on it.
          ///
          /// Only while nothing is showing it: dropping a scene the editor is
          /// mounted on would unmount the canvas under the director's hands and
          /// take whatever they had drawn since the last save with it. An open
          /// board keeps its copy and finds out the way any other tab does — its
          /// next save conflicts, and it offers a reload.
          for (const board of boards) {
            queryClient.removeQueries({
              queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
              type: "inactive",
            });
          }
          await queryClient.invalidateQueries({
            queryKey: trpc.moodboard.listByProject.queryOptions({ projectId }).queryKey,
          });
        }
      },
    }),
  );

  function submit() {
    const message = draft.trim();
    if (!message || send.isPending) return;
    // History is what the model already answered — the pending turn is passed
    // separately, so it must not be in both. The pictures stay behind: the
    // model's own tool calls are what put them there, and shipping them back as
    // conversation would have it reading its own attachments as new evidence.
    send.mutate({
      projectId,
      message,
      history: messages.map(({ role, text }) => ({ role, text })),
    });
    setMessages((current) => [...current, { role: "user", text: message }]);
    setDraft("");
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length ? (
          messages.map((message, index) => (
            <div key={index} className="flex flex-col gap-2">
              <p
                className={`rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "self-end bg-current/10 text-right"
                    : "border border-current/10"
                }`}
              >
                {message.text}
              </p>
              {message.attachments?.length ? (
                <ShownResults attachments={message.attachments} onOpen={onOpen} />
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm opacity-60">
            Describe the look you are after — palette, lighting, texture, framing. References come
            from your own uploads; this is where you work out what they need to say.
          </p>
        )}

        {send.isPending ? <p className="text-sm opacity-50">Thinking…</p> : null}
        {send.error ? <p className="text-sm text-red-500">{send.error.message}</p> : null}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-current/10 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="Low-key light, deep shadows, a gloomy historical mansion"
          className="resize-none rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <button
          type="submit"
          disabled={send.isPending}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

/// What the assistant put in front of the director, under the words that were
/// about it. A row of thumbnails rather than a list of titles: the whole point
/// of showing a reference is that the picture answers faster than its name, and
/// the sidebar is too narrow for more than a strip.
///
/// A board is drawn as a wider tile than a photograph, and says so on its face.
/// It is not one of the pictures — it is the thing the pictures were put into,
/// and clicking it leaves the gallery entirely, so it should not be mistaken for
/// another reference on the way to being clicked. What it shows is the
/// arrangement itself, drawn from the placements, and it falls back to the
/// opening slot's photograph only for a board with nothing placed on it.
///
/// A crop offer is drawn wide for the opposite reason: it is not a picture of the
/// project at all but a decision waiting on one, and the line under it — how much
/// of the frame it keeps, at what size — is what the decision is made on. What it
/// shows is the cut, not the frame: the thumbnail blown up inside a box of the
/// cut's own shape until only the kept region is on screen. Clicking it opens the
/// frame with the box drawn over it and the take-or-leave already up.
function ShownResults({
  attachments,
  onOpen,
}: {
  attachments: ChatAttachment[];
  onOpen: (target: AttachmentTarget) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const wide = attachment.kind !== "reference";
        return (
          <li key={attachmentKey(attachment)}>
            <button
              type="button"
              onClick={() => onOpen(attachmentTarget(attachment))}
              title={attachment.caption || attachment.title}
              className={`flex flex-col gap-1 rounded-lg border p-1 text-left transition-opacity hover:opacity-70 ${
                wide ? "w-full border-current/30" : "w-24 border-current/10"
              }`}
            >
              {attachment.kind === "crop" && attachment.preview ? (
                <CutPreview attachment={attachment} preview={attachment.preview} />
              ) : attachment.kind === "board" && attachment.preview ? (
                <BoardPreview preview={attachment.preview} />
              ) : attachment.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.thumbUrl}
                  alt={attachment.title}
                  className={`w-full rounded object-cover ${wide ? "h-24" : "h-16"}`}
                />
              ) : (
                <span className="grid h-24 w-full place-items-center rounded border border-dashed border-current/20 text-[11px] opacity-50">
                  No preview yet
                </span>
              )}
              {wide ? (
                <span className="truncate text-xs font-medium">{attachment.title}</span>
              ) : null}
              <span className="truncate text-[11px] opacity-70">
                {attachment.kind === "board"
                  ? `Moodboard · ${attachment.caption}`
                  : attachment.kind === "crop"
                    ? `Crop to review · ${attachment.caption}`
                    : attachment.caption || attachment.title}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/// `h-24`, as a number. A preview's inner box is sized off it in pixels rather
/// than by `aspect-ratio`, because a block box with a definite height and
/// `width: auto` fills its line instead of taking its shape — which is the
/// stretch both previews below exist to avoid.
const PREVIEW_STRIP_HEIGHT = 96;

/// The offered cut, out of the frame's thumbnail.
///
/// Two boxes, and both are load-bearing. The outer one is the strip every wide
/// tile is, so a reply carrying three offers is still a column of even rows. The
/// inner one is the cut's own shape, centred in it — the thumbnail is scaled by
/// each axis separately, so a box of any other shape would show the right region
/// of a stretched photograph, which is worse than showing the frame.
///
/// A cut much wider than the strip therefore runs off both ends rather than being
/// squashed into it. That is the same trade the gallery makes with `object-cover`,
/// and the caption underneath carries the measurements the edges would have.
function CutPreview({
  attachment,
  preview,
}: {
  attachment: CropAttachment;
  preview: CropPreview;
}) {
  return (
    <span className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-current/5">
      <span
        className="relative block shrink-0 overflow-hidden"
        style={{
          height: PREVIEW_STRIP_HEIGHT,
          width: Math.round(PREVIEW_STRIP_HEIGHT * preview.aspectRatio),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.thumbUrl}
          alt={attachment.title}
          className="absolute max-w-none"
          style={{
            width: `${preview.image.width}%`,
            height: `${preview.image.height}%`,
            left: `${preview.image.left}%`,
            top: `${preview.image.top}%`,
          }}
        />
      </span>
    </span>
  );
}

/// The board that was composed, at the size of a thumbnail.
///
/// The page is a box at the page's own shape — a portrait masonry board is a
/// tall sliver in the strip and a widescreen diptych nearly fills it, which is
/// the first true thing about a board and the one a single cover photograph
/// cannot say. Every placement is positioned in percent inside it, so the
/// miniature is the arrangement rather than a picture of one of its parts.
///
/// A photograph is drawn at the box it occupies on the board, gaps and all: a
/// picture sitting loose in its slot looks loose here too, which is the same
/// thing the reply's own sentence about cropping is about.
function BoardPreview({ preview }: { preview: BoardPreviewData }) {
  return (
    <span className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-current/5">
      <span
        className="relative block shrink-0 overflow-hidden rounded-[2px] bg-white/90"
        style={{
          height: PREVIEW_STRIP_HEIGHT,
          width: Math.round(PREVIEW_STRIP_HEIGHT * preview.aspectRatio),
        }}
      >
        {preview.items.map((item, index) => (
          <span
            key={index}
            className={`absolute block overflow-hidden ${
              item.kind === "text" ? "bg-black/20" : "bg-black/5"
            }`}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
              ...(item.angle && { transform: `rotate(${item.angle}deg)` }),
            }}
          >
            {item.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}
