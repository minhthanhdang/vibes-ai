import {
  LIST_REFERENCES,
  READ_REFERENCES,
  cropReferenceFor,
  discardReferenceFor,
  generateImageFor,
  showReferencesFor,
} from "@/lib/agent/orchestrator/reference-tools";
import {
  ADD_PAGE,
  DISCARD_BOARD,
  DISCARD_PAGE,
  DUPLICATE_BOARD,
  DUPLICATE_PAGE,
  GET_BOARD_BRIEF,
  INSPECT_BOARD,
  LIST_BOARDS,
  RESIZE_PAGE,
  addBoardFor,
} from "@/lib/agent/orchestrator/board-tools";
import { designPageFor } from "@/lib/agent/orchestrator/handoff-tools";
import {
  ORCHESTRATOR_READ_CANVAS,
  SET_CANVAS_BACKGROUND,
} from "@/lib/agent/shared/canvas-tools";
import type { ProjectState } from "@/lib/agent/shared/tool-declaration";

/// The tools this project can actually use, rather than every tool that exists.
/// Declarations are the one input paid on *every round of every turn*, so the
/// set is a function of what the project holds — and the same counts then
/// decide what the surviving declarations *say*.
///
/// Order is fixed rather than derived, so two turns of one conversation hand the
/// model the same tools in the same order.
///
/// **Agent 6 interacts with boards and pages; object-level editing is agent
/// 8's.** That rule is what took nine declarations off this list — the five
/// canvas writes, `set_page_background`, `move_to_page`, `swap_on_board` and
/// `reword_on_board` — and it leaves the two halves nameable in one sentence
/// each. What is here reads a board, makes a board, makes a page, reshapes a
/// page, copies either, paints the board they stand on, offers to throw one
/// away, and hands a page to agent 8. Everything that addresses a *thing
/// standing on* a page is one call away, through `design_page`.
///
/// It is also what makes the browser's hold on a board exact (`board-hold.ts`):
/// "an agent is editing this board" and "agent 8 is running on this board" are
/// now one sentence, so the canvas goes read-only for the length of the call
/// that names it and for nothing else.
///
/// `read_canvas` stays, and it is the one object-level *read* here: a swap the
/// crop tool makes for itself is aimed by handles, and "which of these did they
/// mean" is a question agent 6 has to be able to answer without buying a design.
export function orchestratorTools(state: ProjectState) {
  const { photographs, crops, boards } = state;
  const pictures = photographs + crops;
  return [
    ...(pictures > 0
      ? [
          LIST_REFERENCES,
          showReferencesFor(state),
          cropReferenceFor(state),
          discardReferenceFor(state),
          READ_REFERENCES,
        ]
      : []),
    ...(boards > 0
      ? [
          /// Finding a board, before reading one: the priming names one board
          /// now, so these two are where the ids the fifteen below take come
          /// from. Both read the digest columns only — neither is worth what
          /// `inspect_board` costs when the question is which board.
          LIST_BOARDS,
          GET_BOARD_BRIEF,
          INSPECT_BOARD,
          ADD_PAGE,
          DUPLICATE_PAGE,
          RESIZE_PAGE,
          DUPLICATE_BOARD,
          /// The desk the pages sit on. Agent 6's alone, and the one painting
          /// call left here — it colours the *board*, which is the surface a
          /// user is looking at rather than anything standing on a page.
          /// `set_page_background` went with the objects: a page's ground is a
          /// locked rectangle at the back of the page, and deciding what colour
          /// a page is printed on is the design decision agent 8 is paid to make.
          SET_CANVAS_BACKGROUND,
          /// The one object-level read left, gated on the boards count with the
          /// rest: every handle it surfaces is a board's, and there is nowhere
          /// else for a board id to come from.
          ORCHESTRATOR_READ_CANVAS,
          DISCARD_PAGE,
          DISCARD_BOARD,
        ]
      : []),
    /// Gated on the boards for the plainer reason every board tool is: it takes
    /// a board id and there is nowhere else for one to come from — a page is
    /// designed *onto* a board. Which is what `ADD_BOARD` below is for, and why
    /// this gate is not the trap it reads as: declarations are resolved per
    /// round, so the round after `add_board` files the first board is a round
    /// this is on the list for.
    ...(boards > 0 ? [designPageFor(state)] : []),
    /// Ungated, with `generate_image` and for its reason twice over: it takes
    /// no id, so nothing this project is missing could make the call
    /// impossible — and it is the tool that makes `boards > 0` true, so gating
    /// it on a board would be gating the first board on itself.
    addBoardFor(state),
    /// Ungated on the same terms, and the other tool a project with nothing in
    /// it can still be answered by: it takes no id either. A user talking about
    /// the look before they have uploaded is exactly who it is for.
    generateImageFor(state),
  ];
}
