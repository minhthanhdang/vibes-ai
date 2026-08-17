"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaptureUpdateAction, Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { galleryAnalysisIndex } from "@/lib/analysis/gallery-analysis";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/scene/excalidraw-assets";
import {
  carriesReferenceDrag,
  decodeReferenceDrag,
  REFERENCE_DRAG_MIME,
  scenePointOfDrop,
  scenePointOfViewportCentre,
  type ScenePoint,
} from "@/lib/canvas/moodboard-drop";
import {
  carriesWebImageDrag,
  pastedImageUrls,
  webImageDragUrl,
  WEB_IMAGE_MIMES,
} from "@/lib/intake/web-image-import";
import {
  boardSelection,
  selectedElementIds,
  selectionSignature,
  type BoardSelection,
} from "@/lib/canvas/moodboard-selection";
import { referenceIdFromFileId } from "@/lib/scene/moodboard-scene";
import { arrangeTargets, type ArrangeBox, type ArrangeScope } from "@/lib/canvas/moodboard-arrange";
import { captionablePhotos } from "@/lib/canvas/moodboard-caption";
import { croppablePhotos, croppingElementId } from "@/lib/canvas/moodboard-crop";
import { colourOrder, hasColourOrder, type BoardPalettes } from "@/lib/canvas/moodboard-order";
import {
  autosaveDelay,
  autosaveLabel,
  autosaveRetry,
  hasUnsavedWork,
  initialAutosaveState,
  isWriting,
  readyToSave,
  saveConflicted,
  saveFailed,
  saveStarted,
  saveSucceeded,
  sceneEdited,
  sceneSnapshot,
  type AutosaveState,
  type AutosaveStatus,
} from "@/lib/scene/moodboard-autosave";
import { clearBoardPlacement, publishBoardPlacement } from "./board-placement";
import { useBoardImageAdoption } from "./board-image-adoption";
import { useBoardLibrary } from "./board-library";
import { useBoardRender } from "./board-render";
import { usePagePicture } from "./page-picture";
import { tidyBoard } from "./board-arrange";
import { captionSelectedPhotos } from "./board-caption";
import { useBoardCrops } from "./board-crop";
import { placePalette } from "./board-palette";
import { placeReferences } from "./board-references";
import { useBoardWebImages } from "./board-web-images";
import { MoodboardInspector } from "./moodboard-inspector";
import { MoodboardExportPanel } from "./moodboard-export-panel";
import type { MoodboardLibrary, MoodboardScene } from "@/server/api/routers/moodboard";
import type {
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

/// Where a paste is text being entered rather than something being placed on the
/// board: excalidraw's canvas text editor, its search box, the board's own
/// fields.
function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

/// Whether a drag is over one of the panels floating above the board rather
/// than over the board itself. Every drop the canvas makes is at a scene point
/// read off the cursor, so a drag released on a panel would place the photo at
/// whatever that panel is covering — and the inspector's versions list is a drag
/// source *inside* this drop target, so "drop it back where it came from" is the
/// ordinary way to abandon one. Refused at `dragover` rather than swallowed at
/// the drop, so a panel that will not take the drag never shows the cursor that
/// says it will.
function onBoardOverlay(event: React.DragEvent) {
  return event.target instanceof Element && event.target.closest("[data-board-overlay]") !== null;
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
  saveGateRef,
}: {
  projectId: string;
  scene: MoodboardScene;
  library: MoodboardLibrary;
  onReload: () => void;
  /// Where the board publishes "the server now holds what is on screen" for the
  /// panel around it. Anything acting on the *stored* board — duplicating it —
  /// has to wait on this, or it copies the scene as of the last write rather
  /// than the one the director is looking at.
  saveGateRef?: React.RefObject<(() => Promise<void>) | null>;
}) {
  const client = useTRPCClient();
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);

  /// The ref is what the handlers read; this is what tells a render or a redraw
  /// that there is something to read. Stable and idempotent because excalidraw
  /// re-runs the callback whenever its identity changes, which for an inline one
  /// is every render.
  const [editorReady, setEditorReady] = useState(false);
  const holdEditor = useCallback((api: ExcalidrawImperativeAPI) => {
    editor.current = api;
    setEditorReady(true);
  }, []);

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

  /// Whoever is waiting for the server to hold what is on screen. Woken by every
  /// transition that leaves nothing on its way, including a failed one — a save
  /// that will not land on its own is settled, and hanging the caller on it
  /// would be worse than telling it the truth about what is stored.
  const settled = useRef<(() => void)[]>([]);

  const apply = useCallback((transition: (state: AutosaveState) => AutosaveState) => {
    const next = transition(stateRef.current);
    stateRef.current = next;
    setState(next);
    if (!isWriting(next.status) && settled.current.length > 0) {
      const waiting = settled.current;
      settled.current = [];
      for (const wake of waiting) wake();
    }
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

  /// Every reference the server resolved for this board — proof, rather than a
  /// cached list, that those pointers are this project's. Anything on the board
  /// naming a reference outside it is either a photo copied in from another
  /// project or one that has been deleted, and adoption tells the two apart.
  const knownReferenceIds = useMemo(
    () =>
      [...scene.files, ...library.files]
        .map((file) => referenceIdFromFileId(file.id))
        .filter((id): id is string => id !== null),
    [library.files, scene.files],
  );

  /// An image excalidraw put on the board itself — a paste, a desktop file
  /// drop — carries bytes the row does not store, so it is uploaded into the
  /// project and its element repointed at the reference. An element pasted from
  /// another project's board is the same loss wearing a `ref:` pointer, and is
  /// copied in the same way. Scanned on the same quiet period as the save rather
  /// than on `onChange`, which fires per frame.
  const { adopt, failedAdoptions, retryAdoption } = useBoardImageAdoption({
    projectId,
    editor,
    knownReferenceIds,
  });

  /// The element library is the editor's own, and the editor only holds it in
  /// memory — an item saved from a board is gone on reload unless the host
  /// stores it. It belongs to the project rather than to this board: a title
  /// card made on one board is the reason to have a library at all.
  const { onLibraryChange, librarySaveFailed, retryLibrarySave } = useBoardLibrary({
    projectId,
    items: library.items,
  });

  /// What the board looks like, as an image. Nothing outside the editor can draw
  /// an element array, so the tab showing the board is the only place a preview
  /// — or agent 5's picture of what it is building a deck from — can come from.
  useBoardRender({
    boardId: scene.id,
    projectId,
    editor,
    editorReady,
    status: state.status,
    revision: state.revision,
    renderedRevision: scene.renderedRevision,
  });

  /// The colour of every reference in the project, as agent 2 read it. The
  /// sidebar strip polls this same query while a run is still going, so the
  /// board shares one round trip with it and adds no poll of its own — a board
  /// is looking at photos that have long since been analyzed.
  const trpc = useTRPC();
  const { data: analysis } = useQuery(
    trpc.reference.analysisByProject.queryOptions({ projectId }),
  );
  const palettes: BoardPalettes = useMemo(() => {
    const index = new Map<string, readonly string[]>();
    if (!analysis) return index;
    for (const [referenceId, view] of galleryAnalysisIndex(analysis)) {
      if (view.kind === "ready") index.set(referenceId, view.properties.colorPalette);
    }
    return index;
  }, [analysis]);

  /// What a tidy would act on, which is what its button has to say before it is
  /// pressed — "tidy" that silently re-laid the whole board when two photos were
  /// selected is the wrong action taken without asking. Computed where the scene
  /// is already being walked rather than on its own schedule, and left alone
  /// when the answer has not changed so it costs no render.
  const [tidy, setTidy] = useState<TidyTargets>({
    scope: "board",
    units: 0,
    photos: 0,
    referenceIds: [],
    frames: 0,
  });
  const noteTidy = useCallback((elements: unknown, appState: unknown) => {
    const { scope, boxes, groups } = arrangeTargets(elements, appState);
    /// Which references are on the board is what decides whether sorting by
    /// colour has anything to say, and this is the walk that already knows.
    const referenceIds = boxes
      .map((box) => box.referenceId)
      .filter((id): id is string => typeof id === "string");
    const frames = groups.filter((group) => group.frame).length;
    /// Two counts, because a grouped photo is one thing to move and still a
    /// photo: the button is offered on how many *units* there are to rearrange
    /// and says how many *images* that comes to.
    const photos = boxes.reduce((total, box) => total + (box.photos ?? 1), 0);
    setTidy((current) =>
      current.scope === scope &&
      current.units === boxes.length &&
      current.photos === photos &&
      current.frames === frames &&
      current.referenceIds.join() === referenceIds.join()
        ? current
        : { scope, units: boxes.length, photos, referenceIds, frames },
    );
  }, []);

  const collect = useCallback(() => {
    collectTimer.current = null;
    dirtySince.current = null;
    const pending = latest.current;
    if (!pending) return;
    apply((current) => sceneEdited(current, sceneSnapshot(pending.elements, pending.appState)));
    noteTidy(pending.elements, pending.appState);
    /// Which photos are on the board, for the strip they were dragged from. On
    /// the quiet period rather than on `onChange`: the answer only changes when a
    /// photo arrives or leaves, and the walk must not be on the frames of a drag.
    publishBoardPlacement(scene.id, pending.elements);
    runSave();
    void adopt();
  }, [adopt, apply, noteTidy, runSave, scene.id]);

  /// The board as opened, before anything has been edited — otherwise the strip
  /// says nothing is placed until the director happens to move something.
  useEffect(() => {
    publishBoardPlacement(scene.id, scene.elements);
    /// No board open is a different answer from an empty board: the strip stops
    /// offering the question rather than marking every reference unused.
    return clearBoardPlacement;
  }, [scene.id, scene.elements]);

  /// Selection is not part of the saved document — it is what the inspector is
  /// about. Resolving it walks the element array, and `onChange` fires on every
  /// frame of a drag with the selection unchanged, so the signature is compared
  /// first and the walk only happens when the director selects something else.
  const selectionKey = useRef("");
  const [selection, setSelection] = useState<BoardSelection>({ kind: "none" });
  const [selectionCount, setSelectionCount] = useState(0);
  const [captionable, setCaptionable] = useState(0);
  const [croppable, setCroppable] = useState(0);

  /// Every route that asks excalidraw for an image export — the menu item, ⌘⇧E,
  /// the command palette — does the one thing: it sets `openDialog` to
  /// `imageExport`. So that is what is intercepted, rather than a button, and
  /// the board has one export however the director reached for it. Excalidraw's
  /// own dialog is switched off in `UIOptions` below, so the state it is left in
  /// would render nothing at all — clearing it is what lets the same request be
  /// made twice.
  const [exporting, setExporting] = useState(false);
  const closeExport = useCallback(() => setExporting(false), []);

  const onChange = useCallback(
    (elements: unknown, appState: unknown) => {
      latest.current = { elements, appState };

      if ((appState as { openDialog?: { name?: string } | null }).openDialog?.name === "imageExport") {
        editor.current?.updateScene({
          appState: { openDialog: null },
          /// Opening a dialog is not an edit, and undoing past it would be an
          /// undo step that did nothing.
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        setExporting(true);
      }

      /// Crop mode is part of the key, not only the selection: cropping a photo
      /// does not change what is selected, so a key made of the selection alone
      /// would leave the offer to keep the crop hidden until the director clicked
      /// somewhere else. Leaving crop mode is when the crop becomes final, and
      /// this is a scalar comparison, so dragging a crop handle still costs
      /// nothing.
      const key = `${selectionSignature(appState)} ${croppingElementId(appState)}`;
      if (key !== selectionKey.current) {
        selectionKey.current = key;
        setSelection(boardSelection(elements, appState));
        /// What "only the selected" would mean, for the export panel. Derived in
        /// the same guarded branch as the rest of the selection so a drag still
        /// costs nothing.
        setSelectionCount(selectedElementIds(appState).length);
        /// Which of the selected photos could take a caption — read in the same
        /// guarded branch, since it is a walk of the same array for the same
        /// reason.
        setCaptionable(captionablePhotos(elements, appState));
        /// How many of the selected photos are showing a crop that is not yet a
        /// photo of its own — the same walk, for the same reason.
        setCroppable(croppablePhotos(elements, appState).length);
        /// Selecting photos is how a tidy is aimed, so the button has to follow
        /// the selection rather than wait out the quiet period with the wrong
        /// scope on it.
        noteTidy(elements, appState);
      }

      const now = Date.now();
      dirtySince.current ??= now;
      if (collectTimer.current) clearTimeout(collectTimer.current);
      collectTimer.current = setTimeout(collect, autosaveDelay(dirtySince.current, now));
    },
    [collect, noteTidy],
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

  /// Cuts the debounce short and resolves once the write it started has landed,
  /// so the panel can act on a stored scene that is the one on screen. Nothing
  /// queued means nothing to wait for.
  const flushSaves = useCallback(() => {
    if (collectTimer.current) {
      clearTimeout(collectTimer.current);
      collect();
    }
    if (!isWriting(stateRef.current.status)) return Promise.resolve();
    return new Promise<void>((resolve) => settled.current.push(resolve));
  }, [collect]);

  useEffect(() => {
    if (!saveGateRef) return;
    saveGateRef.current = flushSaves;
    /// The board is gone and with it the only thing that could resolve a wait:
    /// anything still waiting is woken rather than left hanging.
    return () => {
      saveGateRef.current = null;
      const waiting = settled.current;
      settled.current = [];
      for (const wake of waiting) wake();
    };
  }, [flushSaves, saveGateRef]);

  /// And a picture of one page of it, for a message the chat is about to send
  /// (§V.5). Registered from here rather than driven by a timer like the board's
  /// preview is: it is taken when the director presses send, on the board they
  /// have open, and this is the only place with a canvas to draw it on.
  usePagePicture({
    boardId: scene.id,
    editor,
    editorReady,
    state: stateRef,
    flushSaves,
  });

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

  /// The colours of what is selected, placed on the board as a bar of swatches.
  /// It lands as ordinary elements, so from the moment it exists it is the
  /// editor's to move, scale, restyle and undo — and the autosave's to store,
  /// which is why nothing has to be told a palette was added.
  const addPalette = useCallback((colors: string[]) => {
    if (editor.current) placePalette(editor.current, colors);
  }, []);

  /// The reference's own title, put under the photo and grouped with it. A note
  /// beside a photo that is not grouped with it is separated from it by the
  /// first tidy and left behind by the first drag — the group is what makes the
  /// two one object, to the editor and to §II.8's layout alike.
  const addCaption = useCallback((text: string) => {
    if (editor.current) captionSelectedPhotos(editor.current, text);
  }, []);

  /// The photos laid out in rows of one height. Excalidraw aligns and
  /// distributes, but both leave every element the size it already is — and a
  /// board is collected at whatever size each photo happened to arrive, so
  /// lining them up is not what makes them read as one image.
  ///
  /// By colour, the same layout is filled in agent 2's order instead of the
  /// board's: grouping the warm frames away from the cold ones is the judgement
  /// a moodboard is made to support, and it is the one sort neither excalidraw
  /// nor a file browser can do at all.
  const tidyImages = useCallback(
    (order?: "colour") => {
      if (!editor.current) return;
      tidyBoard(
        editor.current,
        order === "colour"
          ? (boxes: readonly ArrangeBox[]) => colourOrder(boxes, palettes)
          : undefined,
      );
    },
    [palettes],
  );

  /// Excalidraw calls `renderTopRightUI` from inside its own render, which runs
  /// on pointer events — so whether the colour sort is on offer is worked out
  /// here rather than by re-reading palettes on the frames of a drag.
  const canSortByColour = useMemo(
    () => hasColourOrder(tidy.referenceIds, palettes),
    [palettes, tidy.referenceIds],
  );

  /// An image brought in from another page — Pinterest, Are.na, a search
  /// result — by drag or by paste. Either way what crosses is a URL and no
  /// bytes: excalidraw reads a dropped URL as an embeddable (so nothing happens
  /// for anything but the handful of providers it knows) and fetches a pasted
  /// one from the browser, where a CDN without CORS headers refuses.
  const { importWebImages, importing, importFailure, dismissFailure } = useBoardWebImages({
    projectId,
    editor,
  });

  /// A crop the director framed on the board, cut out for real. Excalidraw's own
  /// crop is a window onto the whole file — so the part they cut away is still
  /// what the gallery shows, what agent 2 reads a palette off, and what the board
  /// downloads to draw a corner of. Keeping it makes the crop a modified version
  /// of that frame — listed under the frame's properties, never in the gallery —
  /// and repoints the element at it, which changes nothing on screen.
  const { keepCrops, keeping, failedCrops, dismissCropFailure } = useBoardCrops({
    projectId,
    editor,
  });
  const onKeepCrop = useCallback(() => void keepCrops(), [keepCrops]);

  /// Where a pasted image goes. Excalidraw only takes a paste when the pointer
  /// is over its canvas, so this is nearly always the pointer — but a paste that
  /// arrives with the pointer off the board still has to land somewhere the
  /// director can see.
  const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const pastePoint = useCallback((api: ExcalidrawImperativeAPI): ScenePoint => {
    const state = api.getAppState();
    const canvas = {
      offsetLeft: state.offsetLeft,
      offsetTop: state.offsetTop,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      zoom: state.zoom.value,
    };
    return pointer.current
      ? scenePointOfDrop(pointer.current, canvas)
      : scenePointOfViewportCentre({ ...canvas, width: state.width, height: state.height });
  }, []);

  /// Excalidraw listens for `paste` on the document, so a capture-phase handler
  /// on this wrapper gets first refusal — the same interception as the drop's,
  /// and for a related reason: it does handle a pasted image URL, but by
  /// fetching it from the browser, which a CDN that serves no CORS headers
  /// refuses. `onPaste` is not the seam, because excalidraw returns before
  /// calling it whenever the clipboard carries HTML — which a copied image is.
  ///
  /// A paste that is not images — bytes, a scene, a note with a link in it — is
  /// not stopped and reaches excalidraw exactly as before. Pasted image *bytes*
  /// are its to insert and adoption's to store.
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const api = editor.current;
      if (!api || !event.clipboardData || event.clipboardData.files.length > 0) return;
      /// The board's own text editor is a textarea over the canvas; a URL pasted
      /// into it is text being typed, not a photo being placed.
      if (isTextEntry(document.activeElement)) return;

      const urls = pastedImageUrls({
        html: event.clipboardData.getData(WEB_IMAGE_MIMES.html),
        text: event.clipboardData.getData(WEB_IMAGE_MIMES.plain),
      });
      if (urls.length === 0) return;

      event.preventDefault();
      event.stopPropagation();
      void importWebImages(urls, pastePoint(api));
    },
    [importWebImages, pastePoint],
  );

  /// Handled in the capture phase, before excalidraw's own drop handler: it
  /// treats an unrecognised drag as a paste and would either do nothing or
  /// drop the sidebar's thumbnail URL as a link. A drag that is neither a
  /// reference nor a web image is left alone entirely, so files from the
  /// desktop still land the way excalidraw already handles them.
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const api = editor.current;
      if (!api || onBoardOverlay(event)) return;

      const references = decodeReferenceDrag(event.dataTransfer.getData(REFERENCE_DRAG_MIME));
      const webImage = references
        ? null
        : webImageDragUrl({
            html: event.dataTransfer.getData(WEB_IMAGE_MIMES.html),
            uriList: event.dataTransfer.getData(WEB_IMAGE_MIMES.uriList),
            plain: event.dataTransfer.getData(WEB_IMAGE_MIMES.plain),
          });
      if (!references && !webImage) return;

      event.preventDefault();
      event.stopPropagation();

      const state = api.getAppState();
      const at = scenePointOfDrop(event, {
        offsetLeft: state.offsetLeft,
        offsetTop: state.offsetTop,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        zoom: state.zoom.value,
      });

      /// A drag of six references is one drop: they land as a grid centred on
      /// the cursor, so a batch arrives arranged rather than stacked in one
      /// place.
      if (references) placeReferences(api, references, at);
      /// The web image lands where the cursor was, not where it is by the time
      /// the fetch comes back — the director dropped it somewhere on purpose.
      else if (webImage) void importWebImages([webImage], at);
    },
    [importWebImages],
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-xl"
      /// A drop target only exists where something has said it accepts the
      /// drag, and `dragover` is where that is said — every frame of it. The
      /// payload is unreadable here, so a web drag is accepted on its type list
      /// and re-examined for real at the drop; one that turns out not to carry
      /// an image URL is simply not stopped, and reaches excalidraw as before.
      onDragOverCapture={(event) => {
        const types = event.dataTransfer.types as readonly string[];
        if (onBoardOverlay(event)) return;
        if (!carriesReferenceDrag(types) && !carriesWebImageDrag(types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={onDrop}
      onPasteCapture={onPaste}
      /// Two numbers into a ref, so following the pointer costs a paste its
      /// position and costs a drag nothing. Cleared on the way out: a stale
      /// position from before the pointer left is worse than the middle of the
      /// view, which is at least on screen.
      onPointerMoveCapture={(event) => {
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
      }}
      onPointerLeave={() => {
        pointer.current = null;
      }}
    >
      <Excalidraw
        excalidrawAPI={holdEditor}
        theme={theme}
        name={scene.title}
        onChange={onChange}
        onLibraryChange={onLibraryChange}
        initialData={initialData(scene, library)}
        /// Excalidraw's own slot for a host action, beside the library button —
        /// the top-right is where a director already reaches for the things that
        /// act on the whole board, and tidying is one of the few actions used
        /// often enough that a menu would be in the way.
        renderTopRightUI={() => (
          <TidyAction
            scope={tidy.scope}
            units={tidy.units}
            photos={tidy.photos}
            frames={tidy.frames}
            byColour={canSortByColour}
            onTidy={tidyImages}
          />
        )}
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
            /// Excalidraw's export dialog draws from the editor's file map,
            /// which holds each photo at the size the *board* needs and as a URL
            /// only this app can serve — so its PNG upscales thumbnails and its
            /// SVG is a page of broken boxes wherever it is opened. Off, and the
            /// request it would have answered is caught in `onChange` above and
            /// answered by `MoodboardExportPanel` instead.
            saveAsImage: false,
          },
        }}
      >
        <BoardMenu preference={themePreference} onThemeChange={setThemePreference} />
      </Excalidraw>

      <MoodboardInspector
        projectId={projectId}
        selection={selection}
        captionable={captionable}
        croppable={croppable}
        onAddPalette={addPalette}
        onCaption={addCaption}
        onKeepCrop={onKeepCrop}
      />

      <MoodboardExportPanel
        editor={editor}
        title={scene.title}
        open={exporting}
        selectionCount={selectionCount}
        onClose={closeExport}
      />

      {/* Bottom left, below excalidraw's own island on the same side. Stacked
          because both failures can be on screen at once. */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
        <AdoptionFailure count={failedAdoptions} onRetry={retryAdoption} />
        {librarySaveFailed ? (
          <CanvasWarning onAction={retryLibrarySave}>
            Your library could not be saved — changes to it will not survive a reload.
          </CanvasWarning>
        ) : null}
        {importFailure ? (
          <CanvasWarning actionLabel="Dismiss" onAction={dismissFailure}>
            {importFailure}
          </CanvasWarning>
        ) : null}
        {importing > 0 ? (
          <span className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg">
            Saving {importing === 1 ? "an image" : `${importing} images`} from the web…
          </span>
        ) : null}
        {failedCrops > 0 ? (
          <CanvasWarning actionLabel="Dismiss" onAction={dismissCropFailure}>
            {failedCrops === 1 ? "A crop" : `${failedCrops} crops`} could not be saved to this
            project — the {failedCrops === 1 ? "photo is" : "photos are"} still cropped on the
            board.
          </CanvasWarning>
        ) : null}
        {keeping > 0 ? (
          <span className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg">
            Saving {keeping === 1 ? "the crop" : `${keeping} crops`}…
          </span>
        ) : null}
      </div>

      <SaveStatus status={state.status} onRetry={retry} onReload={onReload} />
    </div>
  );
}

/// What a tidy would act on, resolved where the scene is already being walked.
/// The reference ids are what decides whether the colour sort is on offer — a
/// board the analyzer has not answered on yet would lay out exactly as the plain
/// tidy does, and a button that does that is a button that lies about what it is
/// for.
type TidyTargets = {
  scope: ArrangeScope;
  /// What the layout moves: a photo, or the group one is in. A board of six
  /// photos where two are grouped with their captions has four.
  units: number;
  photos: number;
  referenceIds: string[];
  /// How many frames hold some of them, so the button can say that each section
  /// is filled in place rather than leaving the director to find out by pressing
  /// it on a board they have divided up.
  frames: number;
};

/// Says what it will act on before it is pressed, because a tidy moves and
/// resizes every photo it touches: two or more selected photos is the director
/// aiming it, anything else is the whole board. Nothing to tidy is a board with
/// fewer than two photos on it, and there the button is not offered at all
/// rather than sitting there doing nothing.
///
/// The two orders are one control rather than two buttons: they are the same
/// action — the same layout, the same undo step, the same photos — differing
/// only in what fills the grid first, and separating them would read as two
/// unrelated things to learn.
function TidyAction({
  scope,
  units,
  photos,
  frames,
  byColour,
  onTidy,
}: {
  scope: ArrangeScope;
  units: number;
  photos: number;
  frames: number;
  byColour: boolean;
  onTidy: (order?: "colour") => void;
}) {
  /// Offered on units rather than on photos: a board that is one group of five
  /// has nothing to rearrange, and a button that lays a single block back down
  /// where it already was is a button that does nothing.
  if (units < 2) return null;

  const what = scope === "selection" ? `${photos} selected` : `${photos} images`;
  /// A frame is a section the director drew, so the photos in one are laid out
  /// inside it and stay in it — said here because the alternative reading, that
  /// a tidy sweeps the whole board into one grid, is what the button does on a
  /// board with no frames on it.
  const sections =
    frames > 0 ? `, filling ${frames === 1 ? "the frame" : `each of the ${frames} frames`}` : "";
  /// Excalidraw's own island variables rather than the app's: the board has its
  /// own theme control, so a button painted in the page's colours would be the
  /// one light thing on a dark canvas.
  const island =
    "h-9 px-2.5 text-xs text-[var(--text-primary-color)] hover:bg-[var(--button-hover-bg)]";

  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-[var(--default-border-color)] bg-[var(--island-bg-color)] shadow-sm">
      <button
        type="button"
        onClick={() => onTidy()}
        title={`Lay ${what} out in rows of one height, keeping each photo's shape${sections}`}
        className={island}
      >
        Tidy {what}
      </button>
      {byColour ? (
        <button
          type="button"
          onClick={() => onTidy("colour")}
          title={`Lay ${what} out in rows, grouped by the colour of each photo${sections}`}
          className={`${island} border-l border-[var(--default-border-color)]`}
        >
          by colour
        </button>
      ) : null}
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
///
/// `SaveAsImage` is kept even though `UIOptions` switches the action off —
/// `DefaultItems` rendered here bypass those gates, and all the item does is ask
/// for the export dialog, which `MoodboardCanvas` answers with the board's own.
/// So the menu entry, its ⌘⇧E shortcut and the command palette's export all
/// arrive at one place.
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
  actionLabel = "Retry",
  onAction,
}: {
  children: React.ReactNode;
  actionLabel?: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white shadow-lg">
      <span>{children}</span>
      <button type="button" onClick={onAction} className="font-medium underline underline-offset-2">
        {actionLabel}
      </button>
    </div>
  );
}

function AdoptionFailure({ count, onRetry }: { count: number; onRetry: () => void }) {
  if (count === 0) return null;

  return (
    <CanvasWarning onAction={onRetry}>
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
