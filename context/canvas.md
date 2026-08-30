# CANVAS

The excalidraw canvas as it stands: what a board is made of, what the user can
do on it, and what reads and writes the same scene from outside the editor.
This is the current-state reference; the decision history behind each feature
is the moodboard spec (`moodboard.md`), and the page entity's design rationale
is tech-spec §V. Where the two disagree with the code, the code won after those
were written — this document is the one to trust.

## I. Architecture

Three layers, strictly separated:

- **App layer** — `web-app/src/app/projects/[id]/`. React hooks and components
  that hold the excalidraw editor (`MoodboardCanvas` in `moodboard-canvas.tsx`,
  mounted by `MoodboardPanel` behind `next/dynamic`, ssr off — the editor is
  1.5 MB and reaches for `window` on import). Each feature is one `board-*.ts`
  hook (`board-arrange`, `board-crop`, `board-page`, …) that reads the editor's
  API and calls into the lib layer.
- **Lib layer** — `web-app/src/lib/{canvas,scene,boards,layout,pages}/`. Pure
  modules: no DOM, no React, no fetch, no excalidraw import. Every one is
  paired with a `.test.mts` runnable under plain node. All geometry, layout,
  ordering and persistence rules live here so the browser and the server run
  the same code.
- **Server layer** — `moodboard` tRPC router
  (`src/server/api/routers/moodboard.ts`), `src/server/moodboards/`
  (render signing, scene-write helper), and the agent toolset
  (`src/server/agents/orchestrator/tools.ts`) — the second writer of the same scene.

Excalidraw is embedded, not reimplemented: selection, transforms, undo,
z-order, shapes, styling all come free (moodboard spec §I). What is ours is
everything that knows an image is a *reference*: persistence, drop/import,
adoption, the inspector, tidy, pages, export, and the agent seam.

## II. The scene

Defined in `src/lib/scene/moodboard-scene.ts`.

- A board row stores two JSON columns: an **ordered element array** (array
  order is z-order) and an **allowlisted appState slice**. Nothing else about
  the drawing is stored anywhere — `MoodboardTile`, `Crop` and `Deck` are
  vestigial Prisma models no application code touches.
- `SceneElement` is deliberately open (`{ id, type, isDeleted?, fileId?,
  [key: string]: unknown }`): excalidraw adds fields every release, and a
  per-field schema would strip user work on round-trip.
- **Image bytes are never in the row.** An image element's `fileId` is
  `ref:<Reference.id>` (`REFERENCE_FILE_PREFIX`). The load rebuilds
  excalidraw's files map from the project's references: `dataURL` is the app's
  own streaming path `/api/references/<id>/image?stream=1[&variant=thumb]` —
  same-origin, so an export canvas is readable (a cross-origin image taints
  it). A `fileId` naming a deleted reference simply has no entry and draws as
  excalidraw's placeholder. Elements this app writes always carry
  `status: "saved"`, never `"pending"`.
- **Which copy is served** (`moodboard-resolution.ts`): decided per reference
  from element geometry at `BOARD_IMAGE_PIXEL_RATIO = 2` device pixels per
  scene unit. Longest drawn edge ≤ 640 (`THUMBNAIL_MAX_EDGE`) → the 640px
  thumbnail; larger, or a cropped element (sized by the *region shown*, not
  the element) → the original. One variant per reference, coarsest wins,
  because excalidraw's files map and decoded-image cache are add-only —
  resolution is fixed per mount.
- **Sanitisation runs both directions** — on save *and* on rows read back
  (an older build or an agent is input too):
  - `persistableElements`: drops non-objects, `isDeleted: true` tombstones
    (session state for undo, not document state), missing `id`/`type`,
    duplicate ids. Order preserved verbatim.
  - `persistedAppState`: allowlist of ~20 keys (canvas background, grid,
    snap, zen, `currentItem*` tool defaults), scalars only. Selection and
    open dialogs are deliberately not persisted. Viewport (`scrollX/Y`,
    `zoom.value` clamped 0.1–30) is stored so a board reopens where it was
    left.
- **Limits, refused never truncated**: 5000 elements
  (`MOODBOARD_ELEMENT_LIMIT`), 2 MB serialized
  (`MOODBOARD_SCENE_BYTE_LIMIT`) → `PAYLOAD_TOO_LARGE`.

### Frames: sections and pages

- A plain excalidraw frame is a **section** (moodboard spec §II.9) — a named
  rectangle owning members by `frameId`. `magicframe` counts as a frame
  everywhere (`FRAME_TYPES`) so a pasted scene never reads one as a photo.
- A `frame` (never `magicframe`) carrying `customData.page` is a **page**
  (tech-spec §V, `src/lib/pages/board-pages.ts`). The marker stores only the
  creation preset; size, name, position and the size label are derived from
  the rectangle on every read (`Custom` when it matches no preset within
  1px). Presets: `LANDSCAPE_HD` 1920×1080, `PORTRAIT_HD` 1080×1920, `SQUARE`
  2048×2048.
- **Ownership is asymmetric on purpose**: sections own by `frameId`; page
  membership is geometric — the element's centre inside the page rect,
  topmost page wins (`pageHolding`), never `frameId`, which can name a frame
  the element no longer sits in. Sections take precedence over pages when an
  element joins something (`frameJoining`: full containment for sections,
  centre for pages). Pages never nest and never own a section or its photos —
  excalidraw does not nest frames.
- The one place `frameId` is written *toward* geometry: `arrangeOwners` after
  a tidy, and `pageExportElements` in a throwaway copy for the exporter (it
  only renders a frame's children).

## III. Persistence and autosave

`src/lib/scene/moodboard-autosave.ts` + the `moodboard.save` mutation.

- `onChange` fires per frame of a drag, so it only parks the editor's arrays
  in a ref. The scene is walked once per quiet period: debounce 900 ms,
  forced at 6 s from first going dirty (`autosaveDelay`). The snapshot runs
  the same filters the server runs, so a change the server would discard
  never costs a request.
- State machine `idle | pending | saving | error | conflict`. A failed save
  parks in `error` with a retry button (no hot loop against a down server).
  **Conflict is terminal until reload**: the server refused on `revision`,
  another tab holds the truth, and the only way out is remounting the editor
  with the stored scene (`onReload`). Unload with unsaved work warns via
  `beforeunload`; unmount mid-debounce flushes rather than cancels — the
  write outlives the component on purpose.
- **Revision guard**: every scene write (autosave and every agent tool alike)
  is `updateMany({ where: { id, revision: <as read> }, data:
  { ...sceneWrite(elements), revision: { increment: 1 },
  renderRevision: null } })`; `count === 0` → CONFLICT. `sceneWrite`
  (`src/server/moodboards/scene-write.ts`) derives `pageCount`/`pageNames`
  from the elements in the same statement so they can never drift. A
  title-only rename bumps nothing and keeps the render.
- **Save gate** (`saveGateRef`/`flushSaves`): "the server now holds what is
  on screen". Cuts the debounce short and resolves when the write lands (or
  settles as error/conflict — a caller is told the truth rather than hung).
  Waited on by board duplication, the pages picker invalidation, and the page
  picture.
- The scene and library queries are fetched once with `staleTime: Infinity`
  and never refetched: excalidraw owns the document from mount, and a
  background refetch would silently revert edits.

## IV. Getting images onto the board

Four routes, all ending at a `ref:` element (moodboard spec §II.3):

1. **Sidebar drag** (`src/lib/canvas/moodboard-drop.ts`). Payload MIME
   `application/x-director-reference` — ids and pixel sizes, never bytes, so
   desktop-file drags fall through to excalidraw. Handled capture-phase on
   the canvas wrapper (first refusal before excalidraw's own drop), refused
   over floating panels (`data-board-overlay`). Every reference lands at
   longest edge 320, centred on the cursor; a batch lands as a
   near-square grid (cell 320+24), short last row centred, all selected, one
   undo step. Modifier-click in the strip builds the set; unusable entries
   are skipped, duplicates deduped. A drop lands in the frame/page it falls
   in (full containment for sections; centre for pages).
2. **Web images** — dragged or pasted from another site
   (`src/lib/intake/web-image-import.ts`, `useBoardWebImages`). What crosses
   is a URL; the fetch is the server's (`reference.importFromUrl`, SSRF-
   guarded per redirect hop, byte-capped, content-hash deduped) and the
   result is an ordinary project `Reference` placed at the drop point.
   Paste is intercepted capture-phase (excalidraw returns before `onPaste`
   when the clipboard carries HTML); only images-only fragments and
   image-URL-only text are taken — anything else still reaches excalidraw.
   Pasted image *bytes* are excalidraw's to insert and adoption's to store.
3. **Adoption** (`useBoardImageAdoption`, `moodboard-images.ts`). Any image
   excalidraw landed itself (paste, desktop file, toolbar) holds bytes only
   in the in-memory files map — it would reload as an empty box. On the
   autosave's quiet period every such file is uploaded into the project
   (same path as the gallery dropzone) and its element repointed at
   `ref:<id>` with `CaptureUpdateAction.NEVER` (not a user edit; undo must
   not restore an unloadable pointer). Tombstones are repointed too.
   Unsupported formats (SVG, HEIC) and failures surface as a canvas banner
   with retry.
4. **Cross-project copy**: an element pasted from another project's board
   carries a `ref:` pointer that resolves to nothing here. Each quiet period,
   unconfirmed pointers are looked up (`reference.locateForProject`, capped
   at 500): this project → keep; the user's photo in another project → bytes
   read back same-origin and adopted in, keeping its title; neither →
   silent placeholder (already-deleted is not a warning).

## V. Reference-aware surfaces

- **Inspector** (`moodboard-inspector.tsx`, selection derived in
  `moodboard-selection.ts`). Selection is never stored; it is resolved from
  live `onChange` behind a sorted signature so drags cost nothing. Docked
  right (excalidraw's own island takes the left), opened once by a
  "Properties" pill rather than on every selection. Shows agent 2's analysis
  via the same queries the gallery uses; several elements of one reference
  read as one; several references say so. For a *cut* it walks up: the frame
  it came from, the region outlined on it, its sibling cuts — every row a
  drag source back onto the canvas.
- **Palette** (`moodboard-palette.ts`, `board-palette.ts`). Places the
  selection's colours as ordinary grouped rectangles with hex labels
  (readable ink chosen by WCAG luminance threshold 0.179, mono font, flat,
  touching chips), centred under the selection. Multi-select places a
  *merged* palette ranked by how many references share a colour, capped
  at 8. From the moment it lands it is the editor's to edit and the
  autosave's to store.
- **Captions** (`moodboard-caption.ts`, `board-caption.ts`). Puts the
  reference's own title (or a cut's "what it keeps") under the photo as
  ordinary text, **grouped** with it — the group is the whole attachment
  mechanism; the tidy and every drag then treat the pair as one unit. Offered
  only for selected, unlocked, ungrouped photos. Font `clamp(width/16, 12,
  36)`, gap 12, text truncated at 60.
- **Kept crops** (`moodboard-crop.ts`, `board-crop.ts`). Excalidraw's crop
  is a window onto the whole file; "Keep this crop" cuts the region for real:
  fractions of the source (never pixels — the editor may hold a thumbnail),
  bytes cut in the browser from the *original* read same-origin, uploaded as
  a modified-version `Reference` ("Title (crop)", counting up), and the
  element repointed with `crop` cleared — invisible on screen, one ⌘Z.
  Offered only for a real crop (>0.5% trimmed) on a `ref:` element; follows
  crop mode via `croppingElementId` in the selection key. Failures banner on
  the canvas.
- **Page background** (`page-background.ts`, `board-background.ts`). The one
  offer on this panel that is not about a photograph, and the only place a
  page's ground can be set at all: it is a locked rectangle at the back of the
  page (§XI.4), so the editor's own islands never see it. Offered when the
  selection is **one page and nothing else** — `exportedFrame`'s rule, for
  `exportedFrame`'s reason. The colours offered first are the page's own:
  agent 2's palettes for the photographs standing on it (§V.3 membership),
  merged by `mergedPalette` exactly as the palette bar merges them, with the
  colour already standing wearing a ring. A colour input covers everything
  else — every frame of a drag inside it paints the page with
  `CaptureUpdateAction.NEVER` and the release commits one history entry, so
  choosing a colour is one ⌘Z rather than one per pixel. It calls the same
  `setPageBackground` the tool calls, so a page the user paints and a page an
  agent paints are one element made one way.
- **Strip integration**: the canvas publishes which references it is showing
  (`board-placement.ts` module store, republished on quiet periods and at
  mount) for the sidebar's placed-marks and `Unused` filter; deletion in the
  gallery warns with the boards a reference is holding up
  (`moodboard.referenceUsage` scans scenes on demand — no index to drift).

## VI. Arrangement — tidy, colour, sections, groups

`src/lib/canvas/moodboard-arrange.ts`, `moodboard-order.ts`, wired by
`board-arrange.ts` and the `TidyAction` control in the editor's top-right slot.

**That slot has been taken** (`compositor-v2.md` §IX): the top-right island holds
one control and "Let's Vibes" is what belongs in it. Tidy keeps everything below
and has moved into `BoardMenu`, beside the other board-level actions — export,
canvas background, reset. Nothing about the layout math or its call sites
changed; only where the press comes from.

Three things the move settled that this section did not say:

- **Two entries, where the island had one control with two halves.** "Tidy 5
  images" and "Tidy 5 images by colour" are separate rows: a menu has no way to
  say "and also, in this order" in one row, and the tooltip that carried that
  distinction in the island is not what a user reads in a menu.
- **They go above excalidraw's own items, and above the separator.** They are
  the only entries in that menu that act on what the user put on the board
  rather than on the document, and a board under two units offers neither — so
  the rest of the menu has to read the same with them absent, which it does
  because they are at the top.
- **The offer rule did not move with them.** Under two arrangeable units there
  is nothing to tidy and nothing is rendered — including the separator, which
  would otherwise be a divider with nothing above it.

**The press is also a text door, under the floor** (§XI.2's `fontSize` bullet,
amended a fourth time). A group is scaled rigidly, so a captioned photo tidied
into a small cell takes its caption's `fontSize` down with its box — with
nothing under it, to zero. `board-arrange.ts` now asks `flooredType` for every
placement carrying a size, exactly as `transform_on_canvas` does: the type stops
at `LAYOUT_TEXT_MIN_FONT`, and from there the block re-breaks to the narrower
box and stands to its lines. It is a *latent* door — a census over all 26 boards
on the development database finds 452 text elements, none in a group, and so 0
text placements a tidy would write — because nothing this app writes groups
anything. The member list is there for the pair a user grouped themselves
(§V's caption-group mechanism), and that is the press this guards.

- **Tidy** lays photos out in rows of one common height for the whole board
  (`height = sqrt(totalArea/totalAspect)`), gap 24, preserving the total area
  and centre of what it replaces — not a zoom, and idempotent: a second press
  moves nothing (`MOVED = 0.5` threshold, reading-order tie-breaks). Order is
  the board's own reading order (banded rows, not z-order). One press, one
  undo step, written with `newElementWith` under
  `CaptureUpdateAction.IMMEDIATELY`.
- **Scope**: ≥2 selected units aim it; anything else is the whole board.
  Selecting a frame or page aims it at that section. The button says what it
  will act on (units vs photos vs frames vs pages) before it is pressed, and
  is not offered under 2 units.
- **Units, not photos**: a group containing an image is one rigid unit (its
  members transformed uniformly, `fontSize` and arrow `points` included), so
  captions and user-made blocks survive. Locked elements — and any group with
  a locked member — are left alone. Non-photo elements (arrows, notes,
  palettes) are never swept in.
- **Sections and pages fill in place**: each frame's photos are laid out
  inside its 24px-inset inner box (height found by 20-step bisection);
  everything unframed is one group on its own bounds. After a tidy,
  `arrangeOwners` reconciles `frameId` toward geometry for pages only.
- **By colour**: the same layout filled in agent 2's order. A photo files
  under its first *chromatic* palette entry (saturation ≥ 0.15, lightness
  0.08–0.95); hue wheel starts after the widest unused arc; neutrals follow
  as a dark→light ramp; unanalyzed photos go last in reading order. Offered
  only when ≥2 in-scope photos have palettes. Also a fixed point.

## VII. Pages

The entity is tech-spec §V; the implementation is `src/lib/pages/` (reads,
membership, add/duplicate/resize/remove/move/place) — every rule shared
verbatim between the user's controls and the agent's tools.

- **User controls** (`PageAction` island, `board-page.ts`): "Page this board"
  draws the first page around what is there (nothing moves, existing elements
  adopted); "Add page" lands a source-page-sized frame `PAGE_GAP = 120` right
  of the rightmost page, named `Page N`, selected and scrolled to. "This
  frame is a page" promotes selected frames in place, keeping name, size and
  position. Both call the same lib functions as the agent's `add_page`, so a
  user page and a model page cannot drift.
- **Reading a page**: membership by centre (`pageHolding`), clipping by any
  edge outside the rect, reading order by content-anchored tenth-of-page
  bands then x (`pageReadingOrder`). `pageContents`/`pageDigests`/
  `pageBlocks` (boxes normalized 0–1000 y-first, capped 24, omissions
  counted) feed both the UI picker and the model's `PageAIRepresentation`
  (tech-spec §V.4).
- **Attachment to chat** (§V.5, `page-picture.ts`, `usePagePicture`): on
  send, the open tab flushes the autosave, exports the page rect exactly
  (`exportingFrame`, geometric membership via `pageExportElements`), PUTs
  the PNG to `pages/<pageId>@<revision>.png` (signed per revision, refused if
  the board moved), and the server rebuilds everything textual from the
  stored scene. One re-render on conflict, then text-only — a stale picture
  is worse than none. Page renders are never overwritten; board renders are.

## VIII. Boards

`MoodboardPanel` tab row + `src/lib/scene/moodboard-boards.ts` +
`moodboard` router.

- Multiple boards per project, listed oldest-first. Tabs carry the board's
  rendered thumbnail, double-click/✎ rename (optimistic), ⧉ duplicate,
  × delete with inline confirm. New boards are named client-side
  ("Untitled board", "Untitled board 2", … filling gaps).
- **Duplicate** waits on the save gate, copies the stored scene by value
  (references shared by pointer — nothing re-uploaded), starts at
  `revision 0`, inherits the source's render only when that render is
  exactly of the copied revision, and names "X (copy)" / "X (copy 2)" —
  suffix replaced, never stacked, base truncated. Delete picks the surviving
  tab before the row leaves the list and evicts the pinned scene query by
  hand.
- **Board render** (`useBoardRender`, moodboard spec §II.7): the tab showing
  a board is the only place with a canvas, so it exports a ≤1600px PNG after
  20 s of autosave idle, PUTs it to `boards/<id>/render.png` (overwritten in
  place; cache-busted by `?r=<renderRevision>`), and records the revision it
  is of. Empty boards are never rendered; failures are silent (only a
  preview is at stake) and retried on the next change. The read route
  streams bytes same-origin, 404s on any auth miss, caches a day.
- The chat can request a board be opened (`board-selection.ts` module
  store): a request, not a selection — any tab click clears it. The panel
  announces which board settled open so the chat's page picker can list its
  pages.

## IX. Export

The board's own export replaces excalidraw's dialog entirely
(`moodboard-export.ts`, `board-export.ts`, `MoodboardExportPanel`; moodboard
spec §II.6). Every route to excalidraw's export — menu, ⌘⇧E, command
palette — sets `openDialog: imageExport`, which `onChange` intercepts and
answers with the panel; excalidraw's own dialog is off in `UIOptions`.

- PNG, scale 1/2/3× (default 2×, background on) — one format, so the panel
  offers no Format row. The export builds its **own file map** at the
  output's pixel ratio — fetching originals where needed (concurrency 4) and
  inlining real `data:` URLs — so a 3× PNG is not upscaled thumbnails. A
  failed fetch keeps the editor's entry rather than failing the export.
- **The SVG output was withdrawn.** Nobody needed it — nothing downstream of
  this app reads a board as vectors — and one way out of the app is one
  output to keep honest against excalidraw's own export. Not withdrawn for
  drawing §XI.2's rounded photograph square: `exportToSvg` clips an image to
  the same `getCornerRadius` the canvas does, checked in the mirrored package
  rather than assumed. The `format` field survives at its `png` default;
  `BOARD_EXPORT_FORMATS` holds one entry.
- "Only the selected" is derived per run (a stale toggle falls back to the
  whole board, never an empty file); a single selected frame exports its
  exact rectangle with no padding, and a selected *page* is offered by name.
  Dark export and scene-embedding are deliberately off. Filenames are
  slugged from the title (plus page), 80 chars.
- Not covered, deliberately: the context menu's "Copy to clipboard as
  PNG/SVG" (excalidraw-internal, no seam) — the panel offers its own Copy.

## X. Excalidraw fitted to the product

- **Menu** is listed, not defaulted: export-image, search, command palette,
  help, clear canvas, theme, canvas background. File save/open are off in
  `UIOptions` (kills ⌘S/⌘O too): the board lives in Postgres, and a
  `.excalidraw` on disk is a divergent copy whose images cannot reload.
- **Theme** is three-way (light/dark/system), following the OS by default,
  deliberately unpersisted. Known limit: dark mode inverts vector colours
  (palette swatches lie in dark; the hex labels stay exact).
- **Fonts** are mirrored to `public/excalidraw-assets`
  (`npm run mirror:excalidraw`, verified by test against the shipped
  bundle); `window.EXCALIDRAW_ASSET_PATH` points there so text never falls
  back silently on a blocked CDN. Xiaolai (CJK, 12 MB) stays CDN-only.
- **Element library** persists on the *project* (`Project.libraryItems`,
  ≤300 items / 2 MB, refused not trimmed, fingerprint-compared so mount
  doesn't write). Project-scoped because items can carry `ref:` pointers
  that only resolve in their own project; library files hydrate into the
  same files map so previews draw.
- Not ported (moodboard spec §III): collaboration, localStorage persistence,
  embeds, Mermaid, excalidraw's socials.

## XI. Agents on the same scene

The orchestrator's board tools (`src/server/agents/orchestrator/tools.ts`; full contracts
in `agent-tools.md` / `orchestrator-tool-reference.md`) write the same
`elements` column through the same lib modules, so nothing can drift from
what the user's controls do.

- **Reads**: `inspect_board` (whole board or one page — contents, layout
  standing, loose-fit report, arrangement boxes); `discard_board` /
  `discard_page` are offers only — the delete is the user's button
  (`moodboard.remove` / `removePage`).
- **Deterministic writes** (no model call): `add_page`, `duplicate_page`,
  `duplicate_board`, `resize_page`, `swap_on_board`, `reword_on_board`,
  `move_to_page` — all via `lib/boards` + `lib/pages`, all reporting what
  they did *not* do (`notOnBoard`, `alreadyOn`, …), never silent.
- **Composition**: `compose_moodboard` routes by what the stored scene says —
  rename-only, edit-in-place on a hand-arranged board (nothing moves), a
  seated rebuild (only free slots re-assigned when the page still stands as
  composed), or a full agent-4 compose of one page (the rest of the board
  preserved). Layouts are the ten templates in
  `lib/layout/moodboard-layouts.ts` plus `CUSTOM` read off a layout image;
  the model only ever assigns blocks to slots — geometry is code's.
- **Conflict story**, three mechanisms: the revision guard against the open
  tab (a lost race is a *result* telling the model to ask again, not an
  error); a per-board keyed queue serialising one turn's parallel tool calls;
  and no-op detection (same-size resize, nothing-changed rebuild) so an idle
  tab is never handed a spurious conflict and a valid render is never
  disowned for nothing.
- Attached pages from the user are trusted only for the *picture*, and only
  when the revision and the derived object path match exactly; all prose
  about the page is rebuilt server-side from the stored scene.

### The canvas toolset — direct manipulation (built)

The tools above act at the level of compositions, swaps and pages; none can
say "move this 200 left", "rotate it a little", or "bring it above that". The
canvas toolset adds direct geometric agency, over one shared interface (pure
modules in `src/lib/canvas-objects/`; contracts in
`orchestrator-tool-reference.md` §III, build divergences in its §IV):

```
CanvasObject = {
  objectId: string,      // the element id (for a page, its frame id) —
                         // the handle every edit takes; referenceId is
                         // ambiguous once a photo is placed twice
  kind: "image" | "text" | "page",
  box: [ymin, xmin, ymax, xmax],  // 0–1000 of the holding page (the trained
                                  // box format every other surface uses);
                                  // scene px for pages and off-page items
  boxUnit: "thousandths" | "px",  // which — never left to be guessed
  angle?: number,        // degrees to the model; radians in the scene
  z: number,             // stacking among the object's own company, 0 at back
  pageId?, locked?, clipped?,
  // kind-specific: referenceId (title decorated by the executor) + rounded? /
  // text / name + preset + size
}
```

Six tools, one of which predated the set:

- **`read_canvas`** `{ boardId, pageId? }` — the geometry read: every object
  with its handle, box, angle, z and page, listed in reading order with `z`
  carrying stacking separately. Splits cleanly from `inspect_board`, which
  answers what a board *holds* and whether it still stands as composed; this
  answers *where everything is* and by what handle to grab it.
- **`put_on_canvas`** — an image (`referenceId`), a text block or a page, at
  an optional explicit box. No box → the same auto-placement the
  edit-in-place compose path uses (`placeOn*`, `placeLinesOn*`, `addPage`);
  a box → the `composedScene`-style skeleton with `frameJoining` deciding
  the landing. Images contain at their aspect centred in the box.
- **`remove_from_canvas`** — by `objectId` (accepting `referenceId`, line
  words or `pageId` as the existing removes do; a selector that would take
  anything locked is refused whole).
- **`transform_on_canvas`** `{ boardId, changes: [{ objectId, to?, angle?,
  size?, stretch? }] }` — batched move / rotate / resize. No `pageId`: the
  design sketched one, but objects are unique by id in each object's own
  read dialect, so a page scope would have been schema with nothing behind
  it. `size` is `[height, width]`, y-first like every box.
- **`reorder_on_canvas`** `{ boardId, pageId?, moves: [{ objectId,
  to?: "front" | "back", above?, below? }] }` — z-order, addressed
  relatively, exactly one destination per move (the design's union is
  flattened — declarations carry no union types); `front`/`back` scope to
  the page when one is given.
- **`move_to_page`** — already in the orchestrator's set; kept separate from
  transform because it *re-places* at the target page's own scale rather
  than translating.

Transform rules: pages never rotate (excalidraw frames cannot) — refused
with a reason, never skipped — and page `size` is refused toward
`resize_page`; groups transform rigidly through `elementPlacements`
(`fontSize` and arrow `points` included), rotation shortest-path about the
unit's centre; locked is refused; image resize preserves aspect unless
explicitly stretched (`stretch: true`, a lone image only) — a stretched
photo is a crop request in disguise; text resize is `fontSize` scaling;
bound labels are refused toward their container; an element moved across a
page edge has its `frameId` reconciled toward geometry (`arrangeOwners`);
a moved page carries its geometric members; one call addressing the same
unit twice has the later change refused.

Reorder rules: moved elements' fractional `index` fields are regenerated
(stale indices would restore the old order at next mount — the
`page-duplicate` `REGENERATED` precedent); a frame's child run stays
immediately before its frame; groups move as blocks with internal order
kept; bound labels travel with their containers; tombstones keep their
array positions; moves apply sequentially against the evolving array;
`above`/`below` across two stacking companies is refused, because the
read's `z` is per company; `kind: "page"` is refused — page stacking is
topmost-wins membership, and overlapping pages are already reported as a
defect by `resize_page`.

Plumbing is this section's, unchanged: revision-guarded writes through
`sceneWrite`, the per-board keyed queue, no-op detection (a sub-threshold
transform or a `front` on the frontmost writes nothing), and remainders
(`notOnBoard`, `locked`, `refused`) in every result — transform and
reorder's `notOnBoard` carrying the note that a `referenceId` is not a
handle. Every batched call — put, remove, transform, reorder — caps at 10,
surplus reported.

### And agent 8 holds the same set (designed)

The design assistant (tech-spec §III.8, `compositor-v2.md`) is the second agent
on this scene, and it takes these **unchanged** — same handles, same
y-first boxes, same `boxUnit`, same per-company `z`, same refusals, same
`sceneWrite` plumbing and the same per-board queue. Two agents writing one scene
through two implementations is how the user's board and the model's board drift,
and there is no version of agent 8 that needs a different `transform`.

One addition, to `read_canvas` alone: the board render rides with the answer when
there is one at the current revision. The geometry read was built for a model
that cannot see; agent 8 can, and a model reasoning about boxes while a picture
of them exists is the picture being withheld for nothing.

It takes the sixth the same way — `restyle_on_canvas`, and the style dialect
the next subsection adds under it. The five became six for agent 8's sake and are
agent 6's on the same terms, because a door that forks is a board that drifts.

What agent 8 does *not* get from this section is `add_page` — `put_on_canvas`
with `kind: "page"` already makes one and takes a box, and one act with two doors
is two prose descriptions to keep in step. What it adds beside them is `get_page`,
which answers tech-spec §V.4 *and* the page's picture.

That picture is the one thing this section could not supply. Every render in this
file is made by a mounted tab — a page at send time (§VII), a board after 20 s of
idle (§VIII) — and every agent write moves the revision a render is pinned to, so
a model that has just called `transform_on_canvas` asks for an object nobody
drew. `renderForModel` (`compositor-v2.md` §III.2) draws it on demand instead:
server-side, on `sharp`, from the elements rather than through a browser, cached
per revision under a `renders/` prefix kept separate from the tab's own objects
so the model is handed one kind of picture rather than two. The board picture
`read_canvas` now carries comes from the same function, which is also why it does
not use `boards/<id>/render.png` — that object is overwritten in place, and a
mutable uri handed to a model is a picture that can change between the round it
was sent on and the round it is re-sent on.

### The style dialect — shapes, type and backgrounds (designed)

The five tools move things and stack them. Nothing in them says what anything
*looks* like, and that is the whole of what separates the board a design
assistant can make from a whiteboard sketch.

The gap is not in excalidraw, which has all of it. `UIOptions` in
`moodboard-canvas.tsx` switches off three *file* actions — `saveToActiveFile`,
`loadScene`, `saveAsImage` — and nothing else. The toolbar is whole: the user has
ten element types and every stroke, fill, family and opacity field on each. The
agents have three kinds and no style fields at all.

| element | user draws it | `read_canvas` lists it | `renderForModel` draws it | an agent writes it |
|---|---|---|---|---|
| `image` | yes | yes | yes | yes |
| `text` | yes | yes | yes | yes, unstyled |
| `frame` / `magicframe` | yes | as a page | yes | as a page |
| `rectangle` | yes | **no** | yes | **no** |
| `ellipse` | yes | **no** | yes | **no** |
| `line` | yes | **no** | yes | **no** |
| `arrow` | yes | **no** | yes | **no** |
| `diamond` | yes | **no** | **no**, outlined and named | **no** |
| `freedraw` | yes | **no** | **no**, outlined and named | **no** |
| `embeddable` / `iframe` | yes | **no** | **no**, outlined and named | **no** |

Three consequences, and the first is the one that makes this urgent rather than
nice:

- **The model already sees what it cannot read.** `SHAPES` in `render-plan.ts`
  draws rectangles, ellipses, lines and arrows at full fidelity, and
  `readableItems` in `object-read.ts` drops every one of them — its comment says
  "an arrow, a rectangle or a palette chip is scaffolding, and a list of
  grabbable objects that includes them is a list the model will move them by",
  which was right when the list was the only thing the model had. It is wrong the
  moment the picture rides beside it (§XI, agent 8). A model handed a picture of
  a colour block and a list that does not have one is a model reasoning about a
  page it has been misinformed about — and its first move is to place a headline
  in the empty space the list claims is there.
- **Bound labels are a dead end.** A palette's hex labels are `text` elements,
  so all eight are listed as grabbable objects; `transform_on_canvas` then
  refuses each toward a `containerId` that no read will ever return. That is a
  loop the model cannot get out of, and it exists today.
- **Every line an agent sets is hand-drawn black.** `object-put.ts` writes no
  `fontFamily` and no `strokeColor`, so text falls to excalidraw's defaults —
  family 5, Excalifont, `#1e1e1e`, centred. Over a dark photograph that is
  invisible type, and there is no field on any tool that can fix it.

#### 1. A fourth kind: `shape`

`CanvasObject` gains one member, and it carries its own appearance because
appearance is the only reason to have it:

```
{
  kind: "shape",
  shape: "rectangle" | "ellipse" | "line",
  fill: hex | "transparent",
  stroke: hex,
  strokeWidth: number,       // scene units
  strokeStyle?: "dashed" | "dotted",   // absent when solid
  rounded?: true,
  opacity?: number,          // 0-100, absent at 100
  // plus every ObjectCommon field: objectId, box, boxUnit, angle, z,
  // pageId, locked, clipped
}
```

Three shapes and not ten. `rectangle` and `ellipse` are what a designer builds
with — colour fields, scrims, borders, framing — and `line` is a rule. `arrow` is
diagram vocabulary and its bindings are a state model with no design payoff;
`diamond` has no use the other two do not cover and the renderer does not even
draw it; `freedraw` is a point array a model cannot author and cannot afford to
read. Those three stay out of the *write* set for that reason, and out of the
read set because a kind that can be listed and not transformed is the bound-label
loop again.

They do not therefore vanish. `read_canvas` and `get_page` carry an
`unaddressable` remainder — `"2 things on this page are not objects you can
address: 1 arrow, 1 freehand drawing"` — which is invariant 7 at a new door:
nothing is dropped silently, and a model that can see a scribble in the picture
is told in words why it has no handle for it. The renderer's own undrawn-outline
rule (`compositor-v2.md` §III.2) is the same rule one layer down, and the two
now agree.

`put_on_canvas` gains `kind: "shape"` with the same fields, defaulting to
**`fillStyle: "solid"` and `roughness: 0`**. That default is the whole difference
between a design tool and a whiteboard: excalidraw's own defaults are hachure
fill and roughness 1, which draw a hand-sketched box with gaps in it. A user who
wants the sketchy one still has the toolbar.

*Half of that sentence is wrong against the package, and the half that is right
is the one that matters* (iteration 44). `DEFAULT_ELEMENT_PROPS` in
`@excalidraw/excalidraw` 0.18.1 is `fillStyle: "solid"`, so the fill default has
not been hachure for some versions and this door agrees with the toolbar on it.
`roughness` is `ROUGHNESS.artist` — **1** — so every shape a user draws is
sketched and only the shapes the agents put down are exact. Both fields still
belong at this door for the reason above; what changes is the census, which is
that the sketchy case is the *user's* ordinary one rather than an opt-in.

**Built (the read half), and what the read was actually hiding.** The fourth
kind, the `unaddressable` remainder and the bound-label filter are in
`object-read.ts`; the consumers §XI.5 lists are not yet. Three things the code
said back:

- **The live bug is latent, not live.** A census of all 19 boards on the
  development database found 104 text, 96 image, 46 frame and **one** rectangle
  — no arrow, no diamond, no freehand stroke, no embed, and **no bound label at
  all**. The palette's hex labels are written as excalidraw `label:` skeletons
  (`moodboard-palette.ts`), so the eight-refusal loop is real the moment a
  palette is placed on a board — and no palette has ever been placed on one
  here. So the honest reading of the urgency is the other way round: the read
  was hiding almost nothing *because the agents could not draw anything*. It is
  stage 1 that makes this stage load-bearing, not the boards as they stand.
- **A bound label is named in the remainder too.** §XI.1 names four types; the
  filter drops a fifth thing the renderer draws as itself, and invariant 13 does
  not have an exception for it. It counts as `1 label bound to a shape`.
- **A shape needs one extent, not two.** `readableItems` has always required
  positive width *and* height, which is right for a photograph and drops the
  one shape a designer reaches for most: a rule is a `line` nine hundred units
  wide and zero high. Shapes are kept on `width > 0 || height > 0`; image and
  text keep the old test.
- **The renderer stayed the only reader of the appearance fields.**
  `shapeAppearance` and `elementOpacity` are exported from `render-plan.ts` and
  the read calls them, rather than a second defaulting of `strokeColor` and
  `roundness` that could disagree with the picture beside it. `render:check`
  agrees exactly as it did before (1 AGREES, 4 CLOSE, no new disagreement).

**Built (the write doors), and the gap the put half opened.** The sentence above
— "a kind that can be listed and not transformed is the bound-label loop again"
— turned out to be a description of the code as it stood after stage 1.
`remove_from_canvas`, `transform_on_canvas` and `reorder_on_canvas` each gated on
`type === "image" || type === "text"`, so an agent could put a scrim down, read
it back and restyle it, and could not move it, restack it or take it off again.
All three now ask `readableTarget`, the read's own answer, and four things
followed:

- **The bound-label refusal is asked before the handle question.**
  `readableTarget` drops a label, so a `containerId` check placed after it turns
  §XI.1's explained dead end back into a silent `notFound` — the loop this
  stage exists to close, reintroduced by the fix for it.
- **A lone shape takes the box it was asked for, exactly.** Invariant 6 is
  written about photographs, and a colour block has no proportions to preserve:
  a scrim told to cover the page and *contained* comes back covering a corner of
  it. Grouped, it scales uniformly like every other member — reshaping an
  arrangement is not a resize. `stretch` therefore stops being image-only; it is
  redundant on a shape and still refused on text and on groups.
- **`size` needs one positive extent, not two**, for the same reason the read
  does: a rule lengthened is `[0, 1000]`. A flat box is still refused for an
  image or a line of type, once there is a kind to refuse it against.
- **A flat shape is a divide-by-zero wherever a ratio is taken.** The
  transform's unit scale and `elementPlacements` both fall back to the other
  extent; `targetW / 0` puts NaN into every coordinate below it, and a
  zero-width vertical rule scaled by the old fallback of `1` would have moved
  without resizing.

#### 2. Style is not a transform — `restyle_on_canvas`

The sixth canvas tool, and a sibling of the other five rather than a widening of
one. `transform_on_canvas` answers *where and how big*; nothing about a fill is a
transform, and overloading it would put nine optional appearance fields on the
tool every "move it left" pays for.

**`restyle_on_canvas`** `{ boardId, changes: [{ objectId, ... }] }`, batched,
capped at 10 like the rest, with the same remainders. What each field applies to
is checked against the object's kind and a mismatch is refused with a reason
rather than ignored:

| field | shape | text | image | page |
|---|---|---|---|---|
| `fill`, `stroke`, `strokeWidth`, `strokeStyle` | yes | — | — | — |
| `rounded` | yes | — | yes | — |
| `colour`, `font`, `align`, `fontSize` | — | yes | — | — |
| `opacity` | yes | yes | yes | — |

`opacity` reaching images is deliberate and is the cheapest thing on this list: a
photograph at 40% is a scrim with no element added to the page, and it is what a
model reaches for before it reaches for a rectangle.

**Widened — `rounded` is a picture's corner too.** A photograph already on a page
can take the corner without being lifted off and put back down. It is one row of
this table, not a tool: `rounded` is already a word, both doors already read the
same vocabulary module, and an image carries no `ReadableShape`, so it lands in
the adaptive model (`{ type: 3 }`) — the one excalidraw's own canvas branch reads
when it clips an image element to `getCornerRadius` (`roundRect` + `clip`). So
the live board and every PNG path draw it for nothing.

One thing does not draw it for nothing, and it is where the work is: this repo's
own rasteriser. The corner rides on the plan as `ImageDraw.radius` in output
pixels, beside `ShapeDraw.radius` and for the identical reason — the ceiling is
in scene units and the plan is the one place holding the scale — and
`photograph()` cuts it with a `dest-in` rounded rect *folded into the opacity
composite*, since the fade is already a flat-alpha `dest-in` and one rectangle
filled at that alpha does both. A rounded image in `DIALECT_SCENE` is what keeps
that rule under the renderer's own fingerprint; the widening is its first bump
(`compositor-v2.md` §III.2.1).

The plan for this change said excalidraw's SVG export would have drawn the
corner square and that this was half the argument for withdrawing it. **That is
wrong** and it was checked rather than taken: `exportToSvg`'s image branch does
clip to `getCornerRadius`, the same function the canvas uses. The SVG export is
gone anyway (§IX), for the reason that survives — nobody needed it.

The read carries it back — `CanvasObject`'s image member gains `rounded?: true`,
present or absent like `locked` — because a field the restyle can set and the
read cannot say is invariant 13: the second ask comes back `unchanged` with
nothing in the picture or the list explaining why.

It stays a **boolean**. A radius number would diverge from the toolbar, from the
shape half of this row and from `getCornerRadius`, and `cornerRadius` already
honours `roundness.value` as the ceiling — so a number remains a later widening
with no scene-format change behind it.

Pages take nothing here — a page's fill is `set_page_background` below, because
it is not the frame's own field (4).

**Corrected — `strokeStyle` is three numbers, and the renderer had all three
wrong.** This table gave both agents a word (`dashed`, `dotted`) on the
assumption that a dash is a dash. Read against excalidraw's own
`generateRoughOptions`, drawing one is three separate decisions and this
codebase's renderer disagreed with the export on every one:

- **The run.** `getDashArrayDashed` is `[8, 8 + strokeWidth]` and
  `getDashArrayDotted` is `[1.5, 6 + strokeWidth]` — the ink is a *fixed* length
  whatever the stroke and only the gap grows with it. `rasterise.ts` had both
  proportional, four times the width on and four off, which draws a hairline
  border at a quarter of the export's period and a heavy one with dashes four
  times too long. The run now rides on the plan (`ShapeDraw.dash`) rather than in
  the rasteriser, because the numbers are in scene units and the plan is the one
  place that holds the scale.
- **The weight.** A non-solid stroke is drawn half a unit *wider* than the number
  on the element: excalidraw turns roughjs's second pass off so the dashes do not
  overlay each other and adds the 0.5 back so the line still reads as the same
  border. At roughness 0 the two passes land on top of each other, so that
  compensation is the whole of the difference. It goes on the plan's drawn width
  and not on `shapeAppearance` — a `read_canvas` answering 1.5 for a border
  somebody set at 1 would be the renderer's arithmetic leaking into this
  vocabulary.
- **The cap.** Excalidraw's export sets `stroke-linecap: round` on every shape it
  draws — the node for a rectangle, an ellipse or a diamond, the group for a line
  or an arrow — always, and not only for a dotted one. This renderer set it only
  for `dotted`. On a closed path with a solid stroke that is invisible, which is
  why it survived nine stages; it is half a stroke at each end of every rule on
  every board, and both ends of every dash.

One more found beside them and fixed with them: a filled `line` loop takes
`fill-rule: evenodd` in the export, so a star drawn with the line tool is hollow
at the centre there and was solid here. That is the other half of §XI.5's
`paintsInside` correction — that one settled *whether* a loop is painted, this
settles *what* the paint fills.

The measured half is that none of it moves a pixel on this database:
`npm run render:check` comes back 1 AGREES / 4 CLOSE with the same percentages
either side, because of 351 stroked elements every one is `solid` or absent, and
none of the five boards the comparison can run on carries an open path at all.
Both facts are the same fact — `render:check` cannot find a defect in a field
nobody has set, and `strokeStyle` is a field only the style dialect can set.
`compositor-v2.md` §III.2.1 carries the finding.

**Corrected — `rounded` is two radius rules and a ceiling that has to scale.**
The same reading applied to the fourth of this table's shape fields found the
same shape of defect one layer up. Excalidraw's `getCornerRadius`
(`element/shapes.ts`) is not one formula:

- A linear element and a diamond take a quarter of their shorter side, however
  long that side is — `PROPORTIONAL_RADIUS`, which is what this door writes on a
  `line`.
- A rectangle takes the same quarter only until the corner reaches
  `DEFAULT_ADAPTIVE_RADIUS` 32, and every larger box keeps that same corner —
  `ADAPTIVE_RADIUS`, which is what this door writes on a `rectangle` and what the
  toolbar's rounded button writes. The point of the second rule is that a chip
  and a page-wide panel read as the same rounding; without the ceiling a big
  panel is a lozenge.

`rasterise.ts` held one formula — `min(32, min(w, h) * 0.25)` — which is the
adaptive rule and only the adaptive rule, and it applied it to a box that the
plan had **already scaled**. So the ceiling was 32 *output pixels* rather than 32
scene units: every rectangle past the cutoff came out with the same corner
whatever the picture's scale, too round by exactly the reciprocal of it. The
radius now rides on the plan (`ShapeDraw.radius`, in output pixels) beside
`dash`, for the reason `dash` is there — a scene-unit constant can only be
applied where the scale is known.

Unlike `strokeStyle` this one is live and measurably so: of 189 rounded-rectangle
draws across every board and page render on the development database, 144 carried
the wrong radius, a median 1.23x too round and one 6.6x. All 95 rounded
rectangles stored are `ADAPTIVE_RADIUS`, and 74 of them are past the cutoff.
`render:check` still cannot see it, and for a third reason on top of its usual
two: four of its five boards hold no rounded rectangle at all, and the fifth
renders at scale 1, where the old arithmetic and the new one agree by definition.

Two things this leaves standing rather than fixes, both latent on this database
and both worth a reading before anyone spends on them. A `rounded` **ellipse** is
accepted by this table and drawn as a plain ellipse, because excalidraw ignores
roundness on one too — the field is a no-op there rather than a lie about the
picture. A `rounded` **line** is accepted, stored as `PROPORTIONAL_RADIUS` and
drawn straight: excalidraw curves the path through its points and this renderer
does not, which is a real disagreement and the only one of the two that shows.
Nothing on the database has ever set either.

**Corrected — a rounded line is a curve, and it is the line tool's own default.**
The second of the two gaps the block above left standing is closed. Excalidraw's
`getShape` (`scene/Shape.ts`) sends a `line` or an `arrow` down one of three
branches: an elbowed arrow to `generateElbowArrowShape`, an element carrying no
`roundness` to roughjs's `linearPath`, and everything else to roughjs's `curve`.
This renderer drew all three as straight segments.

The curve is not a smoothing of the path — it interpolates it. roughjs's
`_curveWithOffset` duplicates the first and last point and runs `_curve` over the
lot, which is a Catmull-Rom spline at `curveTightness` 0: each pair of points
becomes one cubic whose controls are a sixth of the way along the neighbours'
chord, and the duplicated ends are the whole of why the stroke still starts and
finishes where the user put it. At roughness 0 every offset roughjs would add is
multiplied by the roughness and vanishes, so the sketched curve and the exact one
are the same path.

Latent on this database and not latent in the product. All 110 lines stored are
two-point and none carries a roundness, so nothing rendered today moves — but
excalidraw's `currentItemRoundness` default is `"round"`, so the *ordinary*
three-point line a user draws with the line tool is curved, and this drew a
dogleg. The gap between the two is not subtle: halfway along the first leg of a
right-angle V the spline sits a twelfth of the leg's length off the chord.

Three decisions the build made that §XI did not say:

- The plan carries `curve: boolean` and the rasteriser holds the arithmetic —
  the reverse of `dash` and `radius`, and for the reason those two moved. A
  spline holds no scene-unit constant, so it does not care what the picture was
  scaled by, and it belongs where the SVG `d` string is written.
- A two-point path is `curve: false` however its roundness is stored, because the
  spline through two points is that chord. A plan that described one picture two
  ways would be a second thing to keep in step for no gain.
- An **elbowed** arrow is `curve: false` too. It is a third branch of excalidraw's
  own switch, rounding its right angles by a fixed sixteen units, and reading its
  roundness as a spline would draw a bowed arrow where the export draws a
  square-shouldered one. Nothing here draws the elbow rule either — it is named
  so the two gaps are not confused for one.

The arrowhead needed nothing, and not by luck: the final cubic's second control
sits a sixth of the way back along the last chord, so the curve leaves its last
point parallel to it however hard the rest of the path bends. Excalidraw takes
the head's direction off a point 30% back along that same cubic
(`getArrowheadPoints`); this takes it off the chord, which is the same direction.

**Type gets a vocabulary, not a number.** `fontFamily` is an integer in the scene
and `renderFont` in `render-plan.ts` already maps eight of them onto the mirrored
files. Five of those are worth naming, and the names are what a designer says:

| name | family | what it is |
|---|---|---|
| `hand` | 5, Excalifont | excalidraw's own, and today's silent default |
| `sans` | 2/9, Liberation | the neutral one |
| `mono` | 3, Cascadia | data, captions, hex |
| `rounded` | 6, Nunito | soft, friendly |
| `display` | 7, Lilita | heavy, for a headline that has to carry |

`put_on_canvas` gains the same `colour`, `font`, `align` and `fontSize` fields,
so a line can land right rather than land and be fixed.

*Widened (2026-08-29): `font` takes the whole Google Fonts catalog.* The five
roles above stand unchanged, and `font` now also takes any Google Fonts family
by its own name, with two new text-only fields `weight` (numeric, 100–900) and
`italic`. Resolution is on demand: the executor asks the library
(`server/render/google-fonts.ts`) before the pure door runs — metadata
validates the family and its cuts, the variant's TTF is downloaded once and
cached, its widths are measured into the same `SetMetric` every wrap runs on —
and the door is handed the answer or the refusal. An unknown family refuses
with the nearest real name; an unavailable cut refuses with the cuts the family
has; `weight`/`italic` on a single-cut face refuses naming the way out. The
element stores its variant twice over: `fontFamily` is a deterministic hash of
`family|weight|italic` (`font-google.ts`, range 10⁴–2³¹ so it can never collide
with excalidraw's own integers) and `customData.font` carries the name, cut,
measured widths and fallback — which is what makes the integer reversible, the
reads say the family back by name (`font`/`weight`/`italic` on a text object),
and the browser (`excalidraw-google-fonts.ts`) registers each variant under a
composite name in excalidraw's mutable `FONT_FAMILY` table so the editor and
every client export draw the same face the server rendered. Which face carries
which intent is taught, not listed in the tool: the `type-faces-display`,
`type-faces-text` and `type-faces-voice` foundations carry the catalog
knowledge, ~130 families with intent.

*Amended when the read learnt to say it back.* The table above is a write and was
only ever a write: `read_canvas` said nothing about the type a line is set in for
four stages, so a design could choose a family and never read one — which is
what a live run spending three of twelve rounds moving a headline to `display`
and straight back to `hand` looks like from the read's side. The same table is
now read backwards, `fontNameOf` in `object-style.ts`, so a family the answer
names is a family this door takes. Two rows the reverse direction needed that
the forward one did not: 9 answers `sans` on its own (the row above already says
2/9 are one face, and a block carrying 9 is set in it), and the three families
`renderFont` maps that this table does not name — 1 Virgil, 8 ComicShanns —
answer `"other"`, because absent means the hand family and neither of them is
it. §XI.5's last **Corrected** block is the whole of it.

**The default is still the default.** Text placed with no `font` lands in
excalidraw's own family, exactly as it does today and exactly as a line the user
types lands; the fields here are how anyone — the user with the toolbar, either
agent with `restyle_on_canvas` — changes it afterwards. Nothing about existing
boards moves.

The one thing worth saying out loud is that the default is *hand-drawn*, which is
right for the sketch a moodboard is and wrong for a wedding sign. That is a
sentence in agent 8's instruction (`compositor-v2.md` §II.2), not a different
default: a door that behaves differently depending on which agent knocked is a
fork, and this section's whole premise is that it does not fork.

**Built — a family is also a width, and the doors had to learn that second.**
This table settles what the model *says*. What it did not settle, and what took
until the faces were actually read, is that naming a family changes how wide the
words are: the five faces above are 27% apart on lowercase, and the silent
default is the widest proportional one of them. Every door that breaks a line to
a box — the put, `restyle_on_canvas`, `reword_on_board` and the tidy's floor —
was breaking it on Helvetica's advance widths whatever `font` had been asked for,
so a `mono` line that "fits" its card overran it by a quarter in the picture. The
per-face measure is `lib/render/font-set.ts` and the numbers, the census and the
re-check are `compositor-v2.md` §VIII's fifth **Corrected** block. Two
consequences belong here rather than there:

- **A `font` on its own is a re-break.** `restyle_on_canvas` re-wrapped a block
  when the *size* moved and not when the family did, which was right while every
  face measured the same and is a silent overrun now. Asking for `font` alone
  re-settles the breaks and the drawn height, exactly as asking for `fontSize`
  alone does.
- **`npm run fonts:set` is the check.** The mirror rebuilds silently on install,
  so a version bump that redraws a face would leave the table describing a font
  that is no longer there. Nothing else in the checkout would notice. (The
  mirror itself now checks the other join: it decompresses each classic face's
  Latin subset into `.fonts/` for the rasteriser and fails the build if a
  face's internal name has drifted from `render-plan.ts`'s table. A Google
  face's measure is taken at resolve time from its own TTF —
  `font-measure.ts`, the same cmap/hmtx arithmetic — and stored on the element
  beside its name, so the wrap consumers stay synchronous.)

**`fontSize` bypasses the box clamp, and only when it is said.** `object-put.ts`
derives the size from the box height and clamps it to `LAYOUT_TEXT_MAX_FONT` 96,
which ten of the thirty-two typed pages on the development database are sitting
on. An explicit `fontSize` is honoured to `CANVAS_TEXT_MAX_FONT` instead. The
derived path keeps its clamp untouched, so agent 4 — which never passes the
field — composes exactly what it composed yesterday.

*Amended once the field had been live for four stages — the door had the way out
and the sentence that fires on the clamp did not name it.* `TYPE_CLAMP_NOTE`
(`server/agents/designer/canvas.ts`) is what agent 8 reads the moment a box asks
for type over 96, and it was written the day the clamp became visible — before
this field existed and before `restyle_on_canvas` did — so it said the way out
was `transform_on_canvas`: this put, and then one resize back to the box. That
was true then and is the expensive half of true now. The database says what it
cost: of **574** text elements, **13** sit at exactly 96 and **one** is over it,
at 110 — the `AMARA & INES` line the clamp was first caught on, and the only line
in the product's history that took the two-call route. The note now names the
field on the tool it is speaking from, for the next headline, and
`restyle_on_canvas` for the lines in the answer it rides on — which is the better
of the two doors for a line already placed, because it takes the size directly
and moves nothing, where a resize is a box the design has to work the size back
out of. The withheld-number rule is unchanged: no size appears in either
sentence, only the field's name.

**And the box's width sets the line breaks.** The height answers "how big"; the
width answers "how many words to a line", and until the third Vibes run
(compositor-v2.md §IX.5) it answered nothing — the string was stored whole and
excalidraw drew it straight out of the card it was placed in. The words now
break to the box (`setBlock` in `render/text-set.ts`), the drawn height follows
the lines they came to, `originalText` keeps what was typed, and a block that
took more than one line is named back to the caller the way a clamped size is:
the box the model steered by is still the box, and the block now standing below
it is the design's to settle.

**Built (the put half), and what it costs.** The style fields, the fourth kind
on `put_on_canvas` and agent 8's instruction are in; `restyle_on_canvas` is
still designed. The vocabulary is one module — `object-style.ts`, which §XI
did not name — because there are two doors onto it and a field that means one
thing on the way in and another on the way back is the fork this section says it
does not have. `object-put` and the sixth tool both read it; `object-read` keeps
calling `render-plan`'s `shapeAppearance`, so the fill the model is told about,
the fill the picture was drawn with and the fill a put writes are one set of
fields.

Eight things the code decided that §XI.1 and §XI.2 do not say:

- **A shape put names its box.** There is a house rule for where a photograph
  goes and one for where a headline goes; there is none for where a colour field
  goes, and a scrim placed into free room beside the picture it was meant to
  cover is scaffolding nobody asked for. Refused with that reason.
- **A shape's box may be flat**, the read's own one-extent rule at the write
  door: `[465, 430, 465, 570]` is the rule the first live run drew. A box with
  neither extent is still unreadable.
- **A fill with nothing said about the outline lands with no outline.** A colour
  field with excalidraw's dark stroke round it is a box, not a field — the
  reading the palette's chips have been written with since long before the
  agents could draw. Say `stroke` and it is honoured.
- **`fill` on a `line` is refused** toward `stroke`: excalidraw stores the
  background on a linear element and draws nothing with it, which is a field the
  model believes it set.

  **Corrected, and the reason was half wrong** (iteration 38). Excalidraw draws
  a linear element's fill exactly when `isPathALoop` holds — three points or
  more with the ends within eight scene units — so a closed loop *is* painted
  and only an open path is not (`generateRoughOptions`, the `line`/`freedraw`
  case). The refusal stands, because a `line` this door makes is two points and
  can never be a loop, but the sentence it is refused with had been describing
  excalidraw rather than the door. What was wrong beyond the sentence is in
  §XI.5's own correction below: every *read* of a fill was reporting the stored
  colour whatever the shape, and the picture was drawing every path with none.
- **`fill` and `stroke` take `transparent`; `colour` does not.** Type set in
  nothing is type nobody can read, and a model asking for it means the page's
  own ground.
- **A style field of the wrong kind takes the whole put down**, where the
  restyle will refuse per change: the put has no per-field remainder, and an
  object that lands wearing none of the appearance it was asked for is one the
  model reasons about as though it got it.
- **Out of range is refused, not clamped** (invariant 7): `strokeWidth` over 0
  and up to 100, an explicit `fontSize` 12 through `CANVAS_TEXT_MAX_FONT` 512.
  512 is a typo guard rather than a taste ceiling — a quarter of the largest
  preset's 2048 edge, larger than any headline a page can carry, small enough to
  catch a dropped decimal point at the door.
- **The floor moved a long way and the number is here rather than trimmed out of
  the prose.** `put_on_canvas` **600 → 1,088** for eleven fields, the boards
  shape 13,153 → **13,641**, and agent 8's instruction 2,114 → **2,512** for the
  type paragraphs — its own floor 8,343 → **9,229**. §XI.6's cut order stands:
  the put's style fields go first if it has to come down, and after this
  measurement they are also the largest single thing there is to cut.

**Built (the sixth tool), and what it decided.** `restyle_on_canvas` is
`object-restyle.ts`, declared once and reached by both agents through
`tool-canvas` — one implementation, so requirement 3 is a fact about the module
graph rather than a thing to test twice. The vocabulary is `object-style`'s
unchanged; what the tool adds is everything about the board rather than about
the words. Six things the build decided that §XI.2 does not say:

- **The refusal grain is the field, not the change** — the one place this
  differs from the put, and the difference the put's own paragraph implies
  without settling. A put refuses whole because an object that lands wearing
  none of the appearance it was asked for is one the model reasons about as
  though it got it; there is no landing here, and an object that already exists
  keeps every field the call could not set. So a change carrying one bad field
  sets the rest and names the bad one back **on its own entry** —
  `{ objectId, set: [...], refused: [...] }` — which keeps the house rule that
  every change lands in exactly one of `restyled`, `unchanged`, `notFound` and
  `refused` while still saying per field what did not happen. A change whose
  every field is refused is `refused` whole.
- **The read is the single answer to what is addressable.** `readableTarget` is
  exported from `object-read` and this tool asks it, rather than testing element
  types again: a write that could reach something no read surfaces is a write
  onto a board the model is not looking at, which is invariant 13 from the other
  side. So an arrow, a scribble and a zero-extent rectangle are `notOnBoard`
  here for exactly the reason they are absent there.
- **Appearance is not rigid the way geometry is.** A grouped element is
  restyled alone. `transform_on_canvas` moves a whole group because a photo torn
  out of its stack is broken; recolouring one chip of a palette is exactly what
  recolouring one chip means.
- **A no-op is per field**, not per change: echoing a read back and changing one
  colour writes one column. Colours compare case-blind, because excalidraw's own
  picker writes `#1E1E1E` and this vocabulary reads `#1e1e1e`, and the two are
  the same paint.
- **`fontSize` takes the drawn height with it**, the rule both text doors keep
  — the read reports a box off `height`, so a line set to twice the type in a
  box of the old height would read back as a line that did not change. And the
  put's `LAYOUT_TEXT_MAX_FONT` 96 does not reach here at all: that clamp is a
  property of deriving a size from a box, and there is no box in a restyle.

  *Amended when the words learnt to break.* It takes the drawn *lines* with it
  too. Once `put_on_canvas` wrapped a paragraph to its box (compositor-v2.md
  §IX.5), a restyle that changed only the size went on rewriting `height` from
  the size alone — so the first live run with the put fixed came back with two
  paragraphs four and five lines deep in the picture and one line tall to the
  read, because a design restyles what it has just put. The size, the breaks and
  the height are now one answer, `setBlock` in `render/text-set.ts`, at both
  doors; the re-wrap starts from `originalText`, which is what was typed rather
  than where the last width broke it, and it measures against the element's own
  `width` — the one field a restyle never moves.

  *Amended again, when a block that sizes itself turned up.* Re-breaking is only
  right for a block whose width is a **decision**. Excalidraw wraps a text
  element to its own width only when it is pinned (`autoResize: false`); a block
  left to size itself grows sideways around the breaks somebody typed, and its
  stored `width` is a measurement of the string it already carries rather than a
  slot anybody chose. So the re-wrap is asked `setsToItsBox` first, and an
  unpinned block keeps its own breaks and takes only the height its new size
  stands to. Every text element on the development database is pinned — 440 of
  440, none auto and none without the field — because the compose, the dropped
  line and the put all write it, which is why this cost nothing on real data and
  is still the difference between the door owning a break and inventing one. The
  same reading made `wrapToWidth` keep a newline: a break somebody typed is a
  break they meant, and only the soft breaks a width put in are taken out before
  a re-wrap.

  *Amended a third time, when the geometry door turned out to keep the same
  rule.* `transform_on_canvas` scales a text object's width, `fontSize` and
  height by one number, so while the type follows the box the stored breaks
  stay right and it is not a text door at all — measured over all 440 text
  elements on the database, at a quarter scale thirteen change line count and
  every one is a headline whose box was set to the width its words measure
  (compositor-v2.md §IX.5). What it lacked was a **floor**: `LAYOUT_TEXT_MIN_FONT`
  is the size the put clamps up to and this door refuses under, and the
  transform clamped neither end, so one halving took 283 of the 440 under it
  and a scale under a twenty-fifth rounded the type to zero. The size now stops
  at 12 while the box goes on down, and from that moment the block is re-broken
  to the narrower width and stands to its lines, from this door's own
  `setBlock`. The *ceiling* stays absent there on purpose: 96 is a property of
  deriving a size from a box, and one put followed by one resize is how type
  larger than the put's ceiling is reached.

  *Amended a fourth time, when the floor turned out to belong to the tidy too.*
  §VI's press scales a group by one number through the same
  `elementPlacements` the transform door borrows, so it had the same missing
  floor and no way to reach the fix inside a canvas tool. The floor now lives
  as `flooredType` in `render/text-set.ts` beside `setBlock` and
  `setsToItsBox`, and both doors take it — one answer, per invariant 12, and
  the transform's own cases passed the move untouched. The two differ only
  after the write: the model is told what it did not get (`clamped` →
  `typeSet`), the user is not, because the user is looking at the board.
- **The page refusal does not yet name `set_page_background`,** because naming a
  tool the model does not hold is a round spent calling something that is not
  there. It refuses toward "the page's own background", and §XI.4's build is
  where the sentence gains the tool's name.

  *Amended when the name was taken up.* §XI.4 landed, both agents hold the
  tool, and the sentence is now `PAGE_GROUND_INSTEAD` in `object-style.ts` —
  "a page's only appearance is its ground, which is set with
  set_page_background" — appended at both doors that can be handed a page:
  `restyle_on_canvas`'s own refusal, and every per-field refusal `styleReading`
  writes for a `put_on_canvas` that asked for a page with a fill on it. Three
  things the move settled:

  - **Every field, not just the appearance ones.** A page has no appearance but
    its ground whichever field the model reached for, so the tail goes on all
    ten rather than on `fill` alone — the model that asked for `opacity` on a
    page is as lost as the one that asked for `fill`, and one refusal that
    routes is cheaper than ten that describe.
  - **The section splits off, and deliberately keeps no name.** §XI.2 refused a
    page and a section by one sentence, which stops being right the moment the
    sentence carries a call: `setPageBackground` takes a `BackedPage`, so a
    section sent there is a second refusal a round later. A section now says
    what it is — an arrangement of what is inside it, with no ground of its own
    — and names nothing.
  - **The refusal that already named it did not move.** The page *background
    element* has said `set_page_background` since §XI.4 shipped, in
    `object-remove`, `object-transform` and `object-reorder` as well as here.
    What was missing was the refusal for the page itself, which is the one a
    model reaches by reading a page's `background` off the page object and then
    restyling the page it was reported on.

  The suite 2,850 → **2,854**; both declaration floors byte-identical across a
  `git stash` run either side (15,093 and 10,503 on the day), because a refusal
  is a runtime sentence and no declaration says it. The boards figure read 15,046
  earlier the same afternoon and 15,093 after — that floor is gated on what the
  project holds and a Vibes run had put a board on it, which is why the stash
  comparison rather than a number from a previous iteration is the only honest
  one.

The door cost, measured the way the others were: `restyle_on_canvas` **664**
declaration tokens, the boards shape 13,641 → **14,305**, agent 8's instruction
2,512 → **2,593** for the one bullet, its own floor 9,229 → **9,974**. The suite
2,638 → **2,664**.

**What the second live run did with it** (`npm run design:check` against the
page the first run made — "the names have to carry from across a room, and the
scrim is too heavy" — gemini-3.7-flash, $0.03, 3 rounds). It read the page and
went straight to one `restyle_on_canvas` call carrying three changes: the
page-sized scrim to `opacity: 18`, the band behind the type to 38, and the names
to `#FFFFFF` / `sans` / centred / `fontSize: 96`. Two readings, and the second
is the one worth keeping:

- **An edit ask is now three rounds and three cents**, against the first run's
  twelve rounds and seventeen. A restyle is the whole of "make that lighter" in
  one write, where the alternative was a remove and a put that lose the box.
- **The type ceiling is not what holds type down.** The names were at 92 and the
  model asked for **96** — a 4% rise for "much larger" — with 512 in the
  declaration in front of it and no clamp anywhere in this path. §XI.2's
  earlier reading was that style fields do not fix the size of the ask; this
  isolates it, because there is now nothing between the ask and the scene. The
  page still comes back at largest type 5% of the frame, which is exactly where
  `plan-read.ts` left §VIII.

**What the first live run did with them** (`npm run design:check`, a wedding
welcome sign, gemini-3.7-flash, $0.17). The model reached for the dialect
immediately and correctly: a page-sized `#0c111c` rectangle at `opacity: 45` as
a scrim over the photograph, a hairline `#e8d8b8` border inset from the edge,
`font: "display"` in `#FFFFFF` for the names against `font: "sans"` for the
date, and a flat `line` as a rule between them. Three readings worth keeping:

- **The scrim is the first thing it builds**, which is §II.2's instruction
  working — the two ways to make type readable over a photograph are named
  there, and it took the first and the second in one call.
- **The type ceiling was never the binding constraint on this ask.** It asked
  for 88 and 92 explicitly, under the derived 96 either way; the page came back
  at *largest type 5% of the frame*, which is exactly where `plan-read.ts` left
  §VIII. Style fields do not fix the size of the ask.
- **It ran out of rounds** (`stopped: rounds`, 12 of them, 4 shapes and 4 lines
  of type placed). A dialect with more in it is a design that takes more turns,
  and the round budget is now the thing to watch rather than the tool count.

**Corrected — a shape is drawn by hand, and the renderer drew it exact.**
The last of the five appearance fields this table names that the picture was not
reading. `roughness` is `ROUGHNESS.artist` 1 by default (`DEFAULT_ELEMENT_PROPS`),
so the box a user drags out with the toolbar has a wobbling outline drawn twice
over, and `renderForModel` drew a ruled rectangle. `fillStyle` is the same field
one layer in: a hachured or cross-hatched block is *lines with paper between
them* and this painted it solid, which is a different colour as well as a
different texture.

The geometry is roughjs's own rather than a second implementation of it
(`src/lib/render/sketch.ts`). Excalidraw hands `RoughGenerator` the element's own
`seed` (`ShapeCache`, `scene/Shape.ts`), so asking the same generator the same
question gives the *same* wobble rather than a plausible one — a hand-drawn
picture reproduced from a different random walk would be a picture of a shape
nobody has. The package is a direct dependency now, pinned to the 4.6.4
excalidraw itself pins, because a different generator version is a different
walk.

Five things the build decided that this section does not say:

- **The walk is generated in scene units and scaled**, which is the rule
  iterations 41 and 42 landed the dash run and the corner radius on, asked of a
  third thing. roughjs's displacements are absolute — `maxRandomnessOffset` is 2
  *units* — so a walk generated on an already-scaled box wobbles by the same
  pixels at every zoom, which on a whole-board picture is every shape drawn as if
  it were a metre across.
- **`adjustRoughness` comes with it.** Excalidraw draws a small shape less
  roughly than it says, because the same two-unit wobble that reads as a hand on
  a page-wide panel is an illegible scribble on a chip. Three ways to be big
  enough, two divisors below that, and a 2.5 cap.
- **The sketch replaces the body and keeps the heads.** An arrowhead is drawn
  from the shaft's own direction and the half-dozen head shapes excalidraw has
  are a divergence the rasteriser already carried; the final control point of a
  hand-drawn path leaves its tip along the same chord, so nothing had to change.
- **A sketched shape needs room the stroke width cannot predict.** Every other
  draw hangs outside its box by a multiple of its own weight; this one hangs
  outside it by roughjs's bow, which grows with the *length* of the edge — a
  1,200-unit side at roughness 2 leaves the box by ten pixels on a one-unit
  stroke, where the rasteriser's pad reserves six. The plan measures the walk it
  generated rather than guessing at a worst case.
- **A frame and an elbowed arrow take none of it**, the first because every frame
  is drawn in `FRAME_STYLE` whatever the element carries (§XI.4) and the second
  because this renderer draws its dogleg rather than excalidraw's rounded
  shoulders — sketching the wrong path would put a hand on a shape that is
  already in the wrong place.

The census is one shape and the number is not the reading. Of 266 drawn shapes
across 30 boards exactly **one** carries a roughness, because the style dialect
writes `SHAPE_ROUGHNESS` 0 on everything either agent puts down and almost every
shape on this database was put down by an agent. The zero elsewhere is "nobody
has drawn a box with the toolbar yet", not "this case is rare" — the same
distinction iteration 43 drew about the line tool's roundness, and for the same
reason: the default is the sketchy one.

**And it is the first renderer fix `render:check` has ever been able to see** —
which took finding out why. See `compositor-v2.md` §III.2.1's sixth block: the
comparison had been reading a *cached* picture, so five consecutive renderer
fixes were invisible to it by construction. Drawn fresh, the one board carrying
the sketched rectangle goes CLOSE 2.4% of cells apart -> **AGREES 0.0%**, mean
0.007 -> 0.000, worst cell 0.220 -> 0.016.

#### 3. The board's background — `set_canvas_background`, agent 6's alone

`appState.viewBackgroundColor`, already in `PERSISTED_APP_STATE_KEYS` and already
read by `render-plan.ts` as `plan.background`. Both ends exist; there is no tool
in the middle.

**`set_canvas_background`** `{ boardId, colour }` — a hex, or `"default"` for
excalidraw's own paper.

It is the orchestrator's and **not** the design assistant's. The board is the
user's workspace — the desk the pages sit on — and a design assistant asked for a
poster has no business repainting the desk. Agent 8 gets the thing it actually
needs, which is the page's own background (4). The split is also the honest
reading of what the two agents are for: agent 6 acts on the board a user is
looking at, agent 8 acts inside one page it was handed.

**This is the first write in this file that is not an elements write**, and that
is the part to build carefully. `sceneWrite(elements)` takes elements and derives
`pageCount`/`pageNames` from them; `appState` is a separate `Json` column and
nothing in §III's conflict story covers it. The background write needs the same
three mechanisms or it will quietly acquire none of them: the revision guard
against the open tab, the per-board keyed queue, and no-op detection — setting
the colour a board already has must write nothing, or every idle tab gets a
spurious conflict for a repaint that changed no pixel.

**Built** (`lib/boards/board-background.ts`, declared in `agent-tools.ts`,
executed as `paintBoardCanvas` in `server/agents/orchestrator/tools.ts`, 2,744 → 2,757
cases). Six things the build settled that this section did not say:

- **`"default"` drops the key rather than writing `#ffffff` over it.**
  Excalidraw opens every board on its own white and `render-plan` falls back to
  the same one, so the absence of a stored colour *is* the default. Written as
  white instead, every board would carry a colour nobody set and no read could
  ever answer "nobody has painted this".
- **The no-op is asked against the colour the board is *drawn* on, not the
  colour its row carries.** A board with no `viewBackgroundColor` and a board
  carrying `#ffffff` are the same pixel, so both spellings of "leave it as it
  is" are free. Stricter than the rule above, and the same trap one step out:
  the promise is that a repaint moving no pixel writes nothing, and the row is
  not the pixel.
- **The write hands back a whole allowlisted `appState`, not a patched key.**
  It is a `Json` column, so it goes through `persistedAppState` exactly as the
  tab's own save and `duplicate_board` do — a row written by an older build is
  filtered on the way rather than carried forward one key at a time.
- **No tile.** Every other board answer carries a `boardShown` attachment and
  this one must not: `BoardAttachment` draws the arrangement and has no canvas
  colour in it, so a tile here would be the board exactly as it was — a picture
  saying nothing happened beside a sentence saying something did.
- **The answer counts the pages that stand on a ground of their own**, because
  that count is the difference between "the board is dark now" and "the board
  *looks* dark now". A spread whose pages all carry a colour is a repaint the
  user only sees between them, and the model has no other way to know.
- **Queued on the board key though it touches no element.** The revision it
  guards on is the same counter a compose in the same turn increments, so a
  repaint read outside the queue answers with a conflict it did not have to have.

The door cost, measured on the same project minutes apart: **+290 tokens**,
taking agent 6's boards shape from 14,701 to **14,991**. Agent 8's floor is
unmoved at 10,503, which is the split doing exactly what it is for.

#### 4. A page's background is an element, because a frame's fill is not drawn

A frame carries `backgroundColor` on its row and neither renderer honours it.
Excalidraw draws every frame in `FRAME_STYLE` — a pale grey two units wide,
whatever the row says — and `rasterise.ts` matches it deliberately
(`draw.shape === "frame"` → `fill="none"`, and `FRAME_STROKE` for the same
reason, found by `npm run render:check` on every real board). Setting the field
would give the model a coloured page and the user a white one, which is the
exact fidelity bet §III of `compositor-v2.md` is built on losing.

So the page background is **a real rectangle**: page-sized, page-positioned,
carrying `customData.pageBackground: true`, at the very back of the page's child
run.

Everything then works for free, and that is the argument for it: excalidraw
draws it in the editor, `moodboard-export` exports it, `renderForModel` draws it
with no new code, and autosave, undo, the revision guard and `page-duplicate` all
already know what a rectangle is.

What it costs is bookkeeping, and every piece of it has to land or the rectangle
becomes an object in its own right:

- **It is not an object.** `readableItems` excludes it. It reads instead as a
  `background` field on the page object it belongs to — which is where a model
  looks for it, and which cannot be grabbed, moved or reordered by accident.
- **It is refused by name.** `remove_from_canvas`, `transform_on_canvas` and
  `restyle_on_canvas` each refuse it toward `set_page_background`, the way a
  bound label is refused toward its container.
- **It stays at the back.** `reorder_on_canvas`'s `back` means "back, above the
  page background" — a photograph sent to the back of a page must not land under
  the colour the page is painted.
- **Tidy must skip it.** `arrangeableUnits` collects every live element with an
  id, so today a page background would be swept into the photo grid on the first
  press of tidy. It needs the exclusion the same way frames have one.
- **`resize_page` resizes it**; `duplicate_page` and `discard_page` already carry
  it, because both work on the page's geometric members and its centre is the
  page's centre.
- **One per page, and `"none"` removes it.** Setting a colour twice recolours the
  rectangle rather than stacking a second; clearing it drops the element rather
  than leaving a transparent rectangle in the child run for the next read to
  wonder about.

**`set_page_background`** `{ boardId, pageId, colour }` — a hex or `"none"`. Both
agents get it: agent 6 because it owns the page tools, agent 8 because a page's
ground is the first decision in most of what it is asked to make.

**It is a user control too**, on the inspector beside palette, caption and crop
(§V), offered when the selection is a page — one implementation under
`lib/pages`, per invariant 12. The board's background already has a user control
(excalidraw's own, kept in `BoardMenu`); the page's has neither, which is what
makes it the one worth adding on both sides at once.

**Built in full — the element, the exclusions, the tool and the user's own
control — and what this section got wrong.** The rectangle, the mark, every
door that has to know about it (`lib/pages/page-background.ts`),
`set_page_background` itself — one executor in `server/pages/tool-pages.ts`,
one declaration, reached by agent 6 in `server/agents/orchestrator/tools.ts` and by agent 8
in `server/agents/designer/page.ts` — and the inspector control that closes the
stage (`board-background.ts`, the panel in `moodboard-inspector.tsx`, the page
kind in `moodboard-selection.ts`; see §V). Nine things the design above did not
say, five more the wiring settled, and four the user's half did:

- **The ground is `locked`.** §XI.4 does not mention it and the editor makes it
  obvious the moment a page has one: a filled page-sized rectangle at the back
  of every page is what every click on empty page lands on, so unlocked it is
  the first thing the user selects and the last thing they meant to. Locked is
  what "changed from the inspector and nowhere else" already means everywhere
  on this canvas, and it buys tidy a second exclusion for free.
- **`arrangeableUnits` does not "collect every live element with an id".** Its
  own loop is `if (element.type !== "image") continue`, so the ungrouped sweep
  this section calls the miss that costs the most *cannot happen* — a page's
  ground is never a unit by that path. The one way in is a user-made group
  holding an image, and the exclusion is the frame rule said again: a group
  carrying the page's ground sits the tidy out whole.
- **One exclusion at `boardItems`, not one per page read.** The mark is asked
  once, in the reader §XI.5's opt-in goes through, and that single line covers
  the page brief's blocks, the digest's `shapes` count and — the trap §XI.5
  named — `pageCarriesShapes`. So the day the setter lands, agent 4 can still
  compose onto every page "Let's Vibes" paints, which is the whole of that trap.
- **One exclusion at `readableTarget`, not at `readableItems`.** Stage 1
  exported the read's own answer to "what has a handle" and stage 1's own
  finding was that a shared predicate does nothing until every caller asks it.
  All six write doors ask this one, so the ground is unaddressable at all of
  them by the same edit that takes it out of the object list.
- **The three refusals still have to come first.** `readableTarget` drops the
  ground, so a refusal placed after the handle question answers `notFound` — the
  bound-label loop at a third door, and the same ordering stage 1 had to fix in
  transform and reorder. Remove, transform, reorder and restyle all ask the mark
  before anything else.
- **`reorder`'s `back` is one predicate, not a new branch.** The destination
  already resolves to "immediately before the page's first child"; the first
  child is now the first child that is not the ground.
- **`resize_page` looks the ground up against the rectangle the page *was*.** A
  page shrunk to a fifth leaves the old ground's centre outside the new rect, so
  a lookup taken after the resize finds nothing and leaves the page painted at
  its old shape. It is also the one exception to "a resize moves nothing", and
  it is not one: the ground is not a thing on the page, it is the page.
- **`pageBackground` needed nothing.** Stage 0 already made the backdrop rule
  take the back-most *non-shape* element, for the scrim case — and that is
  exactly what stops a painted page from losing the photograph it stands on.
  This section predicted that and the fix was already in.
- **Membership is written locally, five lines of centre-in-rect.**
  `board-contents` has to ask `isPageBackground`, and a module that asked
  `board-pages` back would close a cycle over the whole page layer. It is §V.3's
  rule either way, which is what makes `duplicate_page` carry a copied ground
  onto the copy the moment it lands rather than once something re-hangs it —
  verified rather than assumed, along with `discard_page` taking it off.

And what the tool itself settled:

- **One declaration, and it is the first of the shared page tools that is not
  forked.** `duplicate_page`, `resize_page`, `move_to_page` and `discard_page`
  each carry a second description for agent 8 (`DESIGNER_*` in
  `lib/agent/designer-tools.ts`) because agent 6's words send the model to
  `inspect_board` or warn it off `compose_moodboard` — tools agent 8 has not
  got. This one sends the model to `read_canvas`, which **both** agents hold and
  which is also where a page's `background` is read (§XI.1), so the sentence
  that is true for agent 6 is the same sentence that is true for agent 8. The
  fork rule was never about sharing an executor; it was about which tool the
  description names, and this is the first page tool whose answer to that is one
  name for both.
- **The gate is the boards count, not a pages count.** §VI of
  `orchestrator-tool-reference.md` says `pages > 0`; `ProjectState` carries no
  such count and never has. Every other page tool sits in the `boards > 0` block
  for the plainer reason that a page id can only come from a board, and this one
  joins them there.
- **Until this landed, four doors refused toward a tool nobody held.** Remove,
  transform, reorder and restyle have named `set_page_background` since the
  element was built, which is exactly the trap §XI.2's build noted about the page
  refusal — a refusal pointing at a tool the model does not hold is a round spent
  on an unknown-tool error. The wiring is what makes those four refusals worth
  their tokens.
- **The answer's status line carries the readability warning, not just the
  colour.** Nothing on the page moves when it is painted, and the ground goes
  *behind* what is already standing there — so near-black lettering on a page
  just painted near-black is a page that looks emptied without anything having
  left it. That is the one fact the counts in the result cannot carry and the
  model cannot see, so the sentence says it every time a colour is set.
- **A word for a colour is refused, never guessed at.** `setPageBackground`
  returns null for anything that is neither a hex nor `"none"`, and the door
  answers with the word the model used. Painting the page grey because "warm
  sand" did not parse is a page the model has to be told about twice.
- **The occupancy read needed nothing either.** `bandOccupancy` already counts
  any draw covering `BACKDROP_COVERAGE` of the rectangle as a backdrop and
  leaves it out of the ink, so a painted page does not come back at 100% inked
  and `standingNote`'s bands still describe what somebody put there. Written for
  a full-bleed photograph; correct for a ground with no edit at all.

And what the user's half settled:

- **The selection had to grow a fourth kind before the panel could open.**
  `BoardSelection` was three cases, all of them about references, and a page
  selected on its own resolved to `none` — which is the panel returning null.
  So "offered when the selection is a page" is a change to
  `moodboard-selection.ts` first and to the panel second, and the page case
  carries what the panel needs off the same walk: the name, the colour it
  stands on, and the references standing on it.
- **References win over the page, always.** A photograph selected while it sits
  on a page is a selection about the photograph — the page is what it happens
  to be standing on — so the page case is asked only once the reference cases
  have said nothing. The reverse order would have taken the properties panel
  away from every photograph on every page.
- **The panel is re-derived on the settle beat, not only when the selection
  changes.** Painting a page moves neither the selection nor its signature, so
  the guarded `onChange` branch that resolves the selection never fires for it
  and the panel would go on saying the colour the page *was* — including the
  "No background" button, which would offer to clear a page standing on
  nothing. `collect` now re-resolves behind `sameSelection`, which is also what
  makes ⌘Z arrive in the panel.
- **A colour picker is a drag, and a drag is a write per frame.**
  `input type="color"` fires on every pointer move inside the OS picker. Each
  one repaints the page — that is the point, the user is choosing against the
  real page — but each one is also an undo step unless it is written with
  `CaptureUpdateAction.NEVER` and committed once on release. The swatches have
  no such problem and commit immediately.

#### 5. Every read that has to widen

The user's ask was "the other tools need to read them too", and this is the list.
A style dialect that only the tool that wrote it can see is worse than no dialect:
the next read tells the model the page is empty where it just put a colour field.

| read | what changes |
|---|---|
| `read_canvas` | the fourth kind; `background` on each page object; the `unaddressable` remainder |
| `inspect_board` | page contents count shapes as well as images and lines, and say the background |
| `get_page` / `PageAIRepresentation` | `PageBlock` gains `kind: "shape"` and the page line carries its background (tech-spec §V.4) |
| `pageBrief` / `blockBrief` | the same, since agent 4 reads a page through them |
| `objectShape` | a rectangle is a legitimate opening to cut a photograph to — the crop path already speaks ratios and needs nothing new |
| `render-plan` / `rasterise` | **nothing.** All three shapes are already drawn, which is why this is a read problem and not a rendering one |
| `moodboard-export` | **nothing.** Excalidraw exports its own elements |
| `arrangeableUnits` | shapes stay out of tidy — a colour block is not a photograph in the grid — and the page background is excluded outright (4) |

Two behavioural consequences worth deciding here rather than discovering:

- **A page carrying shapes does not stand as composed.** `compose_moodboard`'s
  seated rebuild re-assigns free slots on a page that still matches the layout it
  was built from; a page with a colour block on it does not match anything, and a
  rebuild would lay photographs over ground somebody put there deliberately. It
  routes to edit-in-place — nothing moves — which is what that path is for.
- **`PAGE_BLOCK_CAP` stays at 24** and shapes compete for the same twenty-four.
  The omitted count already says what did not fit, and raising the cap to make
  room is a page-brief budget change, not a shape change.

  *Amended — the cap stays at 24 and the count still says what did not fit, but
  "what did not fit" was a region of the page rather than a set of blocks.* The
  competition this bullet decided is real and arrived exactly as predicted: 10 of
  the 82 pages on the development database are over the cap and 72 blocks go
  undescribed, and every one of them is on a page agent 8 drew shapes and free
  type onto. What the bullet did not ask is *which* two dozen survive. They were
  the first two dozen in reading order, and reading order runs top to bottom, so
  the cut is a horizontal line across the page: the two densest pages here — 44
  and 49 blocks — described 16 and 18 blocks from the top third, 8 and 6 from the
  middle and **none at all** from the bottom third that twelve blocks stand in.
  The fix is `byReach` (`lib/pages/page-blocks.ts`), which spends both the cap
  and the brief's character budget on the blocks that reach furthest across the
  page and says them in reading order as before: the same two pages come out
  7/7/10 and 9/7/8 across the thirds. Measured by the longer side rather than the
  area, because a rule is a `line` nine hundred wide and none high — 102 of the
  905 blocks on this database have no area at all, and an area rule would sort
  every rule on a page below every caption.

**Built (the page reads), and what the list above got wrong.** Stage 0 landed
`read_canvas`' fourth kind and stopped there, so for three stages agent 8 drew
scrims and rules onto pages whose own brief — the text riding under every page
picture it is handed — described them as empty room. That is invariant 13 at the
page door rather than the canvas one, and it was live from the day
`put_on_canvas` grew a shape kind. Five things the table did not say:

- **The fourth kind arrives by an opt-in on `boardItems`, not by widening it.**
  `boardItems(elements, { shapes: true })` is one reader in the array's own
  order, so a shape's `z` is its real place in the stack; the default stays
  exactly what it was. It has to be opt-in: `placeOnBoard`'s house size,
  `standsAsComposed`' seating and `boardContents`' counts all count what they
  are handed, and a scrim offered to a template as a block to seat is the
  failure `pageBackground` is lifted out of the picture list to avoid.
- **`pageBackground` had to stop reading `z === 0`.** The backdrop rule is
  "back-most, covers the page, and the page holds something else", and with
  shapes in the list the back-most thing on a page with a scrim under the
  photograph is the scrim — so the photograph the page is standing on stopped
  being reported as its background. It now takes the back-most element that is
  not a shape. That also pre-decides (4): once a page's ground is an element it
  is at the very back of every page, and read on `z` alone it would have taken
  the backdrop off every page in the app.
- **The chip under the composer counts blocks, so it counts shapes.**
  `pageChoiceNote` is not in the table and says "5 blocks" beside a page the
  user is choosing; its own comment is that the picker and the prompt must not
  disagree about one rectangle. A page whose ground is a colour block is three
  blocks to the model and had to be three on the chip.
- **The miniature steps over them.** `scenePreview` draws a slot's worth of
  picture or of type and `SlotKind` has no third value; a preview is not a read
  and nothing was gained by inventing one.
- **`objectShape` needed nothing, as the table says** — it reads `canvasObjects`,
  which has carried shapes since stage 0. Pinned with a test rather than left as
  a claim.

**Built (the routing), and the one thing it could not be.** A page carrying
shapes now takes `compose_moodboard` down the edit-in-place branch, and the whole
of Stage 0 is landed. Three things the decision above did not say:

- **It is not `standsAsComposed` answering no.** Folding the rule into that
  predicate was the obvious build and is wrong twice over: the pictures on a page
  with a colour field under them *are* all still sitting in their slots, so the
  answer would be a lie about the only thing that function is asked; and it is
  asked in six other places — the tile beside every reply, `get_page`, the
  attached page (§V.4's `layout?`) — which would all quietly stop naming the
  template of a page that is still standing in it. The routing asks
  `pageCarriesShapes(elements, pages, page)` *beside* the seating question
  instead, in `page-compose.ts` where the compose's other page reads live.
- **Never on a page of its own.** `newPage: true` draws an empty page, and the
  compose reads the board flat when it has no page frame at all — so the
  predicate takes a null page meaning "the whole scene", exactly as `onPage`
  does, and is not consulted at all for a fresh page.
- **An arrow is not ground.** The predicate reads the three kinds §XI.1 carries
  and nothing else, so a board somebody has drawn an arrow across is laid out
  again exactly as it was before shapes were readable. The `unaddressable`
  remainder and this rule agree about what a shape is, which is the point of
  having one list.

**What it changes on real boards: one page of forty-seven.** `npm run
design:pages` over the nineteen boards on the development database finds a single
page carrying shapes — *Amara & Ines Welcome Sign*, `1 image, 4 shape, 4 text` at
391% ink, the page two live design runs drew on. That page is the only one in the
app whose next `compose_moodboard` edit routes differently than it did yesterday,
which is the honest size of this decision today and the reason it had to land
before agents draw at volume rather than after.

**A trap for §XI.4, named here because this is where it fires.** The page
background is a `rectangle`, so on the day `set_page_background` lands, *every*
page carrying one is a page carrying a shape — and agent 4 could never compose
onto a page whose ground had been set, which is every page "Let's Vibes" makes
(§IX.2 sets the theme colour on all N before the first design call). The
exclusion list in (4) has to reach this predicate as well as `readableItems`:
a page's own ground is not ground somebody drew *on* the page.

**Amended — the widening did not stop at the reads.** Every row of the table
above is a read, and the list was right about which ones had to grow. What it
could not have said, because `contrastRead` did not exist when it was written, is
that the dialect also made a *write* able to say something it never could: the
five canvas writes now report the type they left standing too close in colour to
what it is on (`object-legibility.ts`, compositor-v2.md §VIII). It is the same
arithmetic `get_page` says as a state, taken at the door as a change — only the
pairs this call, and no earlier one, put beyond reading — so a call that leaves a
bad pair exactly as bad as it found it says nothing. All five ask it because all
five can cause it and only one of them is about colour: a put lays the ink down,
a restyle sets it or repaints the block a dozen lines stand on, a transform walks
a line off the card it was legible on, a reorder puts a block between the two,
and a removal takes the card out from under it. The addressability filter is
`readableTarget`'s own answer rather than a second one, so a bound label's pair
is never the id a door offers back — this table's `read_canvas` row and that
filter are the same rule at two doors.

**Corrected — every read of a `fill` was reading a colour the picture does not
paint.** The table's `render-plan` / `rasterise` row says *nothing* changes, and
that is right about the three shapes; it is wrong about the one column all four
reads take from the renderer. `shapeAppearance` returned `backgroundColor`
whatever the element was, so an open `line`, an `arrow` and a *frame* each
reported a fill — while `rasterise` drew every path `fill="none"` and every frame
in `FRAME_STYLE`. So `read_canvas` offered a colour on a rule that
`restyle_on_canvas` refuses by name (§XI.2), the page brief described a hairline
as a colour field across the page, and `contrastRead` composited a line's stored
colour as the ground under any type standing in its bounding box. Three doors
disagreeing with the picture beside them, from one assumption.

The rule is excalidraw's own and now lives once, as `paintsInside`
(`lib/render/render-plan.ts`): a rectangle, an ellipse and a diamond always
paint; a `line` or a `freedraw` paints only when its path closes (`isPathALoop` —
three points or more with the ends within eight scene units); an `arrow` never
does; a frame never does, which is §XI.4's whole premise arriving as code rather
than as a comment. `shapeAppearance` asks it, so the plan, the object read and
the page brief's blocks inherit one answer, and the rasteriser stopped carrying a
frame rule of its own.

The correction runs the other way too, and this half is a *renderer* fix rather
than a read one: a closed loop drawn with the line tool is a filled polygon in
excalidraw's own export and was an outline here, so a user's colour block came
back to the model as empty page. The polyline now takes whatever fill the plan
left on it. This is the class compositor-v2.md §III.2.1 exists to catch, found by
reading the export's own shape generation rather than by `render:check` — which
could not have found it, because the comparison only runs on boards a browser has
exported and no line on this database carries a fill at all (108 lines, every one
`transparent`; 84 frames, every one `transparent`). Nothing on the development
database moves: `render:check` is byte-identical across five boards and
`design:pages` reports the same 214 of 601 contrast pairs. The defect is one
toolbar click away rather than hypothetical — excalidraw puts the current
background colour on *every* new element, lines and arrows included.

**Corrected again — the table is a list of reads, and it was a list about the
fourth kind.** Every row above says what changes *for a shape*, and every row
landed. What none of them says is that the dialect §XI.2 gives both doors is ten
fields on three kinds, and only five of the ten were ever read back. A line of
type carried its words and its box and nothing about the type: not the ink it is
set in, not the size, not the family, not the alignment — while
`restyle_on_canvas` writes all four and the picture beside the list draws all
four. And `opacity`, the one field §XI.2 puts on three kinds and names the image
case of *first* ("a photograph at 40% is a scrim with nothing added to the
page"), was read off the shape alone at both page doors.

That is invariant 13 on the kind this product writes most of, and it is the
same shape of defect the `fill` correction above was: one reader with a question
nobody asked it. The reads now take `textAppearance` (`render-plan.ts`) beside
`shapeAppearance` — the renderer's own defaulting, so a headline the picture
draws in `#f2e8dc` cannot be listed in excalidraw's near-black — and the fade is
read off `elementOpacity` on every kind at `boardItems`, `pageBlocks`, the page
brief's line and `read_canvas`. Four things the build settled:

- **The family is a word and the read had no table for it.** `object-style`'s
  `FONT_FAMILIES` is the vocabulary half and stays that way; what it gained is
  `fontNameOf`, the same table read backwards, so a name the read says is a name
  `restyle_on_canvas` takes. 9 is in it and is not in the forward table:
  excalidraw draws 2 and 9 from the same Liberation files, so a block carrying 9
  is set in `sans` and saying so is the truth about the picture.
- **Absent means the default, and `"other"` means there is no word.** `font` is
  absent for the hand family a put with no `font` lands in and `align` is absent
  for type set left, the rule `strokeStyle` and `rounded` are already read by —
  a field on every line is a default rather than a fact. Excalidraw's older
  faces (1 Virgil, 8 ComicShanns) have no word in this dialect and no door here
  writes one, but a scene pasted in from excalidraw.com carries them, and
  reported absent they would read as the hand they are not. They read `"other"`.
  A family the mirror has no files for at all is reported as the one it is
  *drawn* in, because that is what the picture shows.
- **The page brief does not grow the type, on its own standing rule.** Its shape
  line already says why: what a restyle takes is `read_canvas`', what an
  arrangement is made of is the brief's. A colour and a family are the first;
  the fade is the second, because what a scrim is over is still on the page. So
  the brief gained `40% opaque` on a photograph and a line of type and nothing
  else, and the pairs a reader has to act on go on arriving through the
  legibility note (compositor-v2.md §VIII).
- **What it costs and what it says.** `read_canvas` 364 → **390** declaration
  tokens (+26, the same +26 on both floors: agent 6's boards shape 15,136 →
  15,162, agent 8's 10,503 → 10,529), and the description now names the four
  type fields and sends the model here before a restyle as well as before the
  other three writes.

**What it says on real boards, which is how big it was.** The 30 boards on the
development database hold **616 text objects**, and every one of them now says
its colour, its size and — when either is a choice somebody made — its family
and its alignment: **57 distinct inks**, four families (`sans` x299, `mono`
x167, hand x108, `display` x42), `center` x371 and `right` x14, sizes from 12 to
230 with a median of 16. **12 of the 30 boards set more than one family**, so
"are these two headings in the same face" was a live question on two boards in
five and was unanswerable from any read. The fade is the other way round and
latent: 22 elements on the database are under whole and every one is a rectangle
or a line, so the widening buys nothing today and closes the exact case §XI.2
names first. Nothing the plan reads moved — `render:check` is 1 AGREES / 4 CLOSE
unchanged, and `design:pages` reads the same 85 pages, 212 of 608 contrast pairs
— which is the point: this was a read problem, twice.

#### 6. What this costs at the door

The canvas five are already **2,080 declaration tokens** and the largest single
addition in `orchestrator-tool-reference.md`'s history (§IV). This adds a sixth
tool, nine style fields to `put_on_canvas`, and two background tools — on the
boards shape, which already carries the highest floor in the app.

Measure it with `npm run floor` before and after, on the same project, the way
every other change to that file was measured. The read half alone came to
**+63 tokens** — `read_canvas` 301 → 364 for the fourth kind's fields and the
remainder's sentence — taking the boards shape from 13,090 to **13,153** and
agent 8's own floor from 8,280 to **8,343**. Both background tools are gated
narrowly for this reason — `set_canvas_background` on `boards > 0`,
`set_page_background` on `pages > 0` — and if the floor has to come down, the
style fields on `put_on_canvas` go first: a line can always be placed and then
restyled, and `restyle_on_canvas` is the tool that cannot be replaced by two
calls to something else.

**Measured, as each of the four landed.** The read half +63 (13,090 → 13,153);
`restyle_on_canvas` and the style fields on `put_on_canvas` took the shape to
14,328; `set_page_background` +373 to 14,701; `set_canvas_background` +290 to
**14,991**. Agent 8's own floor stopped at **10,503** — it holds five of the six
canvas tools and the page's ground and not the board's, which is the whole
saving the split in (3) buys. Nothing had to come down: the cut order above is
still the cut order, and still unused.

One correction to the gating above, found by the build: **there is no
`pages > 0` gate and never was.** `ProjectState` counts photographs, crops and
boards and nothing else, so `set_page_background` is on the boards gate with
every other page tool — for the plain reason that a page id can only come from
a board.

## XII. Constants

| What | Value | Where |
|---|---|---|
| Drop size (longest edge) / gap | 320 / 24 | `moodboard-drop` |
| Arrange gap / frame padding | 24 (same constant) | `moodboard-arrange` / `-frames` |
| Tidy change threshold / frame-fit bisection | 0.5 / 20 steps | `moodboard-arrange` |
| Colour thresholds (sat, lightness) | 0.15, 0.08–0.95 | `moodboard-order` |
| Caption gap / width divisor / font / length | 12 / 16 / 12–36 / 60 | `moodboard-caption` |
| Swatch w×h / bar limit / ink threshold | 96×128 / 8 / 0.179 | `moodboard-palette` |
| Crop min trim / JPEG quality / title | 0.5% / 0.92 / 200 | `moodboard-crop` |
| Autosave debounce / max wait | 900 ms / 6000 ms | `moodboard-autosave` |
| Scene limits | 5000 elements / 2 MB | `moodboard-scene` |
| Zoom clamp | 0.1–30 | `moodboard-scene` |
| Board render cap / padding / delay | 1600px / 24 / 20 s | `moodboard-render` |
| Image pixel ratio / thumbnail edge | 2 / 640 | `moodboard-resolution` |
| Export scales / default | 1–3× / PNG 2× bg on | `moodboard-export` |
| Library limits | 300 items / 2 MB / name 200 | `moodboard-library` |
| Board title limit | 200 | `moodboard-boards` |
| Page presets | 1920×1080 / 1080×1920 / 2048×2048 | `moodboard-layouts` |
| Page gap / reading bands / block cap | 120 / 10 / 24 | `moodboard-layouts` / `board-pages` / `page-blocks` |
| Pages per message / brief budget | 2 / 3000 chars | `page-brief` |
| Compose block limit / text blocks | 12 / 2 | `moodboard-compose` |
| Layout slot counts | 2–9 images, ≤2 text | `moodboard-layouts` |
| Slot fill floor / gain | 0.8 / 0.1 | `slot-fit` |
| Cross-project locate cap | 500 | `moodboard-images` |
| Vibes run: pages / palette / text | 6 / 5 / 200 | `compositor-v2.md` §IX.4 (designed) |
| Shape defaults (fill style, roughness) | solid / 0 | `object-style` |
| Type families named to the model | 5 of 8 | `object-style` `FONT_FAMILIES` |
| Text font ceiling — derived box / explicit | 96 / 512 | `object-put` / `object-style` |
| Stroke width ceiling | 100 | `object-style` |
| Restyle batch cap | 10 | `object-restyle` (designed) |

## XIII. Invariants

1. **Array order is z-order** and is stored verbatim; a frame's children sit
   immediately before it.
2. **Images are pointers** (`ref:`), bytes live in GCS, and the pointer only
   resolves inside its own project — every foreign image is adopted or drawn
   as a placeholder, never silently kept as unloadable bytes.
3. **Sections own by `frameId`; pages own by geometry (centre, topmost
   wins).** `frameId` is only ever rewritten toward geometry.
4. **Every layout operation is idempotent**: tidy, colour tidy, ownership
   reconciliation and template re-composition read back their own output as
   a fixed point, so a repeat press is not an undo step that did nothing.
5. **Locked means "not by accident"**: excluded from tidy (including its
   whole group), captioning and crop-keeping.
6. **Contain, never stretch**: every fit preserves aspect ratio; making a
   photo fit a shape is a crop, which is agent 3's job. Unknown size lands
   square at 320 or takes the whole slot — never guessed.
7. **Refuse, never truncate** at every byte/count limit, and **nothing is
   dropped silently** — every operation reports its remainder (`omitted`,
   `notOnBoard`, `unplaced`, banner + retry on the canvas).
8. **One writer wins**: every scene write is revision-guarded; conflict stops
   the autosave until reload and turns an agent's write into an "ask again"
   result. Renames that change no pixels bump nothing.
9. **Programmatic edits are ordinary edits**: placed palettes, captions,
   pages and tidies land as plain elements under one undo step — except
   repoints (adoption, kept crops' file swap), which are
   `CaptureUpdateAction.NEVER` so undo cannot restore an unloadable state.
10. **A picture is labelled with the revision it is of**: board renders are
    disowned by every visual write and retaken on idle; page renders are
    immutable per revision; a stale picture is dropped rather than shown.
11. **Same-origin in, `data:` out**: the board loads images through the app
    so canvases stay readable; exports inline real bytes so the file stands
    alone anywhere.
12. **User gestures and agent tools share one implementation** in `lib/` —
    same membership rule, same layout math, same naming — so neither can
    drift from what the other reads.
13. **What the model can see, the model can read** (designed, §XI): an element
    the renderer draws as itself is either an object with a handle or is named
    in the answer's `unaddressable` remainder. A picture carrying something the
    geometry read is silent about is the one disagreement neither side can
    detect.
14. **A page's ground is an element, not a field** (designed, §XI): backgrounds
    are drawn by excalidraw itself, so what the model is shown and what the user
    exports cannot come apart. The rectangle is never an object — it reads as the
    page's `background` and every write refuses it toward `set_page_background`.
