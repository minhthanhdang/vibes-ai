"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { TRPCClientError } from "@trpc/client";
import { useTRPCClient } from "@/trpc/react";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/excalidraw-assets";
import {
  carriesReferenceDrag,
  decodeReferenceDrag,
  droppedImages,
  REFERENCE_DRAG_MIME,
  scenePointOfDrop,
} from "@/lib/moodboard-drop";
import { referenceFileId } from "@/lib/moodboard-scene";
import {
  boardSelection,
  selectionSignature,
  type BoardSelection,
} from "@/lib/moodboard-selection";
import {
  autosaveDelay,
  autosaveLabel,
  autosaveRetry,
  hasUnsavedWork,
  initialAutosaveState,
  readyToSave,
  saveConflicted,
  saveFailed,
  saveStarted,
  saveSucceeded,
  sceneEdited,
  sceneSnapshot,
  type AutosaveState,
  type AutosaveStatus,
} from "@/lib/moodboard-autosave";
import { referenceCanvasImagePath } from "@/server/references/display";
import { useBoardImageAdoption } from "./board-image-adoption";
import { useBoardLibrary } from "./board-library";
import { MoodboardInspector } from "./moodboard-inspector";
import type { MoodboardLibrary, MoodboardScene } from "@/server/api/routers/moodboard";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

/// Excalidraw builds its `@font-face` urls the first time a scene's fonts are
/// loaded, which is at mount — so this only has to be set before the editor
/// renders, and module scope of the chunk that renders it is that. Unset, the
/// board's text comes from esm.sh, and when that is unreachable it falls back
/// to a system font without saying so. `public/excalidraw-assets` is written by
/// `npm run mirror:excalidraw`.
window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;

/// Excalidraw paints its own chrome and needs to be told which way; the rest of
/// the app follows the OS, so the board does too rather than sitting as a white
/// rectangle inside a dark page.
const DARK_SCHEME = "(prefers-color-scheme: dark)";

/// A board is where colour is judged, so which way the canvas is lit is a
/// working decision and not only a matter of taste — it has to be overridable
/// without leaving the board. Deliberately not persisted: "system" is the
/// default and excalidraw's appState has nowhere to say it, so storing the
/// resolved `theme` would freeze tomorrow's board in the light it was opened
/// under today.
type ThemePreference = "light" | "dark" | "system";

function subscribeToScheme(onChange: () => void) {
  const query = window.matchMedia(DARK_SCHEME);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useTheme() {
  return useSyncExternalStore(
    subscribeToScheme,
    () => (window.matchMedia(DARK_SCHEME).matches ? "dark" : "light"),
    () => "light" as const,
  );
}

function isConflict(error: unknown) {
  return error instanceof TRPCClientError && error.data?.code === "CONFLICT";
}

/// The stored document in the shape excalidraw mounts with. Cast rather than
/// modelled: the row is round-tripped back to the editor verbatim, so naming
/// its element fields here would only give us a second definition of them to
/// keep in step with excalidraw's own.
///
/// The library's files are merged into the scene's: both are reference pointers
/// resolved against the one map, and an item whose photo is not on this board
/// would otherwise draw as a blank tile in the panel.
function initialData(scene: MoodboardScene, library: MoodboardLibrary): ExcalidrawInitialDataState {
  return {
    elements: scene.elements as unknown as ExcalidrawInitialDataState["elements"],
    appState: scene.appState as ExcalidrawInitialDataState["appState"],
    files: Object.fromEntries(
      [...scene.files, ...library.files].map((file) => [file.id, file]),
    ) as ExcalidrawInitialDataState["files"],
    libraryItems: library.items as unknown as ExcalidrawInitialDataState["libraryItems"],
    /// The stored scroll is the view the director left; fitting to content
    /// would silently move it on every reopen.
    scrollToContent: false,
  };
}

export function MoodboardCanvas({
  projectId,
  scene,
  library,
  onReload,
}: {
  projectId: string;
  scene: MoodboardScene;
  library: MoodboardLibrary;
  onReload: () => void;
}) {
  const client = useTRPCClient();
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);

  const systemTheme = useTheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const theme = themePreference === "system" ? systemTheme : themePreference;

  /// The ref, not the state, is what the transitions read: they run from timers
  /// and promise callbacks, and each needs the value the last one left rather
  /// than the one its render closed over. The mirrored state is only what the
  /// page draws.
  const [initial] = useState(() =>
    initialAutosaveState(scene.revision, scene.elements, scene.appState),
  );
  const stateRef = useRef(initial);
  const [state, setState] = useState(initial);

  const apply = useCallback((transition: (state: AutosaveState) => AutosaveState) => {
    const next = transition(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  /// `onChange` fires on every frame of a drag, so it may not walk the scene.
  /// It parks the editor's arrays here and lets the timer below decide when
  /// turning them into a document is worth the work.
  const latest = useRef<{ elements: unknown; appState: unknown } | null>(null);
  const dirtySince = useRef<number | null>(null);
  const collectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  /// Lets a finished save start the one that queued up behind it without the
  /// callback having to close over a stale copy of itself.
  const saveAgain = useRef<() => void>(undefined);

  const runSave = useCallback(() => {
    const current = stateRef.current;
    if (saving.current || current.status === "error" || !readyToSave(current)) return;
    const outgoing = apply(saveStarted).inFlight;
    if (!outgoing) return;

    saving.current = true;
    /// Deliberately not cancelled on unmount: the director has closed the board
    /// and the write already carries their last edit, so letting it land is the
    /// difference between switching boards and losing a minute of work.
    void client.moodboard.save
      .mutate({
        id: scene.id,
        revision: current.revision,
        elements: outgoing.elements,
        appState: outgoing.appState,
      })
      .then(({ revision }) => apply((current) => saveSucceeded(current, revision)))
      .catch((error: unknown) =>
        apply((current) => (isConflict(error) ? saveConflicted(current) : saveFailed(current))),
      )
      .finally(() => {
        saving.current = false;
        saveAgain.current?.();
      });
  }, [apply, client, scene.id]);

  useEffect(() => {
    saveAgain.current = runSave;
  }, [runSave]);

  /// An image excalidraw put on the board itself — a paste, a desktop file
  /// drop — carries bytes the row does not store, so it is uploaded into the
  /// project and its element repointed at the reference. Scanned on the same
  /// quiet period as the save rather than on `onChange`, which fires per frame.
  const { adopt, failedAdoptions, retryAdoption } = useBoardImageAdoption({ projectId, editor });

  /// The element library is the editor's own, and the editor only holds it in
  /// memory — an item saved from a board is gone on reload unless the host
  /// stores it. It belongs to the project rather than to this board: a title
  /// card made on one board is the reason to have a library at all.
  const { onLibraryChange, librarySaveFailed, retryLibrarySave } = useBoardLibrary({
    projectId,
    items: library.items,
  });

  const collect = useCallback(() => {
    collectTimer.current = null;
    dirtySince.current = null;
    const pending = latest.current;
    if (!pending) return;
    apply((current) => sceneEdited(current, sceneSnapshot(pending.elements, pending.appState)));
    runSave();
    void adopt();
  }, [adopt, apply, runSave]);

  /// Selection is not part of the saved document — it is what the inspector is
  /// about. Resolving it walks the element array, and `onChange` fires on every
  /// frame of a drag with the selection unchanged, so the signature is compared
  /// first and the walk only happens when the director selects something else.
  const selectionKey = useRef("");
  const [selection, setSelection] = useState<BoardSelection>({ kind: "none" });

  const onChange = useCallback(
    (elements: unknown, appState: unknown) => {
      latest.current = { elements, appState };

      const key = selectionSignature(appState);
      if (key !== selectionKey.current) {
        selectionKey.current = key;
        setSelection(boardSelection(elements, appState));
      }

      const now = Date.now();
      dirtySince.current ??= now;
      if (collectTimer.current) clearTimeout(collectTimer.current);
      collectTimer.current = setTimeout(collect, autosaveDelay(dirtySince.current, now));
    },
    [collect],
  );

  /// Closing the board mid-debounce must not drop the last second of work, so
  /// unmounting cuts the wait short and writes rather than cancelling. The
  /// request outlives the component on purpose.
  const flush = useRef<() => void>(undefined);
  useEffect(() => {
    flush.current = collect;
  }, [collect]);

  useEffect(
    () => () => {
      if (!collectTimer.current) return;
      clearTimeout(collectTimer.current);
      flush.current?.();
    },
    [],
  );

  const unsaved = hasUnsavedWork(state);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const retry = useCallback(() => {
    apply(autosaveRetry);
    runSave();
  }, [apply, runSave]);

  /// Handled in the capture phase, before excalidraw's own drop handler: it
  /// treats an unrecognised drag as a paste and would either do nothing or
  /// drop the sidebar's thumbnail URL as a link. A drag that is not ours is
  /// left alone entirely, so files from the desktop still land the way
  /// excalidraw already handles them.
  const dropReference = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const references = decodeReferenceDrag(event.dataTransfer.getData(REFERENCE_DRAG_MIME));
    const api = editor.current;
    if (!references || !api) return;
    event.preventDefault();
    event.stopPropagation();

    const state = api.getAppState();
    /// A drag of six references is one drop: they land as a grid centred on the
    /// cursor, so a batch arrives arranged rather than stacked in one place.
    const images = droppedImages(
      references,
      scenePointOfDrop(event, {
        offsetLeft: state.offsetLeft,
        offsetTop: state.offsetTop,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        zoom: state.zoom.value,
      }),
    );

    /// The bytes are never in the scene — this is the same app URL a reload
    /// would hydrate, so the dropped image and the reloaded one are one
    /// cache entry. The mime type is a placeholder the editor only needs to
    /// decide it is not an SVG; the load derives the real one from the row.
    api.addFiles(
      references.map((reference) => ({
        /// `fileId` is branded in excalidraw's types purely to stop the two id
        /// spaces being confused; ours is a `ref:` pointer by construction.
        id: referenceFileId(reference.referenceId) as BinaryFileData["id"],
        dataURL: referenceCanvasImagePath(reference.referenceId) as BinaryFileData["dataURL"],
        mimeType: "image/jpeg",
        created: Date.now(),
      })),
    );

    /// `convertToExcalidrawElements` fills in everything an element needs that
    /// is excalidraw's business — id, seed, version, fractional index — so the
    /// drop only has to say which reference, where and how big.
    const elements = convertToExcalidrawElements(
      images.map((image) => ({ ...image, fileId: image.fileId as BinaryFileData["id"] })),
    );
    if (elements.length === 0) return;

    api.updateScene({
      /// Including the deleted ones: they are the tombstones undo restores
      /// from, and handing back a scene without them would quietly make every
      /// earlier deletion permanent.
      elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
      /// Selected on arrival: the next thing the director does is place it, and
      /// an unselected drop costs a click before it can be moved or scaled. A
      /// batch arrives selected as a batch, so it can be moved as the block it
      /// was dropped as.
      appState: {
        selectedElementIds: Object.fromEntries(elements.map((element) => [element.id, true])),
      },
      /// Undoable like any other edit — a drop is a mistake as often as a
      /// stroke is, and a batch undoes in one step because it landed in one.
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-xl"
      /// A drop target only exists where something has said it accepts the
      /// drag, and `dragover` is where that is said — every frame of it.
      onDragOverCapture={(event) => {
        if (!carriesReferenceDrag(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={dropReference}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          editor.current = api;
        }}
        theme={theme}
        name={scene.title}
        onChange={onChange}
        onLibraryChange={onLibraryChange}
        initialData={initialData(scene, library)}
        UIOptions={{
          canvasActions: {
            /// The board lives in Postgres under an id. Excalidraw's own file
            /// save and scene load would put a second, divergent copy on disk
            /// — and an imported `.excalidraw` names image bytes we never
            /// stored, so its photos would load as empty boxes. Off here and
            /// not only absent from the menu below, because this is also what
            /// takes ⌘S and ⌘O away from them.
            saveToActiveFile: false,
            loadScene: false,
          },
        }}
      >
        <BoardMenu preference={themePreference} onThemeChange={setThemePreference} />
      </Excalidraw>

      <MoodboardInspector projectId={projectId} selection={selection} />

      {/* Bottom left, below excalidraw's own island on the same side. Stacked
          because both failures can be on screen at once. */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
        <AdoptionFailure count={failedAdoptions} onRetry={retryAdoption} />
        {librarySaveFailed ? (
          <CanvasWarning onRetry={retryLibrarySave}>
            Your library could not be saved — changes to it will not survive a reload.
          </CanvasWarning>
        ) : null}
      </div>

      <SaveStatus status={state.status} onRetry={retry} onReload={onReload} />
    </div>
  );
}

/// Excalidraw's menu, minus what this product does not have and plus a theme
/// control that works. Listed rather than defaulted because the default menu
/// ends in an "Excalidraw links" group — GitHub, X, Discord — which is somebody
/// else's product inside ours, and because two of its items (open a file, save
/// to a file) are switched off above and would render as dead entries.
///
/// Everything kept is a feature a moodboard wants and excalidraw already has:
/// exporting the board as an image, finding text on a large canvas, the command
/// palette, the shortcut sheet, the canvas background, and resetting the board.
function BoardMenu({
  preference,
  onThemeChange,
}: {
  preference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
}) {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.CommandPalette />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      {/* Three-way rather than a flip: without "system" the only way back to
          following the OS is remembering which way the OS is set. */}
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={preference}
        onSelect={onThemeChange}
      />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
}

/// Something on the board is not stored and looks exactly like something that
/// is — the failure has to be said here, because the alternative is the
/// director finding out on tomorrow's reload.
function CanvasWarning({
  children,
  onRetry,
}: {
  children: React.ReactNode;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white shadow-lg">
      <span>{children}</span>
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}

function AdoptionFailure({ count, onRetry }: { count: number; onRetry: () => void }) {
  if (count === 0) return null;

  return (
    <CanvasWarning onRetry={onRetry}>
      {count} {count === 1 ? "image" : "images"} could not be added to this project —{" "}
      {count === 1 ? "it" : "they"} will not survive a reload.
    </CanvasWarning>
  );
}

/// Sits over the canvas rather than in a toolbar: the only time it has to be
/// read is when a save has stopped happening, and that has to be visible
/// wherever the director is looking.
function SaveStatus({
  status,
  onRetry,
  onReload,
}: {
  status: AutosaveStatus;
  onRetry: () => void;
  onReload: () => void;
}) {
  const broken = status === "error" || status === "conflict";
  const label = autosaveLabel(status);

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      {broken ? (
        <button
          type="button"
          onClick={status === "conflict" ? onReload : onRetry}
          className="pointer-events-auto rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {label}
        </button>
      ) : (
        <span
          className={`rounded-full bg-black/70 px-3 py-1 text-[11px] text-white transition-opacity ${
            status === "idle" ? "opacity-0" : "opacity-100"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
