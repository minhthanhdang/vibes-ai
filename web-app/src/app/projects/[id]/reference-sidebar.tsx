"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  attachmentKey,
  attachmentTarget,
  type AttachmentTarget,
  type ChatAttachment,
} from "@/lib/agent-tools";

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
        if (result.attachments.some((attachment) => attachment.kind === "board")) {
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
/// another reference on the way to being clicked.
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
        const isBoard = attachment.kind === "board";
        return (
          <li key={attachmentKey(attachment)}>
            <button
              type="button"
              onClick={() => onOpen(attachmentTarget(attachment))}
              title={attachment.caption || attachment.title}
              className={`flex flex-col gap-1 rounded-lg border p-1 text-left transition-opacity hover:opacity-70 ${
                isBoard ? "w-full border-current/30" : "w-24 border-current/10"
              }`}
            >
              {attachment.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.thumbUrl}
                  alt={attachment.title}
                  className={`w-full rounded object-cover ${isBoard ? "h-24" : "h-16"}`}
                />
              ) : (
                <span className="grid h-24 w-full place-items-center rounded border border-dashed border-current/20 text-[11px] opacity-50">
                  No preview yet
                </span>
              )}
              {isBoard ? (
                <span className="truncate text-xs font-medium">{attachment.title}</span>
              ) : null}
              <span className="truncate text-[11px] opacity-70">
                {isBoard ? `Moodboard · ${attachment.caption}` : attachment.caption || attachment.title}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
