import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  autosaveDelay,
  autosaveLabel,
  autosaveRetry,
  hasUnsavedWork,
  isWriting,
  initialAutosaveState,
  readyToSave,
  saveConflicted,
  saveFailed,
  saveStarted,
  saveSucceeded,
  sceneEdited,
  sceneFingerprint,
  sceneSnapshot,
} from "./moodboard-autosave";

const rect = (id: string, x = 0) => ({ id, type: "rectangle", x, y: 0 });

/// Mount, then one edit queued and written — the path every other test forks
/// off, so it is built rather than repeated.
function afterOneEdit() {
  const state = initialAutosaveState(3, [rect("a")], {});
  return sceneEdited(state, sceneSnapshot([rect("a"), rect("b")], {}));
}

test("a snapshot drops what the server would drop", () => {
  const snapshot = sceneSnapshot(
    [rect("a"), { id: "gone", type: "rectangle", isDeleted: true }],
    { scrollX: 10, openMenu: "canvas", collaborators: new Map() },
  );

  assert.deepEqual(
    snapshot.elements.map((element) => element.id),
    ["a"],
  );
  assert.deepEqual(snapshot.appState, { scrollX: 10 });
});

test("mounting reports the scene the server already holds as no change", () => {
  const state = initialAutosaveState(3, [rect("a")], { scrollX: 5 });
  const unchanged = sceneEdited(state, sceneSnapshot([rect("a")], { scrollX: 5 }));

  assert.equal(unchanged, state);
  assert.equal(unchanged.status, "idle");
  assert.equal(readyToSave(unchanged), false);
});

test("a change excalidraw reports but the server would not store costs no request", () => {
  const state = initialAutosaveState(3, [rect("a")], {});
  const selected = sceneEdited(
    state,
    sceneSnapshot([rect("a")], { selectedElementIds: { a: true }, openDialog: "help" }),
  );

  assert.equal(selected, state);
});

test("an edit queues a save and marks the board unsaved", () => {
  const state = afterOneEdit();

  assert.equal(state.status, "pending");
  assert.equal(readyToSave(state), true);
  assert.equal(hasUnsavedWork(state), true);
  assert.equal(state.pending?.elements.length, 2);
});

test("repeating the same edit does not requeue it", () => {
  const state = afterOneEdit();
  const again = sceneEdited(state, sceneSnapshot([rect("a"), rect("b")], {}));

  assert.equal(again, state);
});

test("editing back to the stored scene cancels the queued save", () => {
  const state = afterOneEdit();
  const reverted = sceneEdited(state, sceneSnapshot([rect("a")], {}));

  assert.equal(reverted.pending, null);
  assert.equal(reverted.status, "idle");
  assert.equal(hasUnsavedWork(reverted), false);
});

test("a started save takes the queued scene and leaves nothing ready", () => {
  const started = saveStarted(afterOneEdit());

  assert.equal(started.status, "saving");
  assert.equal(started.pending, null);
  assert.equal(started.inFlight?.elements.length, 2);
  assert.equal(readyToSave(started), false);
});

test("edits during a save queue behind it rather than racing it", () => {
  const started = saveStarted(afterOneEdit());
  const during = sceneEdited(started, sceneSnapshot([rect("a"), rect("b"), rect("c")], {}));

  assert.equal(during.status, "saving");
  assert.equal(readyToSave(during), false);
  assert.equal(during.pending?.elements.length, 3);
});

test("a successful save advances the revision and settles", () => {
  const done = saveSucceeded(saveStarted(afterOneEdit()), 4);

  assert.equal(done.revision, 4);
  assert.equal(done.status, "idle");
  assert.equal(hasUnsavedWork(done), false);
  assert.equal(done.saved, sceneFingerprint(sceneSnapshot([rect("a"), rect("b")], {})));
});

test("a scene queued mid-save is ready the moment the save lands", () => {
  const started = saveStarted(afterOneEdit());
  const during = sceneEdited(started, sceneSnapshot([rect("a"), rect("b"), rect("c")], {}));
  const done = saveSucceeded(during, 4);

  assert.equal(done.status, "pending");
  assert.equal(readyToSave(done), true);
  assert.equal(done.pending?.elements.length, 3);
});

test("an edit the in-flight save already carried is not saved twice", () => {
  const started = saveStarted(afterOneEdit());
  const echoed = sceneEdited(started, sceneSnapshot([rect("a"), rect("b")], {}));
  const done = saveSucceeded(echoed, 4);

  assert.equal(done.pending, null);
  assert.equal(done.status, "idle");
});

test("a failed save keeps its scene for the retry", () => {
  const failed = saveFailed(saveStarted(afterOneEdit()));

  assert.equal(failed.status, "error");
  assert.equal(failed.pending?.elements.length, 2);
  assert.equal(hasUnsavedWork(failed), true);
});

test("a newer edit supersedes the scene a failed save was carrying", () => {
  const started = saveStarted(afterOneEdit());
  const during = sceneEdited(started, sceneSnapshot([rect("a"), rect("b"), rect("c")], {}));
  const failed = saveFailed(during);

  assert.equal(failed.pending?.elements.length, 3);
});

test("an errored board does not autosave again on the next edit", () => {
  const failed = saveFailed(saveStarted(afterOneEdit()));
  const edited = sceneEdited(failed, sceneSnapshot([rect("a"), rect("b"), rect("c")], {}));

  assert.equal(edited.status, "error");
  assert.equal(edited.pending?.elements.length, 3);
  /// Nothing is in flight, so a deliberate retry can still run — the label is
  /// what stops the loop, not the queue.
  assert.equal(readyToSave(edited), true);
});

test("retrying an errored board queues its scene again", () => {
  const failed = saveFailed(saveStarted(afterOneEdit()));
  const retried = autosaveRetry(failed);

  assert.equal(retried.status, "pending");
  assert.equal(readyToSave(retried), true);
  assert.equal(retried.pending?.elements.length, 2);
});

test("retry is a no-op for a conflicted or already-clean board", () => {
  const conflicted = saveConflicted(saveStarted(afterOneEdit()));
  assert.equal(autosaveRetry(conflicted), conflicted);

  const clean = initialAutosaveState(1, [rect("a")], {});
  assert.equal(autosaveRetry(clean), clean);
});

test("a conflict stops autosaving instead of overwriting the other tab", () => {
  const conflicted = saveConflicted(saveStarted(afterOneEdit()));

  assert.equal(conflicted.status, "conflict");
  assert.equal(readyToSave(conflicted), false);

  const edited = sceneEdited(conflicted, sceneSnapshot([rect("a"), rect("z")], {}));
  assert.equal(edited.status, "conflict");
  assert.equal(readyToSave(edited), false);
});

test("reloading after a conflict returns the board to a clean state", () => {
  saveConflicted(saveStarted(afterOneEdit()));
  const reloaded = initialAutosaveState(9, [rect("a"), rect("other")], {});

  assert.equal(reloaded.status, "idle");
  assert.equal(reloaded.revision, 9);
  assert.equal(hasUnsavedWork(reloaded), false);
});

test("a viewport-only change is still worth storing", () => {
  const state = initialAutosaveState(1, [rect("a")], { scrollX: 0 });
  const panned = sceneEdited(state, sceneSnapshot([rect("a")], { scrollX: 400, scrollY: -20 }));

  assert.equal(panned.status, "pending");
});

test("a pause after an edit waits out the debounce", () => {
  assert.equal(autosaveDelay(1000, 1000), AUTOSAVE_DEBOUNCE_MS);
  assert.equal(autosaveDelay(1000, 1300), AUTOSAVE_DEBOUNCE_MS);
});

test("an edit that never pauses is still written by the max wait", () => {
  const queued = 1000;
  const nearDeadline = queued + AUTOSAVE_MAX_WAIT_MS - 200;

  assert.equal(autosaveDelay(queued, nearDeadline), 200);
  assert.equal(autosaveDelay(queued, queued + AUTOSAVE_MAX_WAIT_MS), 0);
  assert.equal(autosaveDelay(queued, queued + AUTOSAVE_MAX_WAIT_MS + 5000), 0);
});

test("every status reads as something a director can act on", () => {
  assert.equal(autosaveLabel("idle"), "Saved");
  assert.equal(autosaveLabel("saving"), "Saving…");
  assert.match(autosaveLabel("conflict"), /reload/);
  assert.match(autosaveLabel("error"), /retry/);
});

/// What a duplicate waits on. A save that cannot land on its own must not read
/// as writing, or waiting for the stored scene would never return.
test("only a write that will still land reads as writing", () => {
  assert.equal(isWriting("pending"), true);
  assert.equal(isWriting("saving"), true);
  assert.equal(isWriting("idle"), false);
  assert.equal(isWriting("error"), false);
  assert.equal(isWriting("conflict"), false);
});
