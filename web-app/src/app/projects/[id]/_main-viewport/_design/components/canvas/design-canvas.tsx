"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { galleryAnalysisIndex } from "@/lib/analysis/gallery-analysis";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/scene/excalidraw-assets";
import { ensureGoogleFontsFor } from "@/lib/scene/excalidraw-google-fonts";
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
  sameSelection,
  selectedElementIds,
  selectionSignature,
  type BoardSelection,
} from "@/lib/canvas/moodboard-selection";
import { referenceIdFromFileId } from "@/lib/scene/moodboard-scene";
import { arrangeTargets, type ArrangeBox } from "@/lib/canvas/moodboard-arrange";
import { captionablePhotos } from "@/lib/canvas/moodboard-caption";
import { croppablePhotos, croppingElementId } from "@/lib/canvas/moodboard-crop";
import { colourOrder, hasColourOrder, type BoardPalettes } from "@/lib/canvas/moodboard-order";
import { pageTargets, type PageTargets } from "@/lib/pages/page-mark";
import { exportedPageName } from "@/lib/scene/moodboard-export";
import {
  autosaveDelay,
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
} from "@/lib/scene/moodboard-autosave";
import { clearBoardPlacement, publishBoardPlacement } from "../../../../_reference/stores/use-board-placement-store";
import { useBoardImageAdoption } from "../../hooks/use-board-image-adoption";
import { useBoardLibrary } from "../../hooks/use-board-library";
import { useBoardRender } from "../../hooks/use-board-render";
import { usePagePicture } from "../../hooks/use-page-picture";
import { tidyBoard } from "../../utils/board-arrange";
import { addBoardPage, markSelectionAsPages } from "../../utils/board-page";
import { paintBoardPage } from "../../utils/board-background";
import { captionSelectedPhotos } from "../../utils/board-caption";
import { useBoardCrops } from "../../hooks/use-board-crops";
import { placePalette } from "../../utils/board-palette";
import { placeReferences } from "../../utils/board-references";
import { useBoardWebImages } from "../../hooks/use-board-web-images";
import { DesignInspector } from "./design-inspector";
import { ExportPanel } from "./export-panel";
import { VibesForm } from "../../_vibes/components/vibes-form";
import { openBoard } from "../../../../_workspace/stores/use-open-board-store";
import { useBoardHeld } from "../../../../_workspace/stores/use-board-hold-store";
import { AdoptionFailure } from "./adoption-failure";
import { BoardControls } from "./board-controls";
import { BoardMenu } from "./board-menu";
import { CanvasWarning } from "./canvas-warning";
import { PageAction } from "./page-action";
import { SaveStatus } from "./save-status";
import { VibesAction } from "./vibes-action";
import type { ThemePreference, TidyTargets } from "../../types";
import type { MoodboardLibrary, MoodboardScene } from "@/server/api/routers/moodboard";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
/// The editor's own bottom row, switched off in favour of `BoardControls`
/// (`excalidraw-chrome.css`).
import "./excalidraw-chrome.css";

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
    /// The stored scroll is the view the user left; fitting to content
    /// would silently move it on every reopen.
    scrollToContent: false,
  };
}

export function DesignCanvas({
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
  /// than the one the user is looking at.
  saveGateRef?: React.RefObject<(() => Promise<void>) | null>;
}) {
  const client = useTRPCClient();
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);

  /// Whether an agent is rewriting this board right now (`board-hold.ts`). Read
  /// off `scene.id` rather than taken as a prop: the board id is already here —
  /// `publishBoardPlacement` is handed it — and threading a boolean down from
  /// the chat column would cross three components that know nothing about turns.
  /// `BoardScene` reads its reload count the same way.
  ///
  /// Everything it gates is one sentence: while an agent holds the board, the
  /// user may look and pan but may not write. The scrim says so, view mode takes
  /// the editor's own tools away, and the rest of this file takes away ours.
  const held = useBoardHeld(scene.id);
  /// The same fact where a callback can read it without being rebuilt: `collect`
  /// runs from a timer and from unmount, and a `held` in its dependency list
  /// would re-arm every debounce the moment an agent picked the board up. The
  /// effect is soon enough — every gate below it runs from a pointer event or a
  /// timer, both of which are after the paint that took the hold.
  const heldRef = useRef(held);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  /// The ref is what the handlers read; this is what tells a render or a redraw
  /// that there is something to read. Stable and idempotent because excalidraw
  /// re-runs the callback whenever its identity changes, which for an inline one
  /// is every render.
  ///
  /// The editor itself and not a flag, because the bottom row is handed it as a
  /// value: a ref read during a render is a render that does not know when to
  /// run again, and one closed over by a memo is one the compiler refuses.
  const [editorApi, setEditorApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const editorReady = editorApi !== null;
  const holdEditor = useCallback((api: ExcalidrawImperativeAPI) => {
    editor.current = api;
    setEditorApi(api);
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
    /// Deliberately not cancelled on unmount: the user has closed the board
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

  /// The same colours as a list, which is the shape "Let's Vibes" seeds its
  /// palette from (§IX.1): the board asks which photo a colour belongs to and
  /// the form only asks what colour the project is.
  const projectPalettes = useMemo(() => [...palettes.values()], [palettes]);

  /// The form is over the canvas rather than beside it: it makes a *new* board,
  /// so the one on screen is only where the press came from.
  const [vibing, setVibing] = useState(false);

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
    pages: 0,
  });
  const noteTidy = useCallback((elements: unknown, appState: unknown) => {
    const { scope, boxes, groups } = arrangeTargets(elements, appState);
    /// Which references are on the board is what decides whether sorting by
    /// colour has anything to say, and this is the walk that already knows.
    const referenceIds = boxes
      .map((box) => box.referenceId)
      .filter((id): id is string => typeof id === "string");
    const frames = groups.filter((group) => group.frame && !group.page).length;
    const pages = groups.filter((group) => group.page).length;
    /// Two counts, because a grouped photo is one thing to move and still a
    /// photo: the button is offered on how many *units* there are to rearrange
    /// and says how many *images* that comes to.
    const photos = boxes.reduce((total, box) => total + (box.photos ?? 1), 0);
    setTidy((current) =>
      current.scope === scope &&
      current.units === boxes.length &&
      current.photos === photos &&
      current.frames === frames &&
      current.pages === pages &&
      current.referenceIds.join() === referenceIds.join()
        ? current
        : { scope, units: boxes.length, photos, referenceIds, frames, pages },
    );
  }, []);

  /// What the board's page controls would act on (§V.1–2): how many pages it
  /// already has, which one a new page would be measured from, and whether the
  /// selection is a frame that could become a page. Derived on the same two
  /// beats as the tidy targets — the selection changing and the scene settling —
  /// because both answers move with both.
  ///
  /// Seeded from the board as opened, not from an empty board: this component is
  /// keyed on the board, and a control that says "page this board" until the
  /// user happens to touch something is the wrong sentence about a spread.
  const [pages, setPages] = useState<PageTargets>(() => pageTargets(scene.elements, []));
  const notePages = useCallback((elements: unknown, appState: unknown) => {
    const next = pageTargets(
      Array.isArray(elements) ? elements : [],
      selectedElementIds(appState),
    );
    setPages((current) =>
      current.pages === next.pages &&
      current.sourcePageId === next.sourcePageId &&
      current.promotable === next.promotable
        ? current
        : next,
    );
  }, []);

  /// Selection is not part of the saved document — it is what the inspector is
  /// about. Resolving it walks the element array, and `onChange` fires on every
  /// frame of a drag with the selection unchanged, so the signature is compared
  /// first and the walk only happens when the user selects something else.
  const selectionKey = useRef("");
  const [selection, setSelection] = useState<BoardSelection>({ kind: "none" });

  const collect = useCallback(() => {
    collectTimer.current = null;
    dirtySince.current = null;
    const pending = latest.current;
    if (!pending) return;
    apply((current) => sceneEdited(current, sceneSnapshot(pending.elements, pending.appState)));
    noteTidy(pending.elements, pending.appState);
    notePages(pending.elements, pending.appState);
    /// The selection again, on the settle beat as well as on the beat it
    /// changes: what the panel says about a page is read off the scene — the
    /// colour it stands on, the photographs on it — and painting a page moves
    /// neither the selection nor its signature. Guarded, so a scene that
    /// settled without touching the selected page costs no render.
    setSelection((current) => {
      const next = boardSelection(pending.elements, pending.appState);
      return sameSelection(current, next) ? current : next;
    });
    /// Which photos are on the board, for the strip they were dragged from. On
    /// the quiet period rather than on `onChange`: the answer only changes when a
    /// photo arrives or leaves, and the walk must not be on the frames of a drag.
    publishBoardPlacement(scene.id, pending.elements);
    /// Nothing of ours is written while an agent holds the board. Gated here as
    /// well as at the timer below because the unmount effect calls `collect`
    /// directly: without this, closing a board mid-hold would write the scene as
    /// the editor last saw it over the page agent 8 has since laid out. The rest
    /// of the collect still runs — the panels above the canvas keep saying what
    /// is selected while the user watches.
    if (heldRef.current) return;
    runSave();
    void adopt();
  }, [adopt, apply, notePages, noteTidy, runSave, scene.id]);

  /// The board as opened, before anything has been edited — otherwise the strip
  /// says nothing is placed until the user happens to move something.
  useEffect(() => {
    publishBoardPlacement(scene.id, scene.elements);
    /// No board open is a different answer from an empty board: the strip stops
    /// offering the question rather than marking every reference unused.
    return clearBoardPlacement;
  }, [scene.id, scene.elements]);

  /// Any Google faces the scene rides (`customData.font`), registered under
  /// their excalidraw integers and fetched from Google's CDN
  /// (`excalidraw-google-fonts.ts`). Keyed on the scene, so a board update that
  /// lands a new face registers it too; the nudge afterwards is because
  /// excalidraw redraws for its own fonts loading and not for these.
  useEffect(() => {
    let stale = false;
    void ensureGoogleFontsFor(scene.elements).then((loaded) => {
      if (loaded && !stale) editor.current?.updateScene({});
    });
    return () => {
      stale = true;
    };
  }, [scene.elements]);

  const [selectionCount, setSelectionCount] = useState(0);
  const [exportPageName, setExportPageName] = useState<string | null>(null);
  const [captionable, setCaptionable] = useState(0);
  const [croppable, setCroppable] = useState(0);

  /// Every route that asks excalidraw for an image export — the menu item, ⌘⇧E,
  /// the command palette — does the one thing: it sets `openDialog` to
  /// `imageExport`. So that is what is intercepted, rather than a button, and
  /// the board has one export however the user reached for it. Excalidraw's
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
      /// would leave the offer to keep the crop hidden until the user clicked
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
        /// And what that export would be a *picture of*: a page selected on its
        /// own comes out as the page's own rectangle (§V), which the panel says
        /// rather than offering it as "the 1 selected".
        setExportPageName(exportedPageName(Array.isArray(elements) ? elements : [], appState));
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
        /// Selecting a page is how a new one is aimed and selecting a frame is
        /// the whole of what promoting one acts on, so this follows the
        /// selection for the same reason.
        notePages(elements, appState);
      }

      /// View mode still fires `onChange` for appState — a scroll, a zoom — and
      /// arming the save on one of those would land a write in the middle of an
      /// agent's, which the revision guard answers with a conflict the user did
      /// nothing to cause.
      if (heldRef.current) return;

      const now = Date.now();
      dirtySince.current ??= now;
      if (collectTimer.current) clearTimeout(collectTimer.current);
      collectTimer.current = setTimeout(collect, autosaveDelay(dirtySince.current, now));
    },
    [collect, notePages, noteTidy],
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

  /// The board's page list, as the chat's picker reads it (§V.5). That list is
  /// built from the *stored* scene, so a page the user has just drawn is not
  /// on it until the write lands — and the moment they are most likely to attach
  /// a page is the moment after they made one. Waiting on the same gate the panel
  /// waits on is what makes the picker's list the board on screen rather than the
  /// board as of half a minute ago.
  const queryClient = useQueryClient();
  const pagesChanged = useCallback(() => {
    void flushSaves().then(() =>
      queryClient.invalidateQueries({ queryKey: trpc.moodboard.pages.queryKey({ id: scene.id }) }),
    );
  }, [flushSaves, queryClient, scene.id, trpc]);

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
  /// preview is: it is taken when the user presses send, on the board they
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

  /// A page, drawn where §V.2 says the next one goes. The user's own half of
  /// the page entity: until now every page on every board was made by an agent —
  /// a compose, or `add_page` — so a board they arranged themselves could not be
  /// read, composed or attached a page at a time without being rebuilt.
  ///
  /// It lands as an ordinary frame, so from the moment it exists it is the
  /// editor's to move, resize, rename and undo, and the autosave's to store.
  const addPage = useCallback(() => {
    if (!editor.current) return;
    addBoardPage(editor.current, scene.defaultPage);
    pagesChanged();
  }, [pagesChanged, scene.defaultPage]);

  /// The frame the user already drew, promoted in place (§V.1) — nothing
  /// moves, nothing is resized, and the section keeps the name they gave it.
  const markAsPage = useCallback(() => {
    if (!editor.current) return;
    if (markSelectionAsPages(editor.current) > 0) pagesChanged();
  }, [pagesChanged]);

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

  /// A crop the user framed on the board, cut out for real. Excalidraw's own
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

  /// The colour a page is printed on (§XI.4). It lands as the same locked
  /// rectangle `set_page_background` writes, so a page the user paints and a
  /// page an agent paints are one element made one way — and from the moment it
  /// exists it is the autosave's to store and ⌘Z's to undo.
  const setPageBackground = useCallback(
    (colour: string | null, options?: { preview?: boolean }) => {
      if (!editor.current || selection.kind !== "page") return;
      paintBoardPage(editor.current, selection.pageId, colour, options);
    },
    [selection],
  );

  /// Where a pasted image goes. Excalidraw only takes a paste when the pointer
  /// is over its canvas, so this is nearly always the pointer — but a paste that
  /// arrives with the pointer off the board still has to land somewhere the
  /// user can see.
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
      if (!api || heldRef.current || !event.clipboardData || event.clipboardData.files.length > 0)
        return;
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
      if (!api || heldRef.current || onBoardOverlay(event)) return;

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
      /// the fetch comes back — the user dropped it somewhere on purpose.
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
        /// Nothing is accepted while an agent holds the board — and refusing it
        /// here rather than at the drop is what stops the cursor offering. This
        /// matters past our own handlers: whatever they decline falls through to
        /// excalidraw, and a file dragged off the desktop is one of the paths
        /// view mode does not cover.
        if (held || onBoardOverlay(event)) return;
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
        /// The editor's own half of the hold. View mode leaves pan and zoom
        /// working, which is the point — the user watches the page being built
        /// rather than being shut out of it — and takes away every tool, every
        /// handle and the keyboard with them.
        viewModeEnabled={held}
        /// Excalidraw's own slot for a host action, beside the library button —
        /// the top-right is where a user already reaches for the things that
        /// act on the whole board. It holds the page controls alone now: tidy
        /// left for `BoardMenu` (`canvas.md` §VI) because the slot holds one
        /// control, and getting a page is the thing done often enough that a
        /// menu would be in the way.
        ///
        /// Ours goes with it: view mode stops excalidraw's tools and nothing
        /// else, so every control below that writes to the board is withheld
        /// while it is held.
        renderTopRightUI={() =>
          held ? null : (
            <>
              <PageAction targets={pages} onAddPage={addPage} onMarkAsPage={markAsPage} />
              <VibesAction onOpen={() => setVibing(true)} />
            </>
          )
        }
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
            /// answered by `ExportPanel` instead.
            saveAsImage: false,
          },
        }}
      >
        {/* The menu holds `TidyItems` and excalidraw's own `ClearCanvas` and
            `ChangeCanvasBackground`, all three of which write. The theme control
            is the only entry that does not, and it is not worth a second menu. */}
        {held ? null : (
          <BoardMenu
            preference={themePreference}
            onThemeChange={setThemePreference}
            tidy={tidy}
            byColour={canSortByColour}
            onTidy={tidyImages}
          />
        )}
      </Excalidraw>

      {/* The row the editor's own footer used to hold, drawn once the editor is
          there to be driven. Outside `<Excalidraw>` so it is not re-parented by
          the editor's layout, and inside this box so it is positioned against
          the board rather than the column. */}
      {editorApi ? <BoardControls api={editorApi} held={held} /> : null}

      {vibing ? (
        <VibesForm
          projectId={projectId}
          palettes={projectPalettes}
          onClose={() => setVibing(false)}
          /// The board the form made is the board to be looking at, and the
          /// panel in the other column is what opens boards — the same request
          /// channel the assistant uses when it composes one (§V.5).
          onStarted={({ boardId }) => {
            setVibing(false);
            openBoard(boardId);
          }}
        />
      ) : null}

      <DesignInspector
        projectId={projectId}
        held={held}
        selection={selection}
        captionable={captionable}
        croppable={croppable}
        onAddPalette={addPalette}
        onCaption={addCaption}
        onKeepCrop={onKeepCrop}
        onPageBackground={setPageBackground}
      />

      <ExportPanel
        editor={editor}
        title={scene.title}
        open={exporting}
        selectionCount={selectionCount}
        pageName={exportPageName}
        onClose={closeExport}
      />

      {/* Bottom left, below excalidraw's own island on the same side. Stacked
          because both failures can be on screen at once. */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
        <AdoptionFailure count={failedAdoptions} onRetry={held ? null : retryAdoption} />
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

      {/* What the read-only board is read-only *for*. Non-interactive, so
          panning and zooming still reach the canvas underneath — the whole
          reason view mode was chosen over an overlay that swallows the pointer.
          `role="status"` with a polite live region, so it is announced once when
          the agent picks the board up rather than on every repaint. */}
      {held ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
        >
          <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg">
            An agent is editing this board
          </span>
        </div>
      ) : null}
    </div>
  );
}
