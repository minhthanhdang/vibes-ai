import type { UsingBoard } from "@/lib/references/reference-usage";

/// A picture the assistant has offered to take out of the project, and the
/// record of one the director took out.
///
/// The second offer of its kind, and it rests on the same argument
/// `discard_board` does: nothing stops the server deleting the row, and what
/// stops it is that a deletion is the one act here nothing can walk back. A
/// board is a scene that can be composed again from pictures that still exist;
/// a photograph is the bytes, and once they are out of the bucket there is no
/// call in the pipeline that puts them back.
///
/// It is sharper than a board's, in fact, because the loss reaches further than
/// the row: deleting a frame deletes every cut made of it — that is the schema's
/// cascade — and every board element naming any of them turns into one of
/// excalidraw's placeholder boxes. The model can see none of that, which is why
/// the tool that offers it answers with all three.
///
/// The verbs are deliberately split. The tool is `discard_reference`, in the
/// family `discard_board` is in, because that name is what tells the model these
/// two are one kind of act. Every string the *director* reads says "remove",
/// because that is what the gallery's own control beside the same act has always
/// said, and one act with two names in one session is the defect this layer has
/// already fixed once for boards.
export type DiscardedReference = {
  referenceId: string;
  title: string;
  /// The frame it was a cut of, when it was. Said in the note because a deleted
  /// cut and a deleted photograph are very different news, and the frame is the
  /// id the conversation goes on with.
  frameId?: string | null;
  /// The cuts that went down with it. Absent when the door that removed it does
  /// not know — the note then says nothing about cuts rather than claiming none.
  cuts?: number;
  /// The boards left with a hole where it was. Absent, again, means unknown
  /// rather than none.
  boards?: UsingBoard[];
};

/// The key a removed picture's tile is drawn under. Pinned by test to
/// `attachmentKey` of the reference attachment it settles, the same way
/// `discardKey` is pinned to a board's: the offer and the thing that settles it
/// have to agree on one string, or the tile goes on offering an act that is
/// already done.
export function referenceDiscardKey(referenceId: string) {
  return `reference:${referenceId}`;
}

/// How many boards a note names before it counts them instead. Two is what fits
/// in a sentence the director will hear read back; past that the number is the
/// fact and the names are noise.
const BOARDS_NAMED = 2;

/// What the conversation is told when a picture goes.
///
/// It rides up as the director's turn, like a taken cut and a discarded board:
/// they did it with their hands, in another column, and the model has to read it
/// as new information rather than as its own claim.
///
/// Three things have to be in it and only one of them is the deletion. The id is
/// dead — the catalog primed into the next turn is a fresh read and this picture
/// will simply be absent, so a model holding the id in the conversation above
/// would pass it to a tool and be told a picture it just discussed does not
/// exist. The cuts went with it, which is a loss the director may not have
/// connected to the tile they removed. And the boards that were standing on it
/// now have a gap, which is a thing the assistant can actually do something
/// about — so the call that fixes it is named.
export function discardedReferenceNote(reference: DiscardedReference) {
  const title = reference.title.trim() || "Untitled";
  const what = reference.frameId ? "cut" : "photograph";
  const frame = reference.frameId
    ? ` The photograph it was cut from (${reference.frameId}) is still in the gallery.`
    : "";
  const cuts =
    reference.frameId || !reference.cuts
      ? ""
      : reference.cuts === 1
        ? " The cut made of it went with it."
        : ` The ${reference.cuts} cuts made of it went with it.`;

  return `I removed the ${what} “${title}” (${reference.referenceId}) from the project. It is gone, and that id no longer names anything — do not pass it to a tool.${frame}${cuts}${gapNote(reference.boards ?? [])}`;
}

function gapNote(boards: readonly UsingBoard[]) {
  if (!boards.length) return "";
  const named = boards
    .slice(0, BOARDS_NAMED)
    .map((board) => `“${board.title.trim() || "Untitled board"}” (${board.id})`);
  const rest = boards.length - named.length;
  const list = rest ? `${named.join(", ")} and ${rest} more` : named.join(" and ");
  return ` ${boards.length === 1 ? "The board" : "The boards"} it was on — ${list} — ${
    boards.length === 1 ? "now has" : "now have"
  } a gap where it was: offer to put another picture in its place with swap_on_board, and do not say the boards are unchanged.`;
}
