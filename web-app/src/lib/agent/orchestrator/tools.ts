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
          LIST_BOARDS,
          GET_BOARD_BRIEF,
          INSPECT_BOARD,
          ADD_PAGE,
          DUPLICATE_PAGE,
          RESIZE_PAGE,
          DUPLICATE_BOARD,
          SET_CANVAS_BACKGROUND,
          ORCHESTRATOR_READ_CANVAS,
          DISCARD_PAGE,
          DISCARD_BOARD,
        ]
      : []),
    ...(boards > 0 ? [designPageFor(state)] : []),
    addBoardFor(state),
    generateImageFor(state),
  ];
}
