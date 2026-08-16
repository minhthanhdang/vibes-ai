import { persistableElements, persistedAppState } from "./moodboard-scene";
import type { PersistedAppState, SceneElement } from "./moodboard-scene";

/// Excalidraw fires `onChange` on every pointer move of a drag, so the board
/// cannot write on each one. This is the whole autosave policy in one place,
/// free of React and of tRPC: what a change is, when it is worth a request, and
/// what the board does when the request comes back.

/// Long enough that dragging a photo across the canvas is one save rather than
/// two hundred, short enough that a director who drops an image and closes the
/// tab keeps it.
export const AUTOSAVE_DEBOUNCE_MS = 900;

/// A slow continuous edit — redrawing a stroke for a minute — would otherwise
/// never reach a quiet moment and never save at all.
export const AUTOSAVE_MAX_WAIT_MS = 6000;

export type SceneSnapshot = { elements: SceneElement[]; appState: PersistedAppState };

/// "idle" means the server holds what the editor shows. "conflict" is terminal
/// until the board reloads: another tab has written, and retrying would be the
/// overwrite the revision guard exists to prevent.
export type AutosaveStatus = "idle" | "pending" | "saving" | "error" | "conflict";

export type AutosaveState = {
  revision: number;
  /// Fingerprint of the scene the server holds.
  saved: string;
  /// Newest scene from the editor that is not on the server yet.
  pending: SceneSnapshot | null;
  /// The snapshot the in-flight request is writing. Kept so a failure can put
  /// it back rather than losing the edits it carried.
  inFlight: SceneSnapshot | null;
  status: AutosaveStatus;
};

/// What excalidraw hands `onChange`, reduced to the document. Running the same
/// filters the server runs means a change the server would discard — a
/// tombstone appearing, an unlisted appState key moving — never counts as a
/// change here either, and so never costs a request.
export function sceneSnapshot(elements: unknown, appState: unknown): SceneSnapshot {
  return { elements: persistableElements(elements), appState: persistedAppState(appState) };
}

/// Structural equality by serialisation. Element objects are replaced wholesale
/// by excalidraw on every edit, so reference comparison always reports a change
/// and a deep walk is the same work as this with more code.
export function sceneFingerprint(snapshot: SceneSnapshot) {
  return JSON.stringify(snapshot);
}

export function initialAutosaveState(
  revision: number,
  elements: unknown,
  appState: unknown,
): AutosaveState {
  return {
    revision,
    saved: sceneFingerprint(sceneSnapshot(elements, appState)),
    pending: null,
    inFlight: null,
    status: "idle",
  };
}

function withPending(
  state: AutosaveState,
  pending: SceneSnapshot | null,
  overrides: Partial<AutosaveState> = {},
): AutosaveState {
  const next = { ...state, pending, ...overrides };
  if (next.status === "conflict" || next.status === "error") return next;
  next.status = next.inFlight ? "saving" : pending ? "pending" : "idle";
  return next;
}

/// The editor reported a scene. Returns the state unchanged — same object, so a
/// React setState is a no-op — when the scene is one the server already has,
/// which is what mounting, panning under an unpersisted key, or selecting an
/// element all produce.
export function sceneEdited(state: AutosaveState, snapshot: SceneSnapshot): AutosaveState {
  const fingerprint = sceneFingerprint(snapshot);
  if (fingerprint === state.saved) {
    /// Edited back to what is stored: whatever was queued is now moot, but a
    /// request already in flight still has to land before that is true.
    return state.pending ? withPending(state, null) : state;
  }
  if (state.pending && sceneFingerprint(state.pending) === fingerprint) return state;
  return withPending(state, snapshot);
}

/// A queued scene is only worth a request when nothing is in flight — the
/// revision guard would reject a second concurrent write anyway — and never
/// after a conflict, where the board is waiting to be reloaded.
export function readyToSave(state: AutosaveState) {
  return state.pending !== null && state.inFlight === null && state.status !== "conflict";
}

export function saveStarted(state: AutosaveState): AutosaveState {
  if (!readyToSave(state)) return state;
  return { ...state, pending: null, inFlight: state.pending, status: "saving" };
}

/// The request the server accepted. `revision` is what it returned, and the
/// queued scene is dropped when the write turns out to have already contained
/// it — an edit landing mid-request that the request happened to carry.
export function saveSucceeded(state: AutosaveState, revision: number): AutosaveState {
  if (!state.inFlight) return state;
  const saved = sceneFingerprint(state.inFlight);
  const pending = state.pending && sceneFingerprint(state.pending) === saved ? null : state.pending;
  return withPending({ ...state, revision, saved, inFlight: null, status: "idle" }, pending);
}

/// A failed write keeps its scene: it goes back to the front of the queue
/// unless the editor has since produced a newer one, which supersedes it. The
/// board stays in "error" so the retry is a deliberate one and a server that is
/// down does not get a request every debounce.
export function saveFailed(state: AutosaveState): AutosaveState {
  if (!state.inFlight) return state;
  return { ...state, pending: state.pending ?? state.inFlight, inFlight: null, status: "error" };
}

/// The director asked to try again. Only an errored board has anything to
/// retry — a conflict needs the reload, not another attempt at the same write.
export function autosaveRetry(state: AutosaveState): AutosaveState {
  if (state.status !== "error" || !state.pending) return state;
  return { ...state, status: "pending" };
}

/// Another tab wrote first. Its scene is the truth now, so ours is not requeued
/// — reloading the board is the only way out, and that is a decision for the
/// director rather than something to do under their cursor.
export function saveConflicted(state: AutosaveState): AutosaveState {
  return { ...state, pending: null, inFlight: null, status: "conflict" };
}

/// How long the queued scene may wait. A debounce, except that it can never
/// push the write past `AUTOSAVE_MAX_WAIT_MS` from the moment the board first
/// went dirty — a continuous edit that never pauses would otherwise never
/// reach the quiet the debounce is waiting for.
export function autosaveDelay(queuedSince: number, now: number) {
  const waited = Math.max(0, now - queuedSince);
  return Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS - waited));
}

/// True while the tab holds work the server does not, which is what a
/// beforeunload warning and a "Saving…" label are both asking.
export function hasUnsavedWork(state: AutosaveState) {
  return state.pending !== null || state.inFlight !== null;
}

export function autosaveLabel(status: AutosaveStatus) {
  switch (status) {
    case "idle":
      return "Saved";
    case "pending":
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed — retry";
    case "conflict":
      return "Changed in another tab — reload";
  }
}
