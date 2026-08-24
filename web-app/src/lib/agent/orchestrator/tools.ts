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
  MOVE_TO_PAGE,
  RESIZE_PAGE,
  REWORD_ON_BOARD,
  SWAP_ON_BOARD,
  addBoardFor,
} from "@/lib/agent/orchestrator/board-tools";
import { designPageFor } from "@/lib/agent/orchestrator/handoff-tools";
import {
  PUT_ON_CANVAS,
  READ_CANVAS,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  RESTYLE_ON_CANVAS,
  SET_CANVAS_BACKGROUND,
  SET_PAGE_BACKGROUND,
  TRANSFORM_ON_CANVAS,
} from "@/lib/agent/shared/canvas-tools";
import type { ProjectState } from "@/lib/agent/shared/tool-declaration";

/// The tools this project can actually use, rather than every tool that exists.
/// Declarations are the one input paid on *every round of every turn*, so the
/// set is a function of what the project holds — and the same counts then
/// decide what the surviving declarations *say*.
///
/// Order is fixed rather than derived, so two turns of one conversation hand the
/// model the same tools in the same order.
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
          SWAP_ON_BOARD,
          REWORD_ON_BOARD,
          MOVE_TO_PAGE,
          /// A page's ground, gated with the page tools above it rather than on
          /// a pages count: `ProjectState` carries no such count, and every
          /// other page tool here is on the boards gate for the plain reason
          /// that a page id can only come from a board.
          SET_PAGE_BACKGROUND,
          /// The desk the pages sit on, beside the page's own ground because
          /// the pair is one decision: which of the two a sentence means is the
          /// only thing the model has to get right, and two adjacent
          /// declarations is where it reads that. Agent 6's alone — it is the
          /// board a user is looking at, and `designerTools` does not carry it.
          SET_CANVAS_BACKGROUND,
          /// The canvas six: every one addresses objects by handles only
          /// read_canvas surfaces, and every handle is a board's, so the gate
          /// is the boards count the other board tools are on.
          READ_CANVAS,
          PUT_ON_CANVAS,
          REMOVE_FROM_CANVAS,
          TRANSFORM_ON_CANVAS,
          REORDER_ON_CANVAS,
          RESTYLE_ON_CANVAS,
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
