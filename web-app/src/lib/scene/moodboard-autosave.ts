import { persistableElements, persistedAppState } from "@/lib/scene/moodboard-scene";
import type { PersistedAppState, SceneElement } from "@/lib/scene/moodboard-scene";

export const AUTOSAVE_DEBOUNCE_MS = 900;

export const AUTOSAVE_MAX_WAIT_MS = 6000;

export type SceneSnapshot = { elements: SceneElement[]; appState: PersistedAppState };

export type AutosaveStatus = "idle" | "pending" | "saving" | "error" | "conflict";

export type AutosaveState = {
  revision: number;
  saved: string;
  pending: SceneSnapshot | null;
  inFlight: SceneSnapshot | null;
  status: AutosaveStatus;
};

export function sceneSnapshot(elements: unknown, appState: unknown): SceneSnapshot {
  return { elements: persistableElements(elements), appState: persistedAppState(appState) };
}

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

export function sceneEdited(state: AutosaveState, snapshot: SceneSnapshot): AutosaveState {
  const fingerprint = sceneFingerprint(snapshot);
  if (fingerprint === state.saved) {
    return state.pending ? withPending(state, null) : state;
  }
  if (state.pending && sceneFingerprint(state.pending) === fingerprint) return state;
  return withPending(state, snapshot);
}

export function readyToSave(state: AutosaveState) {
  return state.pending !== null && state.inFlight === null && state.status !== "conflict";
}

export function saveStarted(state: AutosaveState): AutosaveState {
  if (!readyToSave(state)) return state;
  return { ...state, pending: null, inFlight: state.pending, status: "saving" };
}

export function saveSucceeded(state: AutosaveState, revision: number): AutosaveState {
  if (!state.inFlight) return state;
  const saved = sceneFingerprint(state.inFlight);
  const pending = state.pending && sceneFingerprint(state.pending) === saved ? null : state.pending;
  return withPending({ ...state, revision, saved, inFlight: null, status: "idle" }, pending);
}

export function saveFailed(state: AutosaveState): AutosaveState {
  if (!state.inFlight) return state;
  return { ...state, pending: state.pending ?? state.inFlight, inFlight: null, status: "error" };
}

export function autosaveRetry(state: AutosaveState): AutosaveState {
  if (state.status !== "error" || !state.pending) return state;
  return { ...state, status: "pending" };
}

export function saveConflicted(state: AutosaveState): AutosaveState {
  return { ...state, pending: null, inFlight: null, status: "conflict" };
}

export function autosaveDelay(queuedSince: number, now: number) {
  const waited = Math.max(0, now - queuedSince);
  return Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS - waited));
}

export function hasUnsavedWork(state: AutosaveState) {
  return state.pending !== null || state.inFlight !== null;
}

export function isWriting(status: AutosaveStatus) {
  return status === "pending" || status === "saving";
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
