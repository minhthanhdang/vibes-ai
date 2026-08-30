# MOODBOARD

Product spec item 7's centre: the canvas a user actually composes on, and
where agent 4 writes. Excalidraw is embedded (`@excalidraw/excalidraw`), not
reimplemented — its element model, hit-testing, transform handles and undo
stack are years of work, and every hour spent rebuilding them is an hour not
spent on the thing that makes this product different (references with analyzed
properties on the board).

## I. What embedding gives us

Free the moment the component mounts. Nothing to port; the work is turning the
ones marked *wire* on where they are off by default or need our data.

- Select, multi-select, marquee, move, resize from any corner, rotate.
- Z-order (front/back/forward/backward), lock, duplicate, delete.
- Group/ungroup — *wire*, and for the same reason frames were: a group is
  maintained only by excalidraw's own pointer handlers, so §II.8's tidy read
  each photo on its own and pulled every group on the board apart. It is the
  layout's unit now. See §II.10.
- Align and distribute; snapping to objects and to the grid; grid mode. Both
  align and distribute leave every element the size it already is, so neither
  lays a set of photos out as a moodboard — that is §II.8, and it is a feature
  excalidraw does not have rather than one it has switched off. Nor can either
  of them order a set of photos by what is *in* them, which is §II.8's second
  half.
- Pan, zoom, zoom-to-fit, zoom-to-selection.
- Undo/redo, copy/paste — *wire*: pasting an image, dropping a file from the
  desktop and the toolbar's image button all put bytes in excalidraw's own
  files map, which the board row does not store. Copying an *element* between
  boards is the same defect wearing our own pointer: excalidraw carries the file
  entry along, so it draws, but a `ref:` id is resolved against the board's own
  project and across projects it resolves to nothing. See §II.3's second half.
- Dropping an image dragged off another web page — *not supported by excalidraw
  at all*: it reads a dropped URL as an embeddable, and for anything that is not
  one of the handful of providers it recognises, nothing happens. Ours now
  imports it. See §II.3's third part.
- Pasting an image copied off another web page — *supported by excalidraw and
  broken in practice*: it fetches the URL from the browser, and an image CDN
  answering a cross-origin `fetch` without `Access-Control-Allow-Origin` turns
  every such paste into "failed to fetch image". Ours imports it through the
  same server fetch the drag uses. See §II.3's third part.
- Shapes: rectangle, diamond, ellipse, arrow, line, freedraw, text, frames.
  Frames are *wire*: excalidraw ships the tool, the name and the membership it
  assigns when an element is dragged in, but membership is only ever maintained
  by its own pointer handlers — so every edit this board makes from outside the
  editor (the sidebar drop, the web import, the tidy) had to be taught what a
  section is, or it destroyed one. See §II.9.
- Stroke/background colour, fill style, stroke width and style, roughness,
  opacity, corner rounding, font family/size/alignment, arrowheads.
- Image elements with crop, and text bound to a container. Crop is *wire*:
  excalidraw's crop is a window onto the whole file and stays one forever, so
  the part the user cut away is still what the gallery shows, what agent 2
  reads a palette off, and what the board downloads to draw a corner of. A crop
  can be kept as a reference of its own now. See §II.11.
- Links on elements, laser pointer, view mode, zen mode.
- Export to PNG/clipboard and `.excalidraw` — *replaced*: exporting a board
  is drawing it to a canvas and reading the pixels back, which a board whose
  photos came through the bucket redirect cannot do at all (§II.6's first
  bullet). And once it could, what it drew was wrong — excalidraw exports from
  the editor's own file map, which holds each photo at the size the *board*
  draws it and holds it as a URL only this app can serve. So the export is ours
  now, from the same machinery; see §II.6's last part. SVG has since been
  withdrawn and the export is a PNG or the clipboard — also §II.6. The same
  machinery, called from our own code rather than from any dialog, is what gives
  every board a stored picture of itself — see §II.7.
- Text in excalidraw's own hand-drawn fonts — *wired*: the package's fonts are
  mirrored out of `node_modules` into `public/excalidraw-assets` and
  `window.EXCALIDRAW_ASSET_PATH` points at them, so text no longer depends on
  esm.sh being reachable. See §II.6. Xiaolai (the CJK fallback) still comes
  from the CDN.
- Element library (`.excalidrawlib`) — *wired*: the editor holds its library in
  memory only, so "Add to library" survived exactly as long as the tab. It is
  stored on the project now and shared by its boards. See §II.6.

## II. What is ours to build

The list this run works through, in order.

1. **Persistence.** `Moodboard.elements` / `appState` hold the scene; `revision`
   guards two tabs autosaving over each other. Image bytes are never in the
   row — an image element's `fileId` is `ref:<Reference.id>` and the load
   hydrates a signed URL for it. *(done — `src/lib/scene/moodboard-scene.ts`,
   `moodboard` router.)*
2. **The canvas surface.** Excalidraw mounted in the workspace, loading a
   scene and autosaving a debounced one back. *(done — `MoodboardPanel` /
   `MoodboardCanvas` behind the workspace's References/Moodboard switch,
   `src/lib/scene/moodboard-autosave.ts`.)* Two things it settles:
   - `onChange` fires per frame of a drag, so it only parks the editor's arrays
     in a ref; the scene is walked once per quiet period (900 ms, forced at
     6 s) and only then compared against what the server holds.
   - A save the server refuses on `revision` is a conflict, and a conflict
     stops autosaving instead of retrying — the way out is reloading the board,
     which remounts the editor with the other tab's scene.
3. **Drag a reference from the sidebar onto the board.** Drop lands an image
   element centred on the pointer, sized to the reference's aspect ratio.
   *(done — `src/lib/canvas/moodboard-drop.ts`, the sidebar tile's `dragstart`, the
   canvas wrapper's capture-phase `drop`.)* What it settles:
   - The drag carries `application/x-director-reference` — an id and a pixel
     size, never bytes or a URL. A drag without that type is left entirely
     alone, so files dropped from the desktop still reach excalidraw's own
     handler.
   - Handled in the **capture** phase and stopped there. Excalidraw's drop
     handler is a React `onDrop` on its own container, which bubbles *after*
     an ancestor's capture handler — so a capture handler on the wrapper is
     what gets first refusal without patching the editor.
   - Every reference lands at the same longest edge (320) rather than at its
     own resolution: a moodboard is about arrangement, and a 6000px photo
     dropped at source size is the whole canvas.
   - The element is `status: "saved"` on arrival, not excalidraw's default
     `pending`. Pending means "bytes not in the files map yet", and ours never
     are — the load rebuilds the file entry from the `ref:` pointer every time.
   - `MoodboardCanvas` is now what `next/dynamic` defers, rather than the
     editor inside it, so the drop can use excalidraw's own
     `convertToExcalidrawElements` without pulling 1.5 MB into the first
     payload.

   **A drag is a set, not a photo.** *(done — `decodeReferenceDrag` /
   `droppedImages` / `draggedReferenceIds` in `moodboard-drop.ts`, the sidebar
   strip's modifier-click selection.)* What it settles:
   - Building a board is choosing a handful of photos; dragging them one at a
     time is the same arrangement done six times, and each one lands on top of
     the last unless the user moves it first. The payload is a list, and a
     drop of one is the same code path as a drop of six.
   - The batch lands as a grid centred on the cursor — cells of the drop's own
     longest edge plus a gap, as square as the count allows, the short last row
     centred under the rows above. The alternative is a stack that has to be
     pulled apart before it can be read.
   - The whole batch arrives selected and is one undo step, because it landed as
     one action: the next thing a user does with six photos is move them
     somewhere together.
   - Modifier-click builds the set, plain click still opens the properties panel
     and clears the set. Selecting to *drag* and selecting to *read* are
     different questions, and the strip has to keep answering the second one.
   - Dragging a tile inside the set takes the set; dragging one outside it takes
     just that tile. The order is the strip's, not the click order — the badge on
     each picked tile is its place in the grid the drop will build.
   - The list crossing `dataTransfer` is parsed per entry: an unusable one is
     skipped and the rest still land, since five photos arriving is closer to
     what was asked for than nothing. A repeated id is one image, and an id whose
     reference has since left the strip does not drag at all.

   **Images excalidraw lands itself** — a clipboard paste, a file dragged off
   the desktop onto the board, the toolbar's image button. *(done —
   `src/lib/canvas/moodboard-images.ts`, `useBoardImageAdoption`, the upload path
   shared with the gallery in `upload-reference.ts`.)* What it settles:
   - Those routes put bytes in excalidraw's in-memory files map, and the row
     stores elements and appState only — so without this a pasted photo
     renders all session and reloads as an empty box. Every such image is
     *adopted*: uploaded into the project as a `Reference`, then its element
     repointed at `ref:<id>`, which is the one shape of image the load
     resolves. It also puts the image where a user looks for it next — in
     the project's references, queued for analysis like any other.
   - Adoption uploads through the same function as the gallery's dropzone, so
     the window between the PUT landing and the row landing — where bytes
     exist with nothing pointing at them — is handled in one place, not two.
   - Scanned on the autosave's quiet period rather than in `onChange`, which
     fires per drag frame, and every file id is marked attempted before the
     upload starts: otherwise the next quiet period re-uploads an image whose
     row is still in flight.
   - The repoint is `CaptureUpdateAction.NEVER` — not an edit the user
     made, and undoing past it would restore elements naming bytes the board
     cannot reload. Tombstones are repointed too, for the same reason.
   - A format the project cannot hold (SVG, HEIC) and a failed upload both
     surface as a banner on the canvas with a retry. The element looks exactly
     like one that saved, so silence would be the user finding out on
     tomorrow's reload.

   **A photo copied in from another project's board.** *(done —
   `unresolvedReferenceIds` in `moodboard-images.ts`,
   `reference.locateForProject`, the second half of `useBoardImageAdoption`.)*
   What it settles:
   - Copying an image element from one board and pasting it into another is
     excalidraw's own gesture, and it is how a look found on one film gets used
     on the next. It carries the file entry with it, so the photo draws — but the
     entry is a `ref:` pointer, and §II.1's load resolves those against *the
     board's own project*. Across projects it resolves to nothing, and the board
     reopens with an empty box. Same family as an unadopted paste, and harder to
     see: the pointer is exactly the shape a native one has, and only the project
     it names is wrong.
   - So the check cannot be a shape test. Every quiet period, the pointers the
     board holds that this session has not already confirmed are looked up, and
     the answer has **three** cases rather than two: in this project (keep), one
     of the user's own photos in another project (copy it in), or neither —
     deleted, or never theirs — which is the placeholder the gallery's own delete
     already decided about, and is left silent rather than turned into a warning
     about a photo that no longer exists.
   - A copy is an ordinary adoption: the bytes are read back from this app's own
     image route (same-origin, the property §II.6's first bullet exists for),
     uploaded into this project, and the element repointed — so the board that
     received the paste owns its photo, and deleting the source project cannot
     empty it. The original is fetched rather than whatever variant the board it
     was copied from was drawing: what lands in the project is the photo, not a
     thumbnail of it. It keeps its title, because a copy that arrives called
     "Board image" is one the user has to recognise all over again.
   - Confirmation is the server's, never the cached reference list. A photo
     dropped or imported seconds ago is in the project before any list says so,
     and reading a stale list as the truth would upload a second copy of a photo
     the project already had and repoint the board at it — a worse outcome than
     the defect. The board's own file map, which the server built, is the seed,
     so a board full of its own photos asks nothing at all.
   - An id neither answer covers is marked attempted, so a board holding a
     deleted reference costs one lookup on the session it is opened in rather
     than one per quiet period forever.

   **An image brought in off a web page** — Pinterest, Are.na, Behance, a search
   result — dragged onto the board or copied and pasted. *(done —
   `src/lib/intake/web-image-import.ts`, `src/lib/intake/remote-image.ts`,
   `src/server/references/remote-image.ts`, `reference.importFromUrl`,
   `useBoardWebImages`.)* What it settles:
   - This is how a moodboard is actually built, and it is the one route onto the
     canvas neither the sidebar drag nor adoption covers: what crosses is a *URL*
     and no bytes. Excalidraw reads a dropped URL as an embeddable, so on this
     board — where embeds are deliberately not ported — dragging a photo in from
     another tab did nothing at all.
   - The browser cannot turn that URL into bytes either: a cross-origin image
     renders but cannot be read back. So the fetch is the server's, and the
     result is an ordinary project `Reference` — the same row an upload makes,
     analyzed like any other, and reachable from the gallery afterwards.
   - Imported rather than hotlinked. A board of hotlinks empties itself as the
     pages behind it change, and its images would be cross-origin — which is
     exactly what §II.6's first bullet had to undo to make export work at all.
   - `text/html` is read before `text/uri-list`: dragging an image inside a link
     puts the *link* in the uri-list, and the `<img src>` is the only reading
     that is about the photo. An src from an `<img>` is trusted without an
     extension check (a CDN URL usually has none); a bare URL from the other
     types is only taken when the URL itself says image, so dragging an article
     link in does not fetch a web page as a photo.
   - Which URLs may be fetched at all is its own tested module, applied again on
     **every redirect hop** — a public URL that 302s to `169.254.169.254` is the
     whole attack, and `redirect: "follow"` would have made that request before
     anything could look at it. Private, loopback, link-local and carrier-NAT
     literals, credentials in the URL, non-http schemes and internal-only names
     are all refused, and a hostname is resolved and its addresses checked
     before the request. DNS rebinding between that check and `fetch`'s own
     resolution is the residual gap: closing it needs a dispatcher-level hook
     undici does not expose, and the content-type allowlist plus the byte cap
     bound what a winner of that race gets back.
   - The byte cap is applied to the body as it arrives, not only to the
     `content-length` — a length is a claim, and an origin that omits or lies
     about it would otherwise be allowed to fill the function's memory.
   - The same content hash the dropzone and adoption store, so the same photo
     saved from the web and later dropped as a file is one row — and dragging the
     same image in twice does not buy a second copy of it.
   - Dimensions are measured in the browser and sent with the import: an `<img>`
     can *load* a cross-origin image even though a canvas cannot read it, so the
     imported row gets the width and height an uploaded one has. An origin that
     blocks hotlinking measures as nothing and the image lands square, which is
     the same fallback a reference uploaded before the dimension columns has.
   - **Pasting is the same import behind a different interception.** Excalidraw
     does handle a pasted image URL, and it fails: the fetch is the browser's, and
     an image CDN that answers a cross-origin `fetch` without
     `Access-Control-Allow-Origin` — which is nearly all of them — makes every
     paste of a copied web image an error toast. So it goes through the same
     server fetch the drag does, and the same `ref:` element lands.
   - `onPaste` is not the seam: excalidraw returns *before* calling it whenever
     the clipboard carries HTML, which is exactly the case a copied image is. The
     interception is a capture-phase `paste` on the canvas wrapper — excalidraw
     listens on the document in the bubble phase, so a capture handler above it
     gets first refusal, the same shape as the drop's.
   - A paste is a drag with one difference: what is on the clipboard is as often
     *part of a page* as it is a picture. So an `<img>` fragment is only taken
     when the fragment is images and nothing else — a copied region with sentences
     in it still goes to excalidraw, which turns them into text elements, and
     taking it over would silently drop them. Plain text is read the way the
     uri-list is: every line has to be a URL that names an image, so a note with a
     link in it stays a note and an excalidraw scene on the clipboard stays a
     scene.
   - Pasted *bytes* are not ours: a screenshot or a "copy image" that puts a file
     on the clipboard is excalidraw's to insert and adoption's to store, and
     taking it over here would be a second upload path for the same photo.
   - Several images in one copied fragment land as the grid the sidebar's batch
     drag lands, at the pointer — so the import path takes a list, and an import
     of one is the same code as an import of six.
   - Still open: the context menu's and the command palette's own "Paste". Both
     read the clipboard themselves and hand excalidraw a synthetic event that is
     never dispatched to the DOM, so no listener of ours can see it. ⌘V is the
     paste this board takes over.
4. **Board management.** Multiple boards per project, rename, delete, switch.
   *(done — `src/lib/scene/moodboard-boards.ts`, the tab row's `BoardTab` in
   `MoodboardPanel`.)* What it settles:
   - A new board is named by the client, not by the column default. The
     database cannot see a row's siblings, so every board created by the
     default would read "Untitled board" and the tab row would be a line of
     boards the user cannot tell apart.
   - Rename and delete are optimistic, and delete picks what stays open
     *before* the row leaves the list — the board after the deleted one, the
     one before it when it was last, nothing when it was the only one.
   - A deleted board's scene is evicted from the query cache by hand: scenes
     are pinned with `staleTime: Infinity` so nothing else would ever drop it.
   - Both live in the tab itself rather than a menu or a modal — the whole
     control is a scrolling row of pills, and a dialog would be more chrome
     than the thing it acts on.

   **A board can be duplicated.** *(done — `duplicateBoardTitle` in
   `moodboard-boards.ts`, `boardRenderIsCurrent` in `moodboard-render.ts`,
   `moodboard.duplicate`, `copyBoardRender`, the tab's ⧉ and the canvas's
   `saveGateRef`.)* What it settles:
   - Composing a board is exploring a direction, and a second direction starts
     from the first. Without it the choice is overwriting the version that works
     or rebuilding it photo by photo — and this is the one board operation
     excalidraw cannot help with, since it knows about a scene and not about a
     list of them.
   - The copy is a plain new board — its own row, its own revision, its own
     autosave — and the scene is copied by value. Nothing is shared: an image
     element names `ref:<Reference.id>`, and a reference belongs to the project
     both boards are in, so the copy shows the same photos without owning or
     duplicating a byte of them. Editing either leaves the other alone, which is
     the whole point of having made it.
   - It is a copy of the **stored** board, so it waits for the autosave first.
     The canvas publishes a "the server now holds what is on screen" gate
     (`saveGateRef`): the duplicate cuts the debounce short and waits for the
     write to land, or the copy would be the board as of up to six seconds ago
     and the last thing the user did would be missing from it with no sign.
     A failed or conflicted save resolves that wait rather than hanging it —
     neither will land on its own, and the stored scene is then the best there
     is.
   - The copy inherits its source's picture, copied inside the bucket, but only
     when that picture is of exactly the scene being copied (`renderRevision ===
     revision`). A board is drawn by the tab showing it, and the copy is not
     open yet — so without this a duplicate sits in the tab row as an unlabelled
     blank until someone opens it. A stale picture is a picture of a board that
     no longer exists, and inheriting one would make the copy wrong from the
     moment it was made.
   - Named "X (copy)", then "X (copy 2)": duplicating a copy is duplicating the
     board, so the suffix is replaced rather than stacked, and it is the base
     name that is truncated to fit the limit — a copy whose name no longer says
     it is one is a board the user cannot place.
5. **Reference-aware surfaces** — the part excalidraw has no notion of:
   - a reference's analyzed properties readable from its element on the board.
     *(done — `src/lib/canvas/moodboard-selection.ts`, `MoodboardInspector` docked
     inside `MoodboardCanvas`.)* What it settles:
     - Selection is derived, never stored. It is deliberately absent from
       `PERSISTED_APP_STATE_KEYS`, so the inspector reads it off the live
       `onChange` rather than off the document.
     - `onChange` fires per drag frame, so the selection is turned into a
       cheap signature first and the element array is only walked when that
       signature changes. The signature is sorted: shift-clicking two elements
       in the other order is the same selection.
     - Several elements pointing at one reference is one reference, and a
       selection of shapes — or of an image with a content-hash `fileId` from
       an imported scene — is nothing to inspect. Several distinct references
       says so rather than picking one.
     - Right edge, and opened once rather than on every selection: the left is
       where excalidraw puts its own island the moment an image is selected,
       and a panel that appeared on each drop would be in the way of the one
       thing a user is doing while dropping a batch.
     - The panel reuses `ReferenceProperties` and the gallery's
       `reference.listByProject` — the same query the sidebar strip renders
       from — so the board's inspector is not a second copy of the analyzer
       view, and costs no extra round trip.
   - **the colour of what is selected, placed on the board as swatches.**
     *(done — `src/lib/canvas/moodboard-palette.ts`, `placePalette` in
     `board-palette.ts`, the inspector's `PaletteAction`.)* What it settles:
     - A moodboard is images *and the colour they are made of*. Agent 2 reads a
       palette off every reference, and until now it could only be read in a
       panel — which means it was not part of the board a user shows anyone,
       or of the deck exported from the board's pages (tech-spec §III.5). Placing it is what
       makes it part of the document.
     - It lands as ordinary excalidraw elements — a bar of rectangles with the
       hex bound to each as a label — so from the moment it exists it is the
       editor's to move, scale, restyle, ungroup and undo, and the autosave's to
       store. Nothing had to be told that a palette was added, and nothing on the
       board knows a swatch from a rectangle somebody drew.
     - Several references selected is a *merged* palette, ordered by how many of
       them share a colour. One photo's palette is agent 2's answer about that
       photo; several together is the question a user actually asks of a
       moodboard — "what colour is this set" — and it is the one thing a
       per-reference panel can never answer. It is also what gives the multiple
       selection something to do besides say "select one".
     - The bar lands centred *under* the selection it was asked for, so it reads
       as the palette of those photos rather than as something that happened to
       land on the canvas, and it arrives selected as its group — a palette is
       one object, and the next thing done with it is moving it.
     - The chips touch and are flat and unoutlined: a gap makes six unrelated
       rectangles, and roughness would put a sketched edge and an uneven fill on
       the one element whose whole job is to be exactly one colour. The hex label
       is set in whichever of excalidraw's two inks is legible on its own swatch,
       by luminance — a #101010 chip labelled in #1e1e1e is a chip with no number
       on it — and in the mono family, because a hex is data and not lettering.
     - The colours come from the same per-reference query the panel body polls,
       so what is offered is always what is on screen, and a photo whose analysis
       has not landed yet simply has no button rather than an empty bar.
     - Known and not fixable from here: excalidraw's dark theme inverts the
       canvas and counter-inverts only *images*, so a swatch shown in dark mode
       is not the colour it says it is. The hex label is exact either way, and
       §II.6's theme control is how a user gets to a canvas where colour can
       be judged.
   - **finding the reference to place, by what agent 2 saw in it.**
     *(done — `src/lib/references/reference-filter.ts`, the search box, ★ toggle and folded
     facet list in `SidebarReferences`.)* What it settles:
     - The strip is the board's only drag source, and it is a scrolling band of
       64px squares. At forty references, choosing the low-key close-up is
       scrolling until it appears; at eighty it is not a workable action at all.
       Composing a board *is* choosing, so the choosing has to be the cheap part.
     - It filters on the vocabulary agent 2 already writes. Until now those tags
       were only ever displayed — read in a panel, one reference at a time — and
       the one question they answer well ("which of these are the neon night
       ones") was the one nothing could ask. Retrieval is what makes the analysis
       worth having on a board.
     - OR within a dimension, AND across them, which is what a facet list means
       everywhere: a second lighting widens, a subject narrows. AND everywhere
       would make the second click almost always empty the strip.
     - Only tags this project's references actually carry are offered, each with
       its count over the references on screen. The vocabulary is 75 terms and a
       project is a handful of looks — a full list is mostly rows that lead
       nowhere, which is how facet UIs stop being used.
     - The typed query matches the title *and* the tags, by label as well as by
       slug, so "golden hour" finds `golden-hour` — the user types what the
       panel showed them, not what the column stores.
     - A filter narrows what a drag carries, exactly as removing a reference
       does: the tiles it hides are not in the next drop. That is invisible from
       a strip, so the selection count says how many picks are hidden rather
       than quietly shrinking the batch.
     - The facet list is folded away by default and the analyzer read is the
       gallery's own `analysisByProject` — the strip shares one query and one
       poll with the grid, and costs nothing when only it is on screen.
   - **which boards a reference is holding up, said before it is deleted.**
     *(done — `src/lib/references/reference-usage.ts`, `moodboard.referenceUsage`,
     `RemoveReferenceButton` in the gallery tile and the lightbox.)* What it
     settles:
     - This is the same link as the rest of §II.5 read from the other end. An
       image on a board is a pointer at a `Reference`, so the board's photos are
       not the board's — and "Remove" in the gallery was one unguarded click
       that deleted the row *and* its bucket objects. Every board element naming
       it became one of excalidraw's placeholder boxes on the next reload, with
       nothing anywhere to say what had been there. It is the last member of the
       silent-loss family §II.3 and §II.6 worked through, and the only one where
       the bytes do not come back.
     - The guard is not "are you sure" — it is *what this photo is holding up*.
       A confirm step that says nothing is a confirm step that gets clicked
       through; one that says "On “Act two”" is the only version that can change
       the decision. A reference on no board gets a plain confirm and no
       warning, for the same reason.
     - The boards are scanned when the removal is armed, not on every gallery
       render: it is the one moment the answer matters, and it costs a round
       trip only when a user is actually about to delete something. The
       confirm is withheld until that read lands, because a removal that raced
       the check is the unguarded click again, only slower. A scan that *fails*
       does not lock the reference — it is offered with the warning it could not
       make.
     - Read against the default 30 s cache with `staleTime: 0`: a board is
       rewritten by its autosave every time a photo moves, so an answer from half
       a minute ago can miss exactly the board that was just built.
     - No index of which board uses what. A board is a scene rewritten every
       second while it is being arranged, so an index would be a second copy of
       it kept current by every write; scanning the project's scenes on demand
       cannot drift, and what crosses the wire is board ids and titles rather
       than any part of a scene.
     - Deletion is still allowed and the boards are not cleaned up after it. The
       user may well mean it, and silently deleting elements from a board to
       tidy up after a gallery action would be a second, worse surprise.
   - **which of the references are already on the board being built.**
     *(done — `sceneReferenceCounts` / `sameReferenceCounts` in
     `reference-usage.ts`, the `unplacedOnly` filter in `reference-filter.ts`,
     the `board-placement.ts` store, the strip's tile mark and `Unused`
     toggle.)* What it settles:
     - The same link again, read at the moment of *composing* rather than of
       deleting (the bullet above) or of inspecting. The strip is a scrolling
       band of 64px squares and the board is a canvas the photo lands somewhere
       on — so at thirty references the question "have I used this one yet" was
       answerable only by scrolling the board and comparing thumbnails, and the
       common outcome is the same photo dropped twice.
     - The tiles carry the mark and the control carries only its opposite: a ✓
       (or a count) on a placed tile answers "is this one on the board", and the
       one thing a user asks the *strip* for is what is left, so `Unused` is
       a two-state toggle beside ★ rather than a three-way placement selector.
     - A count, not a flag. Twice on purpose and twice by accident look
       identical in a strip that only says "used", and the second is the mistake
       this exists to catch.
     - The live board, not the stored one. `moodboard.referenceUsage` already
       reads placement from the database, but it is a scan of every board in the
       project and it lags the editor by an autosave — a photo dropped a second
       ago would still read as unused. The canvas publishes what it is holding
       instead: on its own quiet period (the walk must not be on the frames of a
       drag) and once at mount, so the mark is right before anything is edited.
     - Published through a module store rather than a prop. The canvas is inside
       `MoodboardPanel` and the strip is in the sidebar — two columns of the
       workspace with no other reason to know about each other — and the same
       shape already carries the sidebar's own width. It is republished only when
       the answer changes, so arranging a board (which rewrites every element on
       every quiet period) costs the strip no render.
     - No board open is not an empty board: the store holds null, the toggle is
       not offered, and an `unplacedOnly` filter left on from the board view is
       read as off rather than emptying the strip in the gallery.
   - dropping a crop (agent 3's output) the same way as a whole reference;
   - agent 4 writing elements into the same scene the user edits.
6. **Excalidraw's own features, made to fit.** The parts of §I that are not free
   after all. *(done — `referenceCanvasImagePath` and the image route's
   `stream=1`, `BoardMenu` in `MoodboardCanvas`, `src/lib/scene/excalidraw-assets.ts`
   and `scripts/mirror-excalidraw-assets.mts`, `src/lib/scene/moodboard-library.ts`
   with `moodboard.library` / `saveLibrary` and `useBoardLibrary`.)* What it
   settles:
   - **A board's images are loaded same-origin.** The gallery's image path
     redirects to a signed bucket URL, which makes the `<img>` cross-origin;
     a canvas that has drawn a cross-origin image is tainted, and reading a
     tainted canvas back throws. Export is exactly that read, so every "Export
     image" on a board with photos was a `SecurityError` — the one defect on
     this board that renders perfectly and fails silently at the end. The route
     now also streams the bytes through the app (`?stream=1`), and the board —
     load, sidebar drop and adoption alike — asks for that path. The gallery
     keeps the redirect: nothing reads its pixels, and its bytes should not pay
     for a trip through a function.
   - What is cached on the streaming path is bytes rather than a redirect, so
     the signature's lifetime does not bound it: a day, because a reference's
     pixels never change (a re-upload is a new row).
   - **And at the size the board draws them.** *(`src/lib/scene/moodboard-resolution.ts`,
     the `variants` argument to `sceneFiles`, `referenceCanvasImagePath`'s
     `variant`.)* Making the board same-origin also made every byte of every
     photo travel bucket → function → browser, and the board was asking for
     *originals*: a reference is a photograph, 5568×3712 is an ordinary one, and
     a board draws it at 320 units. Measured on the dev project, that is
     6,100,319 bytes to paint what 44,585 bytes covers — so opening a board of
     twenty photos pulled a hundred megabytes through the app to draw a screen,
     and none of it showed. It is the same shape of defect as the tainted
     export: invisible on the board, and only wrong outside it.
   - Which copy is decided by the element's own geometry, at two device pixels
     to the scene unit — the factor at which the upload's 640px thumbnail is
     *exactly* enough at 100% zoom, not merely close. A drop lands at 320, so
     building a board never pulls an original at all; a photo blown up past that
     does, and so does a cropped one, sized by the region it shows rather than
     by the element (a photo cropped to a tenth of its frame needs ten times the
     source, which is the case a thumbnail would be most visibly wrong in).
   - The requested variant is in the URL whether or not the row has a thumbnail
     — the route already falls back to the original for one that has none. That
     is what lets the sidebar drop, which cannot see the row, name the same URL
     the load does, so a dropped photo and the reloaded one stay one cache
     entry. Only the file entry's *type* is read off the object that will
     actually be served.
   - One reference is one file entry and the coarsest requirement wins: a photo
     shown small and full-bleed on the same board is loaded at full size.
     Excalidraw keys both its files map and its decoded-image cache on the
     `fileId` and both are add-only (`addMissingFiles` skips an id it already
     holds, `addNewImagesToImageCache` skips one already cached), so the
     resolution is decided once per mount — a photo scaled up mid-session stays
     at the resolution it was loaded at until the board is reopened. Fixing that
     would mean changing the element's `fileId`, which is §II.1's one pointer
     and read by every reference-aware surface, for a difference visible only
     while zoomed in.
   - Adoption (§II.3) keeps the original: the scan collects file ids and bytes,
     not element geometry, and a just-pasted photo should not lose fidelity on
     its way into the project. The next reload decides for itself.
   - **And every reference has a copy at that size to ask for.**
     *(`src/lib/intake/reference-derived.ts`, `reference.attachDerived`,
     `deriveReferenceCopies` in `derive-reference.ts`.)* The saving above is one
     the *upload* pays for: the browser has already decoded the file to read its
     pixel size, so the downscale is one extra draw. An image imported from a web
     page (§II.3) never went through a browser — the server fetched the bytes and
     derives nothing off them, and the codec `crop_reference` later brought in
     has never been wired to that path — so those rows were stored with no
     thumbnail and the board went straight back to streaming photographs to draw
     320-unit tiles, on the one path that gathers references fastest. The bytes
     are read back once, same-origin, and the thumbnail is made and attached
     where it would have been made in the first place.
   - It also recovers the pixel size. That was measured off a *cross-origin*
     `<img>`, which an origin that blocks hotlinking never loads — and a photo
     with no size lands square on the board and cannot be corrected afterwards,
     because the files map is add-only. So the derivation is *awaited* when the
     size is missing and runs behind the placement when only the thumbnail is:
     the wait is for the thing that decides where the photo goes, not for the
     thing that decides how many bytes the next open costs.
   - A derivation only fills in; it never rewrites. The stored value is the one
     other boards and caches have already been answered with, and two tabs can
     read the same row back in the same second — so the second writer yields and
     discards the object it uploaded, which is the same orphan window `add` and
     `discardUpload` handle.
   - A fallback is not cached like an answer. `variant=thumb` on a row with no
     thumbnail is served the original, and held for a day that would outlive the
     derivation the same board open just triggered — so a row that could still
     gain a thumbnail gets five minutes, and one whose original is already inside
     the box (which will never gain one) keeps the full day. `needsDerivedCopy`
     is the same predicate on both sides: what the browser decides to make, and
     what the route decides may be cached.
   - Not backfilled. Only `importFromUrl` writes a row with no thumbnail, so
     deriving at import closes the source; a project that gathered images from
     the web *before* this keeps its originals until something walks the
     gallery's own list, which is a background sweep and not a drop.
   - **The menu is listed, not defaulted.** Excalidraw's default main menu ends
     in an "Excalidraw links" group — GitHub, X, Discord — which is somebody
     else's product inside ours, and two of its items (open a file, save to a
     file) are switched off in `UIOptions` and would render dead. Kept:
     export-as-image, find-on-canvas, command palette, shortcut sheet, canvas
     background, reset. The `UIOptions` flags stay even though the items are
     gone from the menu, because they are also what takes ⌘S and ⌘O away.
   - **The theme control works and is three-way.** The board follows the OS, and
     the canvas is where colour is judged, so the user has to be able to
     override that without leaving the board — and get back to following the OS
     without having to remember which way the OS is set. Not persisted: the
     default is "system" and excalidraw's appState has nowhere to say so, so
     storing the resolved `theme` would freeze tomorrow's board in the light it
     was opened under today.
   - **The fonts are served from this origin.** Unset,
     `window.EXCALIDRAW_ASSET_PATH` leaves every `@font-face` resolving against
     `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/`, and a blocked
     or slow CDN means text falls back to a system font *without saying so* —
     the same shape of failure as the tainted export: the board looks fine and
     the deck built from it is wrong. Mirrored: 21 files, 350 KB. Xiaolai keeps
     falling back, because it is 12 MB of the package's 13 MB of fonts and
     excalidraw tries the asset path *and* the CDN, so a partial mirror is safe.
   - The mirror is generated, not committed: `npm run mirror:excalidraw` copies
     out of `node_modules` before `dev`, `build` and `test`, and
     `public/excalidraw-assets` is ignored. A committed copy would be a second
     version of the fonts that drifts from the installed package — the same
     objection as a `.excalidraw` on disk in §III.
   - Which files to copy is read off the shipped bundle rather than listed, and
     a test re-reads it: a version bump that adds a family or rehashes a subset
     fails the test instead of quietly loading that family from the CDN again.
   - **The element library is stored.** Excalidraw ships the panel, the "Add to
     library" action and the `.excalidrawlib` import, and keeps all of it in
     memory: persisting is the host's job, and unpersisted it is a button whose
     result lasts until the next reload — the same silent loss a pasted image
     had before adoption. The list is written to `Project.libraryItems` on
     `onLibraryChange`, and mounts the editor through `initialData.libraryItems`.
   - It belongs to the **project**, not the user and not the board. An item is a
     group of the same elements a board holds, so it can contain an image — and
     an image element's `fileId` is a `ref:` pointer that only resolves inside
     its own project, so a user-wide library would drag one project's photo onto
     another's board as an empty box. Per-board would defeat the point: a title
     card is made to be used on the next board.
   - The library's references are hydrated into the same files map the scene's
     are, because the panel draws its previews from it — an item made from a
     photo that is not on *this* board would otherwise be a blank tile.
   - Excalidraw hands back the whole library after every change, so the save is a
     replace (which is also what makes deleting an item work), and mounting fires
     the same callback with the list the editor was just given — so a fingerprint
     of what the server holds is compared first, or opening a board would write
     to the database. Unlike the scene it is not revision-guarded: the list is
     changed by a deliberate, occasional action, and a conflict dialog over
     adding a sticker would cost more than the rare loss of an item added in
     another tab in the same minute.
   - A library too large is refused, never trimmed, exactly like a scene — and a
     refused or failed save says so on the canvas with a retry, because the item
     is in the panel either way and only stops existing on reload.
   - **The export is the board's own.** *(`src/lib/scene/moodboard-export.ts`,
     `board-export.ts`, `MoodboardExportPanel`, `saveAsImage: false` and the
     `openDialog` interception in `MoodboardCanvas`.)* Everything above makes the
     board cheap to *open*; an export is the opposite trade, and excalidraw makes
     it from the wrong end. Its dialog draws from the editor's file map, which
     is:
     - **the board's resolution, not the file's.** §II.6's second bullet serves a
       320-unit tile a 640px thumbnail, which is exactly enough at two device
       pixels to the unit — and an export at 3× draws that unit as three pixels.
       So a moodboard exported for a client was upscaled thumbnails, and nothing
       on screen said so. Same shape as the tainted export: it renders, and only
       the artifact is wrong.
     - **URLs, not bytes.** An SVG embeds each file entry's `dataURL` verbatim as
       an `<image href>`, and ours is `/api/references/<id>/image` behind the
       user's session — so every exported SVG was a page of broken boxes for
       whoever it was sent to. That one had been wrong since before there was a
       resolution policy at all: it is what "same-origin" costs when the file
       leaves the origin. It is moot now — see the withdrawal below — but the
       `data:` file map it forced is what still makes the PNG stand on its own.
   - So an export builds its own file map: every reference the exported elements
     name, fetched at the copy the *output* needs (`sceneImageVariants` now takes
     the pixel ratio — the board's display ratio there, the export's scale here)
     and inlined as a real `data:` URL. A reference that cannot be fetched keeps
     the editor's entry rather than failing the export: the photo comes out at
     board resolution, which is what it looked like on screen.
   - One export, however it was reached. The menu item, ⌘⇧E and the command
     palette all do the same one thing — set `openDialog` to `imageExport` — so
     that is what is intercepted, and excalidraw's own dialog is switched off in
     `UIOptions`. Intercepting the *request* rather than replacing a button is
     what stops the two exports (the right one and the one this exists to
     replace) from both being reachable.
   - **Withdrawn: the SVG output.** The export is a PNG or the clipboard, and
     the panel offers no Format row. Nobody needed it — nothing downstream of
     this app reads a board as vectors — and one way out of the app is one
     output to keep honest against excalidraw's own. The `format` setting
     survives at its `png` default rather than being threaded out of every call
     site. The reason it was *not* withdrawn for, having been checked in the
     mirrored package: `exportToSvg` clips a rounded image to the same
     `getCornerRadius` the canvas does, so `canvas.md` §XI.2's rounded
     photograph would have come out rounded there too.
   - Dark mode is deliberately not offered, unlike excalidraw's dialog: its dark
     theme inverts every vector element and counter-inverts only images, so a
     dark export of a board carrying a §II.5 palette bar states colours that are
     not the ones agent 2 read. `exportEmbedScene` is off for the reason §III
     gives about `.excalidraw` files.
   - Selecting a frame exports the section, not an outline: §II.9 made a frame
     the thing that owns what is inside it, and "export the selection" has to
     make the same reading. A selection-only setting that outlived its selection
     falls back to the whole board rather than producing an empty file.
   - Two routes are not covered and are left alone: the context menu's "Copy to
     clipboard as PNG/SVG" still uses the editor's file map, because they are
     actions inside excalidraw's own action manager with nothing to intercept.
     The distinction is defensible rather than merely tolerated — a copy is a
     quick paste into a message, an export is the deliverable — and the panel
     offers its own Copy so the good path exists for both.
   - The board's stored picture (§II.7) also draws from the editor's map, and
     stays that way: it is capped at 1600px for the *whole* board, so a thumbnail
     is more than enough for any board with more than a few photos on it, and
     fetching originals every quiet period would undo the saving above for a
     preview.
   - Not open after all: iteration 9 left "an imported `.excalidrawlib` holding
     raster bytes reloads blank" as a gap to close by teaching adoption to read
     library items. It is unreachable. Excalidraw refuses to put an image element
     in a library at all (`errors.libraryElementTypeError.image` — "Adding images
     to the library will be supported soon!"), and its `.excalidrawlib` import
     inserts items with `files: null`, so no library item can name raster bytes
     in the first place. Adopting library items would be dead code until
     excalidraw ships the feature.
7. **The board's picture**, so a deck is built from what the board actually
   looks like — and so anything outside the editor can see a board at all.
   *(done — `src/lib/scene/moodboard-render.ts`, `Moodboard.renderRevision`,
   `moodboard.renderUploadUrl` / `saveRender`, `src/server/moodboards/render.ts`
   and `display.ts`, `/api/moodboards/[id]/render`, `useBoardRender`, the board
   tab's thumbnail.)* Unblocked by §II.6's first bullet — before it, no export of
   a board with photos could succeed at all. What it settles:
   - A board is an element array, and nothing but excalidraw can turn one into an
     image. So the picture is taken by the tab that is *showing* the board: it is
     the only place there is a canvas, and rendering server-side would mean a
     headless browser for something a mounted editor can already do.
   - It is taken only when the autosave is idle and is labelled with the
     `revision` it is of (`renderRevision`), so a picture is never of a scene the
     server does not hold — and a save that lands while the canvas is drawing
     leaves the render behind, which the next quiet period notices and redoes.
   - Waited out for 20 s of quiet rather than the autosave's 900 ms: nothing is
     lost by waiting, since the scene is stored either way, and a full-board
     render plus a megabyte of PNG costs orders of magnitude more than a save.
     A board being actively arranged is quiet for a second at a time and so is
     never rendered mid-arrangement; opening one whose picture is behind is
     itself a long enough pause.
   - One object per board, overwritten in place
     (`projects/<projectId>/boards/<boardId>/render.png`) — a new path per render
     would leave every previous picture of every board behind, paid for forever
     and pointed at by nothing. What makes overwriting safe to cache is the
     revision in the URL: `/api/moodboards/<id>/render?r=<renderRevision>` is a
     different URL after every render, so the bytes can be held for a day.
   - The path is the server's, derived from ids it has already checked, so unlike
     a reference upload the locator never crosses the browser and never has to be
     verified on the way back. The bytes still go browser → GCS, for the reason
     an upload does: a 1600px PNG is past what a function may accept as a body.
   - A failed render is not said on the canvas, unlike a failed save or a failed
     adoption: nothing the user made is at risk, and the only cost is a stale
     preview. It is retried when the board next changes rather than immediately,
     so a broken bucket does not mean a render attempt every quiet period.
   - An empty board is never rendered — excalidraw exports the content's bounding
     box, and a blank picture is one the tab row cannot tell from a real board.
   - The first thing it is for is the **tab row**: boards are named in a hurry and
     renamed rarely, and the picture is what a user actually recognises one
     by. The deck export reads the same column.
8. **Tidying the photos into rows.** *(done — `src/lib/canvas/moodboard-arrange.ts`,
   `tidyBoard` in `board-arrange.ts`, the `TidyAction` button in the editor's
   top-right slot.)* What it settles:
   - A board is collected, not composed: six photos from the sidebar, one pasted,
     three dragged off Pinterest, each landing at whatever size it happened to
     arrive at. A set of photos at *one height* reads as a single image, which is
     what a moodboard is for; a 6000px still beside a saved thumbnail does not,
     however carefully the two are lined up. Excalidraw aligns and distributes,
     and both keep every element the size it already is — so the one arrangement
     a moodboard actually needs is the one it cannot do.
   - One height for the whole board rather than one per row (which is what a
     *justified* layout gives, and what makes its edges flush): every photo on a
     board is one the user chose, and sizing a row of two panoramas to the
     width of a row of five portraits decides which of them matters. The cost is
     a ragged right edge, which is the honest one.
   - Photos only. A caption, an arrow pointing at one and a §II.5 palette bar are
     where they are *because* of what they sit next to, and sweeping them into
     the grid would destroy the only thing they carry. A locked element is not
     moved either — locked means "not by accident", which is exactly what a
     one-click re-layout would be. The exception is one the user states:
     grouping a note with a photo says it belongs to that photo, and then it
     travels with it — see §II.10.
   - Two or more selected photos is the user aiming it; anything else is the
     whole board. The button says which before it is pressed, because a tidy
     moves and resizes everything it touches. One photo selected falls through to
     the board rather than doing nothing, since arranging one photo is not a
     request anyone makes.
   - The grid keeps the area the photos already covered and lands on the middle
     of the bounds it replaces, so a tidy is not also a zoom or a jump: what was
     on screen before is on screen after. That is also what makes tidying twice
     the same as tidying once — the second pass reads back exactly the area and
     the aspect ratios the first one wrote — and an already-tidy board produces
     no changes at all rather than an undo step that did nothing.
   - The order is the one the board already reads in, left to right and top to
     bottom, with rows banded rather than sorted on `y` (two photos side by side
     are never at the same pixel). Tidying straightens what the user
     arranged; filling the grid in z-order would send the last photo pasted to
     the end no matter where it had been put.
   - It writes the new geometry onto the same elements through `newElementWith`
     under one `CaptureUpdateAction.IMMEDIATELY`, so it is an ordinary edit —
     autosaved, rendered into the board's picture, and undone by one ⌘Z. A plain
     spread would not do: excalidraw caches a drawn element by its `version`, and
     one whose width changed but whose version did not is redrawn at its old
     size.
   - The button is in `renderTopRightUI`, excalidraw's own host slot beside the
     library button, rather than in the main menu: it is used often enough while
     arranging that two clicks would be felt, and it is painted in excalidraw's
     island variables rather than the app's so it follows the board's theme
     control instead of the page's.

   **And tidied in colour order.** *(done — `src/lib/canvas/moodboard-order.ts`, the
   `order` parameter on `arrangeRows`/`arrangeChanges`/`tidyBoard`, the second
   half of the `TidyAction` control.)* What it settles:
   - Grouping the warm frames away from the cold ones is the judgement a
     moodboard is *for*, and until now it was made by dragging each photo next to
     the ones it matches. Agent 2 already reads a palette off every reference, so
     the board can be sorted by what is in the photos — and this is a sort neither
     excalidraw (which knows a rectangle from a rectangle) nor a file browser
     (name, date, size) can do at all.
   - It is the same action as the plain tidy — the same layout, the same undo
     step, the same photos — differing only in what fills the grid first. So it is
     the second half of one control rather than a second button, and the layout
     module takes an *ordering* rather than learning what a palette is.
   - A photo is filed under the first colour in its palette that has a hue.
     A palette is ordered most prominent first, so a night shot opening on two
     near-blacks is still the shot with the neon in it — filing it under black
     would put it with the greyscale portraits. Below 15% saturation, or outside
     8–95% lightness, a colour has no hue worth grouping by: a #6b6a68 wall
     reports 40° and does not belong between two ambers.
   - A palette with no chromatic colour in it is a genuinely neutral photo and is
     filed by its mean tone, so the greyscale frames come out after the colour run
     as a dark-to-light ramp rather than scattered through it.
   - The run starts after the widest unused arc of the wheel, not at red. A board
     of sunsets spanning 350° and 10° would otherwise come out with half its
     frames at each end of the board — the one place no cluster is cut is the
     largest gap between two hues actually in use.
   - An unanalyzed reference is not a colourless one: it has no tone at all and
     goes to the tail in reading order, because a photo of unknown colour dropped
     between two ambers breaks the only thing the order exists to show.
   - Ties fall back to the order the board already reads in, which is what keeps
     the layout a fixed point: the second pass reads back its own output, so
     tidying by colour twice moves nothing the second time — the same property
     §II.8's first half has.
   - Offered only when two of the photos in scope actually have a palette.
     Otherwise the colour order *is* the reading order, and a button that quietly
     does what the button beside it does is a button that lies about what it is
     for.
   - The palettes come from the gallery's own `analysisByProject`, which the
     sidebar strip already polls (§II.5's third part) — so the board shares one
     round trip with it and adds no poll of its own. An `ArrangeBox` now carries
     the `ref:` pointer its element named, which is what lets a layout ask what is
     in a photo without a second walk of the scene.

9. **Frames as the board's sections.** *(done — `src/lib/canvas/moodboard-frames.ts`,
   `arrangeGroups` / `frameRows` / `groupChanges` in `moodboard-arrange.ts`, the
   frame-aware `tidyBoard` and `placeReferences`.)* What it settles:
   - A board is not one arrangement for long: it is "act one / act two", "the
     cold half / the warm half", "the look" beside "the palette". Excalidraw's
     frame is exactly that object — a named rectangle that owns what is inside
     it — and it ships the tool, the name and the membership it assigns when an
     element is *dragged* in with the pointer. What it does not ship is any of
     that surviving an edit made from outside its own event handlers, which is
     every edit this board adds.
   - So the tidy destroyed sections. It swept every photo on the board into one
     grid, including the ones in frames — which left each of them still
     *belonging* to a frame it was no longer inside: drawn clipped at that
     frame's edge (excalidraw clips a child that overlaps its frame), and
     dragged along the next time the section was moved. Same family as the
     tainted export and the unpersisted library: it renders, and it is wrong.
   - A frame is now a group of its own, laid out **inside** the frame. That is
     the one place the layout does not preserve the area the photos covered:
     a section has a size the user drew, and filling it is what the frame is
     for. The common height is found by halving rather than in closed form,
     because the row breaks are decided greedily *from* the height and there is
     no formula for the tallest height whose packing still fits. It is still a
     fixed point — the frame does not move, so the second pass solves the same
     problem — which is what keeps tidying twice from being an undo step that
     did nothing.
   - Everything not in a frame is still one group laid out on its own bounds, so
     a board with no frames tidies exactly as it did before. One press, one undo
     step, however many sections it touched: a tidy that had to be pressed once
     per frame is the arranging it exists to replace.
   - Selecting a frame aims the tidy at that section. A frame is not a photo, so
     the selection rule read it as nothing selected and fell through to the whole
     board — the wrong action, taken from the most obvious gesture a board with
     sections has.
   - A photo dropped from the sidebar (or imported from a web page, which lands
     through the same function) joins the frame it lands in. Excalidraw does this
     for elements *it* inserts, and without it a photo dropped into "Act one" sat
     on top of the section and was left behind the moment it moved.
   - Joining is full containment rather than excalidraw's overlap: a child that
     only overlaps its frame is drawn clipped, and a photo that arrives with a
     side sliced off reads as a broken drop. Fully inside is where the user
     aimed; anything else stays on the canvas, which is exactly where it looks
     like it is, and dragging it the rest of the way in is excalidraw's own
     gesture.

10. **What is said about a photo, attached to it.** *(done —
   `src/lib/canvas/moodboard-caption.ts`, `arrangeableUnits` / `elementPlacements` in
   `moodboard-arrange.ts`, `captionSelectedPhotos` in `board-caption.ts`, the
   inspector's `CaptionAction`.)* What it settles:
   - A moodboard is images *and what the user says about them* — "act two,
     the hallway", "this light, not this framing". Excalidraw has text, and it
     has bound labels for containers and arrows, but an image is neither: a note
     beside a photo is a free element that knows nothing about the photo. So it
     was separated from its subject by the first drag and by every tidy.
   - The attachment is excalidraw's own **group**, not a field of ours. From the
     moment a caption exists the editor moves, scales, copies, deletes and undoes
     it with its photo, and the autosave stores it — the same reason a §II.5
     palette lands as rectangles rather than as a widget.
   - So the tidy's unit is a **group**, not a photo. This is the same defect
     §II.9 found in frames, one level down: `arrangeableImages` read every image
     on the board on its own, which meant one press separated every annotation
     from its subject and left two grouped elements at an arbitrary distance —
     and unlike a frame, nothing on screen said the two had been linked at all.
     A group is now one box to the layout (its members' union), and every
     element in it is rewritten by the one transform that took the group's old
     bounds onto its new ones.
   - A group of *photos* is a unit too, not a special case. Five photos the
     user grouped are an arrangement they made; packing the block keeps it
     while the board around it is still tidied. It also means there is one rule
     rather than "a group of one photo travels, a group of two is skipped".
   - A group scales rigidly, which is what excalidraw's own resize handles do to
     a multi-element selection — including `fontSize`, because a caption left at
     yesterday's point size inside today's box is the half of the transform that
     is easy to forget, and `points`, because an arrow is drawn from those and
     not from its box. The union box is what packs, so a row never lands on the
     caption of the row above it.
   - The layout stays a fixed point: a second pass reads the union back from the
     members the first one wrote, so tidying a captioned board twice still moves
     nothing the second time. A group with a locked member is left alone whole,
     for the same reason a locked photo is.
   - The caption offered is the **reference's own title** — the one the user
     already gave it, which is the caption they would have typed — one line and
     truncated, set at a sixteenth of the photo's width so it is legible under a
     thumbnail and not a headline under a full-width still. It is ordinary text
     from the moment it lands, so re-typing it is a double-click.
   - Offered only for a selected photo that is in no group: excalidraw's groups
     nest, and an outer group holding this photo and its caption while its
     existing group holds elements the outer one does not is a state its own
     gestures cannot produce. A photo that already has a caption does not need a
     second one.
   - The Tidy control now counts two things — units to rearrange and photos it
     will move — because a board of six photos where two are captioned has four
     units, and a button offered on a board that is one group would lay a single
     block back down where it already was.

11. **The crop kept as a photo.** *(done — `src/lib/canvas/moodboard-crop.ts`,
   `useBoardCrops` in `board-crop.ts`, the inspector's `CropAction`.)* What it
   settles:
   - "This part of this frame is the shot" is a judgement a moodboard is made
     to record, and excalidraw already has the gesture for it. What it does not
     have is any notion that the image is a *file*: its crop is a window onto
     the whole one, kept as four numbers on the element. So the part the
     user cut away is still what the gallery shows, still what agent 2 read
     the palette and the tags off, still what a deck built from these
     references would use — and still what the board downloads, because a
     window onto a tenth of a photo needs ten times the source resolution
     (§II.6). The same shape as the unpersisted library and the tainted export:
     it renders exactly right and is wrong everywhere else.
   - Keeping it cuts the region out for real. It becomes an ordinary
     `Reference` of this project — uploaded through the same function the
     dropzone and adoption use, hashed with the same digest, queued for the
     same analysis — and the element is repointed at it with its `crop`
     cleared. Nothing on the board moves: the element's box is already the box
     that was showing that region, so the repoint is invisible on screen and
     total behind it. It is one ⌘Z, and undoing it puts the element back on the
     full frame, which is still in the project.
   - The crop crosses as **fractions** of its source, never as pixels.
     `crop.naturalWidth` is the size of the copy the *editor* loaded, and §II.6
     serves the board a 640px thumbnail whenever that is enough — so a crop's
     own coordinates are coordinates in whichever copy happened to be on
     screen. Cutting with them would silently make the kept photo a crop of a
     thumbnail, which is the one outcome this exists to prevent.
   - So the bytes come from the *original*, read back through this app's own
     image route. Same-origin, which is the property §II.6's first bullet
     exists for and is what makes a canvas that has drawn them readable at all
     — the crop is cut in the browser because the bytes are already decoded
     there, in front of the user who framed the box. The server can cut pixels
     now (`src/server/references/cut.ts`, added so `crop_reference` could file
     its own cut), and this door still does not use it: a gesture on the canvas
     would be answered by a round trip that reads the original back out of the
     bucket to produce bytes the browser is already holding.
   - The element's other transforms are not part of the crop and stay on it:
     `angle` is where the photo sits on the board, and the flip is written by
     excalidraw in unflipped source coordinates, so the region is a rectangle
     of the true photograph either way. Baking either into the stored bytes
     would make the reference a picture of a board rather than a photo.
   - An element that has merely *been* in crop mode is not a crop. Excalidraw
     leaves the object behind on one dragged back out to its full frame, and
     offering to keep that would buy the project a second copy of a photo it
     already has.
   - The offer follows crop mode rather than the selection. A crop does not
     change what is selected, so the selection signature — which is what stops
     every other derived panel state from being recomputed on the frames of a
     drag — would leave the button hidden until the user clicked somewhere
     else. `croppingElementId` joins that key: a scalar, so a drag inside crop
     mode still costs nothing, and it changes exactly when the crop is
     committed.
   - Named after the frame it came out of, counting up rather than stacking:
     "Hallway, night (crop)", then "(crop 2)". A crop that arrives called
     "Board image" is one the user has to recognise all over again, and two
     crops of one still have to be told apart in a strip of 64px squares.
   - A crop that could not be kept says so on the canvas, like a failed
     adoption: the element still shows the crop either way, so silence would be
     the user believing the project holds a photo it does not.

## III. Deliberately not ported

- Real-time collaboration, rooms and the collaborator cursor layer. It needs a
  server we do not run, and the product is one user per project.
- Excalidraw's own local-storage persistence and its file/scene menu — our
  scene lives in Postgres and is addressed by a board id, so a second, silently
  divergent copy in `localStorage` is a bug, not a feature.
- Embeds (YouTube, etc.) and Mermaid diagrams: a moodboard is images and marks.
- Excalidraw's "save to file" and "open scene" canvas actions, both switched
  off in `UIOptions`. A board is a row addressed by an id; a `.excalidraw` on
  disk is a second copy that diverges, and one opened back in would name image
  bytes we never stored, so its photos would return as empty boxes. Export
  (PNG/clipboard) stays on — step 7 needs it.
- Excalidraw's socials and Excalidraw+ links, and its live-collaboration
  trigger: somebody else's product, and a feature we do not have. Gone by
  listing the main menu rather than taking the default one.
