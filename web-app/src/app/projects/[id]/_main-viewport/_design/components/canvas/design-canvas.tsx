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
import { openPanels, openSidebar } from "../../../../_workspace/stores/use-sidebar-store";
import { setSidebarTab } from "../../../../_workspace/stores/use-sidebar-tab-store";
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
import "./excalidraw-chrome.css";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;

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

function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

function onBoardOverlay(event: React.DragEvent) {
  return event.target instanceof Element && event.target.closest("[data-board-overlay]") !== null;
}

function isConflict(error: unknown) {
  return error instanceof TRPCClientError && error.data?.code === "CONFLICT";
}

function initialData(scene: MoodboardScene, library: MoodboardLibrary): ExcalidrawInitialDataState {
  return {
    elements: scene.elements as unknown as ExcalidrawInitialDataState["elements"],
    appState: scene.appState as ExcalidrawInitialDataState["appState"],
    files: Object.fromEntries(
      [...scene.files, ...library.files].map((file) => [file.id, file]),
    ) as ExcalidrawInitialDataState["files"],
    libraryItems: library.items as unknown as ExcalidrawInitialDataState["libraryItems"],
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
  saveGateRef?: React.RefObject<(() => Promise<void>) | null>;
}) {
  const client = useTRPCClient();
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);

  const held = useBoardHeld(scene.id);
  const heldRef = useRef(held);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  const [editorApi, setEditorApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const editorReady = editorApi !== null;
  const holdEditor = useCallback((api: ExcalidrawImperativeAPI) => {
    editor.current = api;
    setEditorApi(api);
  }, []);

  const systemTheme = useTheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const theme = themePreference === "system" ? systemTheme : themePreference;

  const [initial] = useState(() =>
    initialAutosaveState(scene.revision, scene.elements, scene.appState),
  );
  const stateRef = useRef(initial);
  const [state, setState] = useState(initial);

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

  const latest = useRef<{ elements: unknown; appState: unknown } | null>(null);
  const dirtySince = useRef<number | null>(null);
  const collectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const saveAgain = useRef<() => void>(undefined);

  const runSave = useCallback(() => {
    const current = stateRef.current;
    if (saving.current || current.status === "error" || !readyToSave(current)) return;
    const outgoing = apply(saveStarted).inFlight;
    if (!outgoing) return;

    saving.current = true;
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

  const knownReferenceIds = useMemo(
    () =>
      [...scene.files, ...library.files]
        .map((file) => referenceIdFromFileId(file.id))
        .filter((id): id is string => id !== null),
    [library.files, scene.files],
  );

  const { adopt, failedAdoptions, retryAdoption } = useBoardImageAdoption({
    projectId,
    editor,
    knownReferenceIds,
  });

  const { onLibraryChange, librarySaveFailed, retryLibrarySave } = useBoardLibrary({
    projectId,
    items: library.items,
  });

  useBoardRender({
    boardId: scene.id,
    projectId,
    editor,
    editorReady,
    status: state.status,
    revision: state.revision,
    renderedRevision: scene.renderedRevision,
  });

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

  const projectPalettes = useMemo(() => [...palettes.values()], [palettes]);

  const [vibing, setVibing] = useState(false);

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
    const referenceIds = boxes
      .map((box) => box.referenceId)
      .filter((id): id is string => typeof id === "string");
    const frames = groups.filter((group) => group.frame && !group.page).length;
    const pages = groups.filter((group) => group.page).length;
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
    setSelection((current) => {
      const next = boardSelection(pending.elements, pending.appState);
      return sameSelection(current, next) ? current : next;
    });
    publishBoardPlacement(scene.id, pending.elements);
    if (heldRef.current) return;
    runSave();
    void adopt();
  }, [adopt, apply, notePages, noteTidy, runSave, scene.id]);

  useEffect(() => {
    publishBoardPlacement(scene.id, scene.elements);
    return clearBoardPlacement;
  }, [scene.id, scene.elements]);

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

  const [exporting, setExporting] = useState(false);
  const closeExport = useCallback(() => setExporting(false), []);

  const onChange = useCallback(
    (elements: unknown, appState: unknown) => {
      latest.current = { elements, appState };

      if ((appState as { openDialog?: { name?: string } | null }).openDialog?.name === "imageExport") {
        editor.current?.updateScene({
          appState: { openDialog: null },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        setExporting(true);
      }

      const key = `${selectionSignature(appState)} ${croppingElementId(appState)}`;
      if (key !== selectionKey.current) {
        selectionKey.current = key;
        setSelection(boardSelection(elements, appState));
        setSelectionCount(selectedElementIds(appState).length);
        setExportPageName(exportedPageName(Array.isArray(elements) ? elements : [], appState));
        setCaptionable(captionablePhotos(elements, appState));
        setCroppable(croppablePhotos(elements, appState).length);
        noteTidy(elements, appState);
        notePages(elements, appState);
      }

      if (heldRef.current) return;

      const now = Date.now();
      dirtySince.current ??= now;
      if (collectTimer.current) clearTimeout(collectTimer.current);
      collectTimer.current = setTimeout(collect, autosaveDelay(dirtySince.current, now));
    },
    [collect, notePages, noteTidy],
  );

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

  const flushSaves = useCallback(() => {
    if (collectTimer.current) {
      clearTimeout(collectTimer.current);
      collect();
    }
    if (!isWriting(stateRef.current.status)) return Promise.resolve();
    return new Promise<void>((resolve) => settled.current.push(resolve));
  }, [collect]);

  const queryClient = useQueryClient();
  const pagesChanged = useCallback(() => {
    void flushSaves().then(() =>
      queryClient.invalidateQueries({ queryKey: trpc.moodboard.pages.queryKey({ id: scene.id }) }),
    );
  }, [flushSaves, queryClient, scene.id, trpc]);

  useEffect(() => {
    if (!saveGateRef) return;
    saveGateRef.current = flushSaves;
    return () => {
      saveGateRef.current = null;
      const waiting = settled.current;
      settled.current = [];
      for (const wake of waiting) wake();
    };
  }, [flushSaves, saveGateRef]);

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

  const addPalette = useCallback((colors: string[]) => {
    if (editor.current) placePalette(editor.current, colors);
  }, []);

  const addCaption = useCallback((text: string) => {
    if (editor.current) captionSelectedPhotos(editor.current, text);
  }, []);

  const addPage = useCallback(() => {
    if (!editor.current) return;
    addBoardPage(editor.current, scene.defaultPage);
    pagesChanged();
  }, [pagesChanged, scene.defaultPage]);

  const markAsPage = useCallback(() => {
    if (!editor.current) return;
    if (markSelectionAsPages(editor.current) > 0) pagesChanged();
  }, [pagesChanged]);

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

  const canSortByColour = useMemo(
    () => hasColourOrder(tidy.referenceIds, palettes),
    [palettes, tidy.referenceIds],
  );

  const { importWebImages, importing, importFailure, dismissFailure } = useBoardWebImages({
    projectId,
    editor,
  });

  const { keepCrops, keeping, failedCrops, dismissCropFailure } = useBoardCrops({
    projectId,
    editor,
  });
  const onKeepCrop = useCallback(() => void keepCrops(), [keepCrops]);

  const setPageBackground = useCallback(
    (colour: string | null, options?: { preview?: boolean }) => {
      if (!editor.current || selection.kind !== "page") return;
      paintBoardPage(editor.current, selection.pageId, colour, options);
    },
    [selection],
  );

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

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const api = editor.current;
      if (!api || heldRef.current || !event.clipboardData || event.clipboardData.files.length > 0)
        return;
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

      if (references) placeReferences(api, references, at);
      else if (webImage) void importWebImages([webImage], at);
    },
    [importWebImages],
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-xl"
      onDragOverCapture={(event) => {
        const types = event.dataTransfer.types as readonly string[];
        if (held || onBoardOverlay(event)) return;
        if (!carriesReferenceDrag(types) && !carriesWebImageDrag(types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={onDrop}
      onPasteCapture={onPaste}
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
        viewModeEnabled={held}
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
            saveToActiveFile: false,
            loadScene: false,
            saveAsImage: false,
          },
        }}
      >
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

      {editorApi ? <BoardControls api={editorApi} held={held} /> : null}

      {vibing ? (
        <VibesForm
          projectId={projectId}
          palettes={projectPalettes}
          onClose={() => setVibing(false)}
          onStarted={({ boardId }) => {
            setVibing(false);
            openBoard(boardId);
            openSidebar();
            openPanels();
            setSidebarTab("vibes");
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
