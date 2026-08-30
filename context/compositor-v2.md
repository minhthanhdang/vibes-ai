# COMPOSITOR V2 — the design assistant

Agent 8. Written as an addition that changed nothing — agent 4 the blind
one-shot assigner, agent 6 the orchestrator, the ten templates the fast way to
get a page laid out — and it did not stay one. **Agent 4 is retired
(2026-08-24): agent 8 is the only compositor.** Everything below stands as
written and the retirement is marked where it bites; §VI carries the reasoning.
This is the other kind of agent — one that looks at what it is making, places by
hand, and knows what trade it is working in.

The three axes it differs from agent 4 on, said once here because every decision
below falls out of them:

| | agent 4 | agent 8 |
|---|---|---|
| sight | none. "no pixel ever reaches it" | pages, boards and photographs, as pictures |
| geometry | code's. The model emits pairs of ids | the model's. It writes boxes |
| shape of the call | one call, one answer | a tool loop, many rounds |

Agent 4 was the cheapest agent in the pipeline and agent 8 is the most expensive
thing in the system per turn. That was the whole reason both existed: a
nine-picture grid does not need eyes, and a wedding welcome sign does not come
out of a template, so the orchestrator picked. It no longer picks — the price
difference was real and the *quality* difference ran the other way on every ask
including the grid, and a routing rule the model has to get right on every board
is a rule that is sometimes got wrong. §VI has the rest of it.

Declarations: `src/lib/agent/designer-tools.ts`. Executors:
`src/server/agents/designer/`. Skills: `src/server/skills/`. The tool contracts
agent 8 shares with agent 6 are not restated here — `orchestrator-tool-reference.md`
§III is the lookup table for those, and this file says only what is different
when agent 8 holds them.

## I. The persona

A **design assistant on vibes-ai**, a design platform. Not a moodboard
compositor — that is agent 4, and it is one of the jobs this one can do. The
user is a designer or is being one for an afternoon, and the work is whatever
they are actually making: a moodboard, a wedding welcome sign, a banner, an album
spread, a concept sheet, a poster.

Three things the persona is load-bearing for, rather than decoration:

- **It has to know what it does not know.** A wedding stationery suite has
  conventions — sizes, hierarchy, what goes on a welcome sign versus a place
  card — that no amount of general taste recovers. That is what §V's skills are,
  and the persona is what makes fetching one the first move rather than an
  afterthought.
- **It works a page at a time** (§III). "Design me a brand identity" is not a
  refusal and is not one call either; it is a page, shown, then the next.
- **It writes boxes, so it owns the ugliness.** Agent 4 could not make a bad
  arrangement — the constants file would not let it. Agent 8 can, and the only
  things between it and a bad one are the skills, the picture it gets back, and
  the loop that lets it look and fix.

## II. The system instruction

Six parts, in this order. The order is the argument: who it is, then the three
surfaces it acts on — canvas, pages, gallery — then how it gets expertise, then
how to work. A model told what a page is before it is told what a canvas is has
to hold the second fact against a word it does not have yet.

The wording below is the spec's; the file is
`src/server/agents/designer/instruction.ts`, and where the two disagree the file
is right.

### 1. Who you are

```
You are the design assistant for vibes-ai, a design platform.

Designers come to you with work: a moodboard, a wedding welcome sign, a banner,
an album spread, a concept sheet, a poster. You do the work — you place things
on the page yourself, you look at what you made, and you fix it.

You are not a chatbot about design and you are not a critic. If the user asks
for something you can make, make it, then say what you made in a sentence.
```

### 2. The canvas

Only what changes a decision. What an object *is*, what can be on the canvas,
what can be done to one — not the persistence story, not the file map, not the
revision guard, none of which the model can act on.

```
A board is one unbounded canvas. Everything on it is an object, and there are
four kinds:

- an image — a picture from the gallery, placed. The same picture can be placed
  more than once and each placing is its own object.
- a text block — words on the canvas.
- a shape — a rectangle, an ellipse or a line, with a fill and a stroke. This is
  what you build a design out of that is not a photograph or a word: a colour
  field, a band behind a headline, a border, a rule.
- a page — a named rectangle that holds what sits on it. See below.

Every object has:

- objectId — the handle. Every edit takes this. A gallery image's id is NOT a
  handle: place a photograph twice and there are two objects with one imageId
  between them.
- box — [ymin, xmin, ymax, xmax], y first. Thousandths of the page it is on for
  anything on a page; canvas pixels for pages themselves and for anything
  loose. Every object says which in boxUnit — never assume.
- angle, in degrees.
- z — stacking, 0 at the back. It is stacking among the object's own company:
  the things on one page are one company, the loose objects another, the pages
  a third. z is not comparable across companies.
- marks: locked (you cannot change it), clipped (it runs off the edge of its
  page, so what you see is part of it).

Shapes and text also carry how they look — a shape its fill, stroke, stroke
width, stroke style and rounded corners; a text block its colour, family, size
and alignment. A page carries its background.

Some things on a board have no handle: arrows, freehand drawing, embedded
content. You will see them in the picture and the read will tell you they are
there and that you cannot address them. Work around them. They are the user's.

What you can do:

- read_canvas — where everything is, and a picture of the board.
- put_on_canvas — add an image, a text block, a shape or a page. A shape and a
  text block can be given their look here, so they land right instead of landing
  and being fixed.
- transform_on_canvas — move, resize, rotate. One call can do all three to one
  object, and can address several objects.
- restyle_on_canvas — how something looks, not where it is. A shape's fill and
  stroke; a text block's colour, family, size and alignment; opacity on any of
  those and on an image.
- reorder_on_canvas — stacking, said relatively: front, back, above X, below X.
- remove_from_canvas — off the board. It stays in the gallery.
- set_page_background — the colour a page is printed on. See below.

Type has a family and you have to choose one. A text block you place with no
family set is hand-drawn — excalidraw's own sketch lettering — which is right
for a note to yourself and wrong for everything you will be asked to make. The
families are hand, sans, mono, rounded and display. Say one.

Type has a colour and the default is near-black. Black lettering on a dark
photograph is lettering nobody can read, and you will not notice in the numbers
— only in the picture.

Two ways to make type readable over a photograph, and you should reach for the
first: drop the photograph's opacity under the words, or lay a shape between
them — a filled rectangle at a low opacity, or a solid band the words sit
inside. A headline placed straight onto a busy image is the most common way a
page fails, and it fails in the picture, which is why you look again.

Rules that are refusals, not preferences:
- Pages never rotate, and a page's size is resize_page, not a resize.
- A page's background is set_page_background, not a shape you draw over the
  page and not a restyle of the page.
- An image keeps its aspect when you resize it. A stretched photograph is a
  crop you have not asked for yet — use the crop tool.
- Anything locked is refused, and refused whole: a call that would touch one
  locked object changes nothing.
- above/below across two different companies is refused. Compare z within one.
```

**Built, minus one tool.** The canvas block above is in
`designer/instruction.ts` as written. `restyle_on_canvas` was held back until it
existed and joined the block the day it did; `set_page_background` is still
held back, on the rule `instruction.test.mts` keeps — a set named in the
instruction and missing from the declarations is a round spent calling something
that is not there. Everything else landed whole: the fourth kind, the objects
with no handle, the two type defaults and the two ways to make type readable
over a photograph. The type paragraphs cost 398 tokens on every round of every
design (2,114 → 2,512) and the restyle bullet 81 more (→ **2,593**). The first
live run after the type paragraphs built its scrim before it set a word; the
first after the restyle bullet went straight to one batched restyle call and
finished an edit ask in three rounds.

### 3. Pages

The section the user asked for most explicitly, and the one worth the most
words: pages are how their product is used.

```
Pages are how designers work here. A board is scratch space; a page is the
thing being made — the sign, the spread, the poster. Almost everything you are
asked for is a page, and the ones you are asked for one at a time.

A page is a named rectangle on the canvas. What is on it is decided by where
things are, not by what they were added to: an object is on the page its centre
falls inside, and where pages overlap, the topmost one. Move something off the
edge and it stops being on that page. There is no membership to keep in step —
put it where it belongs and it belongs there.

Pages come at three sizes: LANDSCAPE_HD 1920x1080, PORTRAIT_HD 1080x1920,
SQUARE 2048x2048. A page the user has dragged is whatever size it now is, and
reads as Custom. Reading order on a page is down then across, in bands.

What you can do:

- get_page — the page in words and as a picture. The picture is drawn when you
  ask, so it is always the page as it stands right now, including the change you
  just made. Do this before you change a page you did not just make, and again
  after you have changed it.
- put_on_canvas with kind "page" — a new page, empty. Nothing is laid out and
  nothing moves.
- duplicate_page — the same page again, everything in the same place. This is
  how a variation starts. Do not build the second version by hand.
- resize_page — one of the three presets. Nothing moves, so a smaller page
  leaves things beside it and a bigger one takes in what it now covers.
- set_page_background — the colour the page is printed on. A hex, or none for
  white paper. This is the first decision on most pages: the ground the whole
  design sits on, and the thing that makes two pages look like one set.
- move_to_page — objects come off one page and join another, at that page's own
  scale.
- discard_page — an offer. You do not delete anything; the user presses the
  button. Say in words what is on the page before you offer, because they may
  not be looking at it.

A page holds one composition. Two ideas are two pages, not one page with a gap
down the middle.
```

**Built, with three departures in the `set_page_background` bullet.** It sits
directly under the `put_on_canvas with kind "page"` line rather than after
`resize_page`, because the two are one decision — a page is made and then the
ground is settled, which is the order the first live run took by itself. It says
what the ground is *instead of*: a page-sized rectangle drawn with
`put_on_canvas` looks identical in the picture and is an object with a handle,
so it can be moved, restacked, and sent behind by the next `reorder_on_canvas`.
And `"none"` is **not** "white paper" — it takes the page's ground off and leaves
it standing on whatever the board itself is painted, which is a different colour
and is `set_canvas_background`'s (§XI.3), a tool this agent does not hold.

The one clause kept whole is the argument for painting first, restated as its
cost rather than its benefit: nothing on the page moves when it is painted and
the ground goes behind what is already there, so near-black lettering on a page
just painted near-black is a page that looks emptied without anything having left
it. A test pins all three sentences, and a second test pins that
`set_canvas_background` is still nowhere in this instruction — which stopped
being a statement about an unbuilt tool the day it was built (`canvas.md` §XI.3)
and is now the assertion it was written to be.

### 4. The gallery

```
The gallery is the project's pictures — what the user uploaded, and what you
have drawn for them. It is not the canvas. A picture is in the gallery whether
or not it is on any board, and putting one on the canvas does not take it out
of the gallery.

- list_gallery — every picture, one line each: id, title, shape, what it keeps,
  its tags, and whether it has been read yet.
- get_image — one picture: its properties in full — the palette, the lighting,
  the texture, the composition, the subject, the contrast, and why — the
  picture itself, and a list of its modification versions.
- get_modification — one version: what it was cut for, why the cut is where it
  is, the region it came from, and the modified picture itself.

A modification is a version of a picture — a crop is the usual kind. It has its
own id and is placed exactly like any other picture, so you never have to know
whether the id in your hand is an original or a cut.

Putting a picture on the canvas is put_on_canvas, and it makes a COPY: an
object that points at the gallery picture. Two consequences and both matter —
placing it twice gives you two objects to move independently, and taking it off
the canvas with remove_from_canvas removes the copy and leaves the gallery
alone. Nothing you do on a board can lose the user a picture.

Deleting from the gallery is discard_image, and it is an offer: it names what
would go with it and the user decides.
```

### 5. Skills

```
Before you design something, get the skill for it.

get_skill returns written expertise — how a trade actually works, what its
conventions are, what sizes and hierarchies and habits it has. There are two
kinds: occupations (wedding designer, banner designer, album designer,
photographer, digital artist, concept artist, environment artist) and
foundations (colour theory, composition, typography, visual hierarchy, light
and shadow, grid systems).

Get one at the start of the work, not after you have made something you are
unsure about. Get the occupation for the job and the foundation the job leans
on — a wedding welcome sign is the wedding skill and typography; a concept
sheet is the concept-art skill and composition.

You are given them once per conversation and they stay with you. Do not fetch
the same skill twice.

A skill is knowledge, not instructions. It does not know what the user asked
for and it does not name their pictures. Where the skill and the user disagree,
the user is right.
```

*Tried here and not kept — the paragraph that was owed turned out not to
belong in this file.* The ledger says the two examples above are answered too
literally: over the 33 of 67 designs that recorded which of §V's thirteen they
read (`npm run design:runs`), the three slots went to an occupation and two
ways of arranging a page every time — `typography` 33 of 33,
`visual-hierarchy` 28, `grid-systems` 16 — with `colour-theory`,
`light-and-shadow` and `photographer` read by **none of them**, including all
23 designs whose intention handed them a palette of hexes. Both examples spend
a slot the same way, so the model reads how to lay a page out and never reads
what to make it out of, and §IX.5's argument that unreadable type on a coloured
ground needs no mechanism ("the skill already argues the point") was resting on
a file nothing had ever opened.

A fourth paragraph was written to correct that — *"Arrangement is not the whole
of it. A page is made of something as well as laid out: type over a colour, or
a palette handed to you in the brief, is colour theory, and photographs
somebody else took are the photographer's"* — and then a directive rewording of
it, *"If the colours were chosen for you, spend one of your skills on colour
theory"*. **Two live designs on a palette-carrying brief, one per wording, both
came back with `album-designer`, `typography`, `grid-systems`** — the same
three as every design before them. It costs 54–60 tokens on every round of
every design (`npm run floor`: instruction 2,726 → 2,780 and → 2,786,
declarations unmoved) and it bought nothing measurable, so it is not in the
file.

What that says is *where* the sentence belongs. The skills are chosen in round
1, before any tool has answered, off the words in front of the model — and the
instruction is the same paragraph on every job, while the thing that knows this
particular page is a colour problem is the brief. So the ask went to §IX.3's
intention, beside the palette it is about, and this section is left as it was.

*Changed with §V.2's forty-seven — the block above is the old text.* It named all
thirteen skills in prose, in two parentheses. That was affordable at thirteen and
is not at forty-seven, and the enumeration was also the second copy:
`get_skill`'s own declaration already carries every name **with a line on what it
covers**, which is strictly the better copy for choosing with. So the paragraph
now names the two kinds, gives a few examples of each, and points at the
declaration for the list:

```
get_skill returns written expertise — how a trade actually works, what its
conventions are, what sizes and hierarchies and habits it has. There are two
kinds: occupations, which are trades — a wedding designer, a photographer, a
logo designer, a comic artist — and foundations, which are the craft under all
of them — colour theory, composition, typography, visual hierarchy, light and
shadow, grid systems, depth, style, texture, type on a picture. The whole list
is in get_skill's own description, a line on each.
```

Two more paragraphs changed with it: the one that said *get one at the start*
now says get the occupation **and the foundations**, with a third example on a
page of photographs under a title, and a new one says several in a call and more
than one call — which is the §IV.5 change the model would otherwise never know
about, since a ceiling is only visible in the sentence that refuses it.

**And the arithmetic went the other way.** Dropping thirteen names was supposed
to shorten the paragraph; the examples and the calls paragraph more than spent
it, and the instruction went **2,726 → 2,832** tokens (`npm run floor`). The
saving is real but it is not in this file — it is that adding the forty-eighth
skill now costs one catalogue line and nothing here, where before it cost a
rewrite of a paragraph that is sent on every round.

What the pin becomes: `instruction.test.mts` used to hold every registry name
against this prose, and now holds the chain instead — the prose names the two
kinds and points at the catalogue, the catalogue holds every registered name with
its summary, and a third test fails if somebody puts the enumeration back.

### 6. How to work

The loop discipline. This is what stands in for the constants file agent 4 had.

```
Work in this order:

1. Get the skill for the job.
2. Look. get_page or read_canvas if there is already something. list_gallery,
   and get_image for the ones that matter.
3. Make it. Place, size, order.
4. Look again — get_page. You are looking at the thing you just made, and this
   is the only way you find out that the headline overlaps the photograph.
5. Fix what you see. Then stop.

Two looks. Not five: a page you keep adjusting is a page the user is waiting
for, and the third pass is you disagreeing with yourself rather than with the
page.

Never place something you have not looked at. A picture chosen off its tags
alone is a picture chosen off somebody else's description of it.

When you are done, say what you made and why, in a sentence or two, naming the
photographs by what they are and never by their ids. If something did not work
— a picture that would not fit, a size that had to give — say that too. The
user cannot see you working.
```

## III. Vision — what the model actually sees

The answer to "does it see pixels" is yes, and this section is what that costs
and how it is paid.

**Pictures ride as GCS uris, never as bytes.** `{ fileData: { fileUri, mimeType } }`,
which is how agents 2, 3 and the layout reader already send images and how the
board render already reaches agent 6 (`tools.ts`, the attached-page path).
Nothing is base64'd into the request, so a 1.8 MB PNG costs a uri on the wire;
Google fetches and tiles it. **We do not scale for the model's limit** — the
tiling is theirs. We scale for our own reasons, which are the resolution ladder
that already exists: 640px thumbnail (`THUMBNAIL_MAX_EDGE`), 1600px board render
(`BOARD_RENDER_MAX_DIMENSION`), original.

Which copy goes with which read:

| read | picture | source |
|---|---|---|
| `get_image` | the original | `Reference.gcsUri` |
| `get_modification` | the version's own bytes | the version row's `gcsUri` |
| `list_gallery` | **none** | a catalog is a list, and 24 pictures is 24 uris on every round of the turn |
| `get_page` | the page rect, ≤1600px | `renders/<dialect>/pages/<pageId>@<revision>.png`, drawn on demand (§III.2) |
| `read_canvas` | the whole board, ≤1600px | `renders/<dialect>/boards/<boardId>@<revision>.png`, drawn on demand |

### 1. The picture window — the one cost lever that matters

An image part sent on round 3 of a turn is re-sent on rounds 4, 5 and 6, because
the transcript is the context. This is already written down as a risk for agent
6 ("a page render is an image on every tool round of a turn; two pages on a
three-round turn is six copies of it"), and agent 8 makes it the dominant cost:
a look-make-look loop takes at least three pictures, and it takes them early.

So the picture does not stay. **`PICTURE_WINDOW` = 5**: a picture rides on the
round its tool returned it and on the four after it, then the part is dropped
from the transcript and replaced by a line saying what was dropped and which
call brings it back.

Two was the first answer and its argument was the *shortest* honest use of a
picture — look, place what was seen, reason about what was placed, which spans
exactly one intervening round. Five is the second and its argument is the
longest: a design that reads a page, cuts a picture, puts it down, looks again
and then compares the two looks holds the first picture across four rounds of
its own work, and at two it was doing that comparison blind.

**And the window is deduped**, which is what made five affordable rather than a
change of mind about the cost. A window that counts *rounds* cannot see the same
picture arriving twice, and a design that reads a page, works on it and reads it
again is the ordinary shape of the loop rather than the odd one: the two reads
return the same uri, and the request used to carry it twice. Now the same
picture is sent once however many calls returned it — keyed on the uri, which in
this system is an object name and therefore identity, so a page that *changed* is
a different object and is correctly sent again. The copy that survives is the one
nearest the end of the transcript, except when the same picture stands above the
first round, where the copy that survives is the one this window may not touch —
that one is re-sent on every round whatever happens here.

The line matters as much as the drop: a picture that silently stops being there
is a model answering about an image it can no longer see, which is the one
failure that looks like ordinary bad taste from the outside. A repeat gets its
own line and a different one — nothing aged out, and calling the tool again would
return the same bytes it is already looking at, so the sentence says *where* the
picture is rather than how to fetch it again.

The count both of them are reported under is one number, `picturesDropped`
(§VIII): both are an image part this request stopped paying for, and which cause
it was is legible in the transcript from the note's own wording.

### 2. Drawing on demand — `renderForModel`

The picture a vision tool sends is **drawn when the tool is called**, at the
revision the tool just read the scene at. There is no waiting for a tab, no
20-second idle, and no picture of a board that has moved on.

This is not how the pictures in this system were made until now. A page render is
made by the browser at send time and a board render by the tab after 20 s of
autosave idle (tech-spec §V.5.1, `canvas.md` §VIII); both are pinned to the
revision they are of, and a picture of any other revision is refused rather than
sent. That is right for the user's attachment and useless inside a tool loop,
where **every write agent 8 makes moves the revision** — so `get_page` after a
`transform_on_canvas` asks for an object nobody has drawn and gets a 404, not a
stale picture. Nothing is stale; nothing is there.

`src/server/render/for-model.ts`:

```
renderForModel({ boardId, pageId? })
  -> { uri, revision, drawn: "cached" | "made" }
   | { failed: true, reason }
```

**Cached by revision, because the naming already anticipated it.** Page renders
are named per revision and never overwritten. So the function is a HEAD and a
maybe-draw: an object at the current revision is used as it stands, and drawing
one is idempotent — two tool calls in one round race to write identical bytes to
one name.

- `renders/<dialect>/pages/<pageId>@<revision>.png`
- `renders/<dialect>/boards/<boardId>@<revision>.png`

**Amended (the eighth fix).** The `<dialect>` segment is new and is not
cosmetic: a name carrying only the revision says *which scene* and says nothing
about *which renderer*, so a board nobody has edited kept being served bytes
drawn by whichever renderer was in the process the day it was last looked at.
`MODEL_RENDER_DIALECT` (`lib/scene/moodboard-render.ts`) is the fingerprint of
the renderer's own arithmetic over one specimen scene, and the block at the end
of §III.2.1 is the measurement that made it necessary. The prefix is unchanged,
so the lifecycle sweep still takes both generations.

*Bumped to `910f1230` (2026-08-29) with the real-typography render: text set
through resvg with each face's own TTF, the internal `family` column on the
font table, and a Google-variant specimen added to the dialect sheet — every
page with type on it draws differently, so every cached picture from before is
a stale dialect by construction.*

**A prefix of its own**, not the browser's `pages/<pageId>@<revision>.png`. Two
reasons and both are about not mixing kinds of picture: the browser's is a real
excalidraw export and this one is not (below), so sharing a name would hand the
model an exact export on some rounds and an approximation on others — two
dialects for one read. And the browser's object is the *user's* attachment; a
server write into it would put a picture the user never took where the row that
records their message says theirs is.

**Boards need the per-revision name too.** `boards/<id>/render.png` is
overwritten in place and cache-busted by a query parameter — a mutable object.
Handing a mutable uri to Gemini as `fileData` is sending a picture that can
change between the round it was sent on and the round it is re-sent on, which is
the one thing the revision discipline exists to prevent. The UI keeps its
mutable thumbnail; the model gets its own immutable one.

**How it draws.** With `sharp`, which is already a direct dependency and already
cuts crops (`src/server/references/cut.ts`). Not a headless browser: excalidraw's
own export is DOM-bound, and a Chromium binary in a Vercel function is a cold
start on every tool call that wants to look at a page.

The thing that makes this tractable is who the picture is for. **It is for a
model judging an arrangement, not for the user**, so it has to be geometrically
exact and does not have to be pixel-identical to the export:

- the page rect is the frame, and everything is clipped to it — a block running
  off the edge is drawn cut off, because that is what `clipped` means and the
  model is being asked whether it looks wrong;
- image elements are composited from the reference bytes at the placed size and
  angle, cropped to the region shown where the element is itself a crop — the
  resolution ladder that already exists picks the copy
  (`moodboard-resolution.ts`), so a thumbnail-sized placement costs a thumbnail;
- text is set through resvg with the face's own TTF handed in per call, so the
  model sees the real face and can correct a face choice. The classic seven
  are decompressed into `.fonts/` by `mirror-excalidraw-assets.mts` (the same
  script that mirrors the browser's woff2 into `public/excalidraw-assets`);
  any Google Fonts family an element rides (`customData.font`) comes from the
  on-demand library (`google-fonts.ts`), cached under `/tmp/google-fonts`. No
  fontconfig and no system fonts are involved. A face whose file cannot be
  found is not swapped for a stand-in — the element is drawn as its outline
  and named undrawn, the same contract an unreadable photograph has;
- rectangles, ellipses, lines, arrows and section frames are SVG strokes;
- **anything outside that subset is drawn as its bounding outline and named in
  the tool's text as undrawn.** A freedraw scribble missing from the picture is a
  model reasoning about a page that has something on it nobody mentioned; an
  outline with a line of prose is the truth.

Z-order is array order, and page members are drawn in their own run, exactly as
the scene reader already resolves them.

**It never replaces the export.** `moodboard-export.ts` is the user's picture and
stays theirs; nothing this function draws is ever shown to a user, because
labelling an approximation as their export is the one way this becomes a bug
report about a font.

**Budget.** `RENDER_TIMEOUT_MS` = 8,000 and `RENDER_MAX_DIMENSION` = 1,600 — the
board render's own cap, inherited, since the model's tiling is the same either
way. On timeout or failure the tool answers text-only **and says the renderer
failed**. That sentence matters more than it used to: a missing picture was the
ordinary case before this section and is an error after it, and a model told
nothing would answer about a page it never saw.

**Lifecycle.** One object per revision per page means a twelve-round turn can
leave a dozen PNGs behind. A bucket lifecycle rule deletes the `renders/` prefix
after 7 days; nothing ever reads an old one, because every read is at the
revision it just took.

**What it retires.** Tech-spec §VI's "a page can only be pictured by a tab with a
canvas in it, which is why the chat's picker is scoped to the board being shown"
stops being true the moment this exists: a server-side raster can draw any page
of any board, and the picker's scope becomes a UI choice rather than a limit.

### 2.1 Should it replace the browser's page render? Not yet.

Worth settling, because the obvious next thought is that two renderers is one too
many — and the thing that makes it tempting is a fact worth writing down:

**The browser's page render is never shown to a user.** The whole chain is
`pageRenderObjectPath` → `page-picture.ts` in the tab → `page-attach.ts` → the
conversation row → the part builder in `tools.ts`. Nothing draws it back. The
chip under the composer is built from scene data — how big the page is, how many
blocks are on it — not from the PNG. So it is already a picture the browser makes
*purely* so a server-side model can see it, which is this function's entire job.

That is not true of the board render. `boards/<id>/render.png` is the tab
thumbnail, it is user-visible, and it stays browser-made whatever happens here.

What replacing it would buy:

- one renderer rather than two, which also retires §III.2's separate `renders/`
  prefix — that prefix exists only to keep two kinds of picture from reaching the
  model under one name;
- the deletion of the hardest code in the send path: flush, export, sign per
  revision, `PUT`, conflict, re-render once, fall back to text-only — both halves;
- pages of boards with no mounted tab becoming attachable, for real rather than
  in principle;
- the end of a race class — "the board was edited while the message was being
  sent" stops producing a text-only attachment.

What it would cost, and why the answer is still no:

1. **Fidelity, with a much wider blast radius.** The attachment stops being an
   exact export. The user picked *this page as they see it*, and a shape drawn
   differently is a model judging a picture the user is not looking at. It is the
   same risk agent 8 already carries — but moved onto agent 6's ordinary turns,
   which is most turns in the product.
2. **Latency moves onto the user's critical path.** The export happens in the
   browser today. After, the server draws up to `PAGES_PER_MESSAGE` pages before
   the first model call — up to 16 s of added time-to-first-token at the timeout.
   The per-revision cache does not help: the first send after an edit is always a
   cold render, and that is exactly when people send.
3. **New server CPU inside a request**, compositing 1600px images in a function.
4. **The undrawn-outline rule becomes user-facing.** "These strokes were not
   drawn" is a fair internal note to an agent looking at its own work and reads as
   a product defect to a user who attached a page they drew by hand.
5. **Fonts have to be exactly right.** The tab renders with loaded webfonts; the
   server needs them through fontconfig or an embedded `@font-face`, and
   text-heavy pages are where a mismatch shows first.
6. **The browser path would survive anyway** as the fallback for a timeout —
   leaving two renderers *and* a switch between them, which is worse than either
   alone.

So: build `renderForModel` for agent 8, run it on real boards, and diff its output
against the browser export on the same pages. If they agree, the replacement is a
follow-up that deletes code. If they do not, that was found out without having
degraded every ordinary turn to learn it.

**A disagreement `render:check` could not have found.** The comparison above only
runs on boards a browser has exported at the revision they are now on — five of
the thirty here — and none of them carries a shape agent 8 drew. Read against
excalidraw's own shape generation instead of against its output, the two
renderers disagree about one element: a `line` whose path closes. Excalidraw
hands roughjs a fill for a linear element exactly when `isPathALoop` holds (three
points or more, ends within eight scene units), so a closed loop drawn with the
line tool is a filled polygon in the export and was an outline here — a user's
colour block reaching the model as empty page. Fixed in the direction the export
sets (`rasterise.ts`'s polyline now takes whatever fill the plan left on it), and
the *reads* fixed in the other direction at the same time: `shapeAppearance` had
been reporting a stored `backgroundColor` on open lines, arrows and frames that
neither renderer paints (canvas.md §XI.5). One predicate, `paintsInside`, is now
the whole of the rule.

It is worth saying what this does to the standing answer above, which is nothing:
no line and no frame on this database carries a fill (108 and 84, every one
`transparent`), so `render:check` comes back byte-identical on all five boards
and no census moves. What it changes is the confidence the *method* deserves. A
grid of luminance cells over five boards is a check on the pages somebody
happened to export, and the two defects this renderer has had that mattered — the
frame stroke and now the closed loop — were both found by reading the package's
own source. The comparison catches drift on drawn work; it cannot say anything
about a field nobody on the database has ever set.

**The third one, and the first that shows on work already drawn.** Read the same
way — against `generateRoughOptions` and against what the SVG export puts on the
node it draws each shape with — the two renderers disagreed about a stroke in
three more places, all of them reachable from `restyle_on_canvas`'s
`strokeStyle`. The run: excalidraw's dash is a fixed 8 units of ink with a gap of
8 plus the width, and this renderer drew four times the width on and four off, so
a hairline dashed border came out at a quarter of the export's period. The
weight: a non-solid stroke is drawn half a unit wider, which is excalidraw's own
compensation for turning roughjs's second pass off, and at roughness 0 that
compensation is the whole of the difference. The cap: the export sets
`stroke-linecap: round` on *every* shape it draws and this renderer set it only
for `dotted`. All three fixed in the direction the export sets, with the run and
the weight moved onto the plan because both are scene-unit numbers and the plan
is what holds the scale (`canvas.md` §XI.2's **Corrected** block).

The cap is the one that separates this from the closed loop. A dash is a field
nothing on this database has ever set — 351 stroked elements, every one `solid`
or absent — but a round cap is on both ends of every *line*, and there are 110 of
those across 12 boards. So this is the first renderer defect here that was
drawing real work wrong rather than waiting to. It still comes back invisible to
the comparison: none of the five boards `render:check` can run on carries an open
path, so the output is byte-identical for the seventh iteration running — 1
AGREES / 4 CLOSE, the same percentages to a tenth. Three defects, three found by
reading the package's source, three that `render:check` structurally could not
have seen. That is now less an observation than the standing expectation of the
method, and it is worth reading the other way round: what this comparison is good
for is catching *regressions* in what it already covers, not finding what is
wrong.

**The fourth, and the first that was drawing real work wrong at every scale.**
A rounded corner is one more scene-unit number, and this renderer was applying
excalidraw's ceiling on it in output pixels — the arithmetic lived in
`rasterise.ts`, which is handed a box the plan has already scaled, so a
page-wide panel came out with the same 32px corner in a thumbnail of a whole
board as in a picture of one page. It also held only one of excalidraw's two
roundness rules, the capped one, so a line's uncapped quarter would have been
squared off at the same 32. Fixed by moving the radius onto the plan
(`ShapeDraw.radius`) beside the dash and the weight — `canvas.md` §XI.2's second
**Corrected** block carries the rule and the census.

This is the first of the four with a number behind it that is not zero: 144 of
189 rounded-rectangle draws on the database were wrong, median 1.23x too round.
And it is the first where the comparison's blindness has a third cause worth
naming — beyond "the field is one only the dialect can set" and "none of the five
boards carries the shape", the one board that *does* carry a rounded rectangle
renders at scale 1, and at scale 1 the defect is arithmetically absent. A
comparison run on five boards is a comparison run on five scales, and a defect
that is a function of the scale needs the picture to be downscaled before it
exists.

**The fifth, and the first where the field is one the *toolbar* sets by default.**
The second **Corrected** block above left two gaps standing; the one that shows
is closed. Excalidraw draws a `line` or an `arrow` carrying `roundness` with
roughjs's `curve` rather than its `linearPath` — a Catmull-Rom spline through the
points, with the ends duplicated so it still starts and finishes on them — and
this renderer drew straight segments for every linear element there is.
`canvas.md` §XI.2's third **Corrected** block carries the arithmetic and the
three build decisions, including the one that runs the other way from the last
two: the spline stays in `rasterise.ts`, because unlike a dash run or a corner
radius it holds no scene-unit constant and does not care what the picture was
scaled by.

The census reads both ways at once again, and this time the two halves point in
opposite directions from the round cap's. Nothing on this database moves — all
110 lines stored are two-point, and a spline through two points is that chord —
so `render:check` comes back at the same 1 AGREES / 4 CLOSE for the eighth
iteration running. But the *reason* it is latent is not the usual one. The four
before this were fields only the dialect could set, or shapes nobody had drawn;
this one is `currentItemRoundness`, whose excalidraw default is `"round"`. The
ordinary three-point line a user draws with the line tool is curved, and it was
being drawn as a dogleg — off the chord by a twelfth of a leg at the middle of
one. What the database says is not that the case is rare, it is that nobody has
yet drawn a line with a bend in it.

That is the fifth defect in a row found by reading the package's source rather
than by the comparison, and it sharpens what the comparison is for one more turn:
it is a regression guard over five exported boards, and every question of the
form "does this renderer agree with excalidraw about field X" has been answered
by opening `scene/Shape.ts`.

**A sixth disagreement, and the reason the five before it could not be seen.**
The last field on the shape table the picture was not reading is `roughness`,
whose excalidraw default is `ROUGHNESS.artist` **1** — so every shape a user
drags out with the toolbar is drawn by hand, twice over, and this renderer drew a
ruled rectangle. `fillStyle` is the same field one layer in: a hachured block is
lines with paper between them and this painted it solid. Both now go through
roughjs's own generator with the element's own `seed`, which is what excalidraw
does (`ShapeCache`), so the wobble is the *same* wobble rather than a plausible
one. canvas.md §XI.2's fourth **Corrected** block is the design and the five
build decisions.

And then the comparison moved, for the first time in six iterations of renderer
work — which took finding out why it never had. **`render:check` was reading a
cached picture.** It asked `renderForModel` for "mine", and that function names
its object by board and revision alone (`modelBoardRenderObjectPath`), so a HEAD
that hits returns bytes drawn by whatever the renderer was on the day the board
was last opened. Every renderer fix since the object was written was therefore
invisible to the comparison *by construction* — not because the sample was small,
not because the field was latent, but because the picture being compared was not
the one the code produces. The script now plans and rasterises directly, which is
what it was always about.

Drawn fresh, all five comparable boards move and every one of them improves:

| board | before (cached) | after (drawn fresh) |
|---|---|---|
| cmt0utw5k0000 @6 | CLOSE 3.5%, mean 0.018 | CLOSE 3.5%, mean 0.016 |
| cmsxupppn0019 @11 | CLOSE 4.7%, mean 0.023 | CLOSE 4.2%, mean 0.022 |
| cmsx3ve93000p @7 | AGREES 0.0%, mean 0.005, worst 0.110 | AGREES 0.0%, mean **0.001**, worst 0.067 |
| cmsweinax0001 @21 | CLOSE 6.2%, mean 0.029 | CLOSE 6.2%, mean 0.025 |
| cmsvg8f9c0000 @31 | CLOSE **2.4%**, mean 0.007, worst 0.220 | **AGREES 0.0%**, mean 0.000, worst 0.016 |

The last row of the table is the sketched rectangle — the one shape on this
database carrying a roughness, and the first live case any of these six fixes has
had. The other four rows are the dash run, the round cap, the corner radius, the
closed loop and the spline arriving in the comparison at once, four iterations
after they were written.

**What this did not fix — now built, and it was not a cost decision.** The
staleness was never the script's alone: a *board* whose model picture was drawn
before a renderer fix kept serving that picture to agent 8 until the object aged
out of the bucket (`MODEL_RENDER_LIFECYCLE_DAYS` 7) or the user edited the board
and bumped its revision. The object name is per revision on purpose — a
`fileData` uri is re-sent on every later round of a turn, so an object that can
change under it is a picture that stops being the one the answer was about
(`moodboard-render.ts`) — so the fix is a renderer token in the name, and the
worry about it was the cost of invalidating every stored render on the day it
lands. **Measured, that cost is one redraw and the picture was wrong anyway**;
the eighth block at the end of this section is the census and the build.

**A seventh disagreement, and the first that is not about a shape at all: the
*framing*.** With the cache gone the comparison could finally be read, and what
it said was that three of the five boards were CLOSE with the worst cell sitting
on a hard horizontal edge — the top of a photograph, in the right place in both
pictures and a few rows apart. That is not a shape drawn wrong, it is two crops of
the same board, and while it stands nothing else in the picture can be measured:
every edge lights cells because the whole picture is shifted.

Excalidraw's export frames itself with `getCanvasSize(getRootElements(elements),
exportPadding)`, and `boardRenderFrame` framed itself with *every* element and no
padding rule of its own beyond `BOARD_RENDER_PADDING`. Three differences, all in
that one line:

1. **The frame's name is part of the export's bounding box.**
   `prepareElementsForRender` runs `addFrameLabelsAsTextElements` whenever frame
   names are on — which is the default — and each label is a real text element at
   `frame.y - FRAME_STYLE.nameOffsetY`, lifted by its own height. A single line at
   `nameFontSize` 14 and `nameLineHeight` 1.25 is 17.5 units, so **every frame
   reaches 20.5 units above its own top edge** and the topmost page on a board
   pulls the export's ceiling up with it. Reserved now (`FRAME_NAME_BAND`).
2. **A page's members are not root elements.** `getRootElements` keeps frames and
   whatever no frame claims, so a photograph hanging off the edge of a page does
   not widen the export — it is clipped at the edge instead. This renderer
   *already clipped it* (`boardRenderPlan`'s `pageClips`) and still reserved the
   margin, which is blank board beside ink that is never drawn. The two answers
   now come from one walk of the scene, so the picture cannot frame itself around
   a different set than it draws. Membership stays geometric rather than
   `frameId` (§V.3) — that divergence is deliberate and unchanged.
3. **The pixel size drops the fraction.** `exportToCanvas` assigns `width *
   scale` to `canvas.width`, an `unsigned long`; `renderCanvas` rounded. One
   pixel, and it is the difference between "the same crop" and "a pixel taller".

The census is every comparable board on the database, and the fix took the whole
comparison from three CLOSE to five AGREES:

| board | before | after | size |
|---|---|---|---|
| cmt0utw5k0000 @6 | CLOSE 3.5%, mean 0.016 | **AGREES 0.0%**, mean 0.001 | 1600×1600 → **1584×1600**, theirs 1584×1600 |
| cmsxupppn0019 @11 | CLOSE 4.2%, mean 0.022 | **AGREES 0.0%**, mean 0.002 | 1600×1600 → **1584×1600**, theirs 1584×1600 |
| cmsx3ve93000p @7 | AGREES 0.0%, mean 0.001 | AGREES 0.0%, mean 0.000 | 1600×917 → **1600×933**, theirs 1600×933 |
| cmsweinax0001 @21 | CLOSE 6.2%, mean 0.025 | **AGREES 0.0%**, mean 0.001 | 1600×917 → **1600×933**, theirs 1600×933 |
| cmsvg8f9c0000 @31 | AGREES 0.0%, mean 0.000 | AGREES 0.0%, mean 0.000 | 685×420, no frame on it |

Four of the five carry a frame and all four now agree with the stored export on
both dimensions exactly. This is the first defect in this area with a live case on
*every* board that has the field — a frame is what a page is, so the framing was
wrong on every board anybody has ever made here.

**The name itself is still not drawn, and that is the standing decision widened
rather than a new one.** `draw()` has always said so and given the reason: the
page's name reaches the model in words on the same answer (§V.4), and at a
board-wide downscale a 14-unit grey line is a smudge rather than a word. What was
missing was the *room*, which is a framing question and not a drawing one. The
residue is visible and small: the worst cell on both 1600×933 boards is now 0.067
at grid (1,1) — the top-left corner, which is exactly where the label sits.
Drawing it is a separate question and would cost the picture nothing but noise on
a wide board; it is flagged here rather than decided.

**A fourth cause of the comparison's blindness, now that three have been named.**
A registration error swamps everything: until the two pictures are the same crop,
a per-cell grid measures the offset and nothing else. The three CLOSE verdicts
that stood for six iterations were one defect wearing the costume of many, and the
tell was in the report all along — `framing 1.0% apart` and `1.7% apart` are
printed on every line, and a picture 16 pixels shorter than the export it is being
compared to is a finding before any cell is looked at.

**An eighth fix, and it is not a disagreement — it is that nobody was served the
agreement.** Seven fixes into this section, `render:check` says five boards of
five AGREE with excalidraw's own export. What agent 8 is handed is a different
question, and it was answered by listing the bucket: of 257 stored model renders,
**24 name a board or page still at that revision** — the ones a look today would
be served — and **24 of 24 disagreed with what the renderer draws now**. Five of
them are board pictures and they are wrong by the whole of iteration 45's framing:
up to 6.1% of the comparison grid apart and up to 16 pixels of crop. The other 19
are page pictures, byte-different at a mean the grid rounds to 0.000 — the fixes
they are missing are sub-cell, which is exactly what a grid cannot see and what a
byte comparison can.

So the renderer signs its own output. `MODEL_RENDER_DIALECT` is eight characters
in the object path (§III.2's amended list), and it is the FNV-1a of the plan of
one specimen scene — `DIALECT_SCENE` in `lib/render/render-dialect.ts`, one page
carrying a ground, a photograph at 40% and rounded, a dashed rounded panel, a hachured
ellipse at roughness 1, a cross-hatched diamond, a flat rule, a closed spline
loop, a two-headed arrow, a freehand stroke, two faces of type and a rotated
zigzag off the page. Every rule this section corrected would move it.

The photograph is rounded rather than merely faded because `rounded` became a
picture's field (`canvas.md` §XI.2) and the corner now rides on the plan as
`ImageDraw.radius`: a specimen carrying only the fade would have certified the
image-corner rule without ever looking at it. That widening is the first bump of
this constant — `196f1eea` → `c6b5aa48` — and it is the mechanism working, not a
cost: every stored render older than it was drawn by a hand that squared a
rounded photograph.

Three decisions inside that, each of which could have gone the other way:

1. **The plan, not the pixels.** Every one of the eight disagreements landed on
   the plan (the dash run, the corner radius, the spline, the sketched walk, the
   ink box, the name band, the truncation). The plan is pure arithmetic over
   static tables, so the fingerprint is the same eight characters on every
   machine, where a hash of PNG bytes would move with libvips. The honest limit
   is written into the module: **a change confined to the rasteriser moves
   nothing and is a hand bump.** Each draw's `drawnBounds` and `textOverflow` go
   in beside the plan, because a text draw carries the string and the face and
   not the width they set to — a ruler like iteration 39's would otherwise be
   invisible to it.
2. **Pinned as a literal, computed by a test.** `moodboard-render.ts` is read
   from the browser and `render-dialect.ts` pulls in the whole plan and roughjs,
   so the constant is written down rather than imported. The tripwire is a test
   asserting the two agree, and it fails with the new value in its own message —
   one constant, one source of truth, and forgetting to bump it is a red suite
   rather than a week of stale pictures.
3. **A path segment rather than a suffix.** One list call answers "how much of
   this bucket was drawn by a renderer nobody runs any more", and the segment
   sits under `renders/`, so the lifecycle rule that sweeps the current
   generation after a week sweeps the old one too. The 24 stale objects are
   unreachable from the moment this lands and gone within the week.

Verified end to end against the real bucket: a board's first look after the
change missed and drew (`renders/196f1eea/boards/…@21.png`), the second was a
`cached`, and the object it wrote is byte-identical to a fresh rasterisation —
which is the property the previous 24 had lost.

### 3. The invariant

**No vision tool ever sends a picture of a revision other than the one it read
the scene at, and it reads at call time.**

Both halves are load-bearing. "At call time" is what makes the picture current —
no state carried from earlier in the turn, no render taken before the last write.
"The one it read" is what makes it *honest*: a board can move between the read
and the send, and chasing the true latest is a race nobody wins. One read gives
both the words and the picture, the revision is stamped on the answer, and the
two can never describe different scenes.

| tool | what it reads | what "latest" means |
|---|---|---|
| `get_page` | the board row, once | §V.4's text and the page raster, both off that read |
| `read_canvas` | the board row, once | every object's geometry and the board raster, both off that read |
| `get_image` | the reference row | nothing to stamp — bytes are immutable |
| `get_modification` | the version row | nothing to stamp — a version is its own row, and a re-cut is a new row rather than new bytes under an old id |

The gallery half is trivial by construction and is written down anyway, because
"always the latest" reads as a promise that something is being kept in step, and
here nothing is: a picture in the gallery never changes. What changes is which
pictures exist.

One consequence for §III.1's window: a dropped picture is cheap to get back. The
re-fetch is a HEAD against a name that already exists if nothing was written
since, so a model that looks again after two quiet rounds pays a uri rather than
a render.

## IV. The toolsets

Fourteen tools in four sets, plus the door agent 6 opens.

| set | tool | new? | cost | ceiling |
|---|---|---|---|---|
| canvas | `read_canvas` | inherited | query + picture | — |
| canvas | `put_on_canvas` | inherited | query | 10 per call |
| canvas | `remove_from_canvas` | inherited | query | 10 per call |
| canvas | `transform_on_canvas` | inherited | query | 10 per call |
| canvas | `reorder_on_canvas` | inherited | query | 10 per call |
| canvas | `restyle_on_canvas` | **new**, shared | query | 10 per call |
| pages | `get_page` | **new** | query + picture | 1 page per call |
| pages | `set_page_background` | **new**, shared | query | 1 page per call |
| pages | `duplicate_page` / `resize_page` / `move_to_page` | inherited | query | — |
| pages | `discard_page` | inherited | offer | 1 per call |
| gallery | `list_gallery` | **new** | query | `CATALOG_LIMIT` 24 |
| gallery | `get_image` | **new** | query + picture | 1 per call |
| gallery | `get_modification` | **new** | query + picture | 1 per call |
| gallery | `discard_image` | inherited | offer | 1 per call |
| image | `generate_image` | changed ending | model (image) | `GENERATE_CALL_LIMIT` 2 per turn |
| image | `crop_image` | changed ending | model (vision) | `CROP_CALL_LIMIT` 2 per turn |
| skills | `get_skill` | **new** | query | 8 per call, 12 per design, any number of calls |

### 1. Canvas toolset — inherited whole

`canvas.md` §XI, contracts in `orchestrator-tool-reference.md` §III. Six tools
over one `CanvasObject` shape, five of them already built, already sharing the lib modules
(`src/lib/canvas-objects/`) with the user's own controls. Agent 8 gets them
unchanged: same handles, same y-first boxes, same `boxUnit`, same per-company
`z`, same refusals (pages never rotate, locked refused whole, `above`/`below`
across companies refused), same plumbing (revision-guarded writes, the per-board
keyed queue, no-op detection, remainders in every result).

One addition, and it is to `read_canvas` alone: **the board picture rides with
the answer**, drawn at the revision the geometry was read at (§III.2) and subject
to §III.1's window. The geometry read was built for a model that could not see; a
model that can should be looking at the thing the numbers describe.

The sixth is **`restyle_on_canvas`** and the fourth object kind under it
(`canvas.md` §XI, "the style dialect"). It is new, it is designed for this agent,
and it is nevertheless agent 6's too — a door that forks is a board that drifts,
and there is no version of "make that band navy" that should mean two different
things depending on which agent said it.

What it buys is the difference between a design and a diagram of one. A shape
with a fill is a colour field, a scrim, a border, a rule; type with a family and
a colour is type. Without them agent 8 places photographs and hand-drawn black
lettering on white, which is agent 4's output with a tool loop bolted to it and a
larger bill. The scrim in particular is the thing §II.2 spends prose on, because
it is the most common way a page fails and it fails only in the picture.

Two things it deliberately does not get. **Arrows, diamonds and freehand strokes**
are not in the dialect — they are diagram vocabulary or unauthorable point arrays
— and they are named rather than hidden: the read carries an `unaddressable`
remainder so a model looking at a scribble in the picture is told why it has no
handle for it (`canvas.md` §XI.1, invariant 13). And **`set_canvas_background` is
not agent 8's** (§XI.3): the board is the user's desk, agent 8 works inside one
page, and the ground it actually needs is `set_page_background`.

Nothing here is agent-8-specific, which is the point. Two agents writing one
scene through two implementations is how the user's board and the model's board
drift.

**Built, and it did not fork.** `restyle_on_canvas` is one module
(`object-restyle.ts`) behind one declaration, executed for agent 6 in `tools.ts`
and for agent 8 in `designer/canvas.ts`, both through `tool-canvas` — so the
only thing either caller decides is whether a board tile is built afterwards,
which is the same one thing the other five leave to them. Its own decisions are
in `canvas.md` §XI.2 and `orchestrator-tool-reference.md` §VI; the one worth
having here is that it refuses **per field**, where the put refuses whole: an
object that already exists keeps what a call could not set, so `{ opacity, fill }`
on a photograph lifts the photograph and names the fill back rather than doing
neither.

### 2. Page toolset

`get_page` is the new one. Everything else is agent 6's page tools unchanged.

*Retirement note (2026-08-24).* `add_page` is still deliberately not in agent 8's
set, and the reason is unchanged: `put_on_canvas` with `kind: "page"` already
makes one and takes a box, and what size a fresh page should be is the design
decision this agent exists to make. What did change is next door — agent 6 gained
`add_board`, which files a board and draws its one empty page. That is the tool
that makes `design_page`'s `boards > 0` gate survivable now that
`compose_moodboard` is gone: declarations are resolved per round, so the round
after `add_board` files the first board is a round `design_page` is declared on.
`boardId` stays required on `design_page` — board management is the
orchestrator's job, and an agent that could file a board is an agent that can
file one nobody asked for.

**`get_page`** — args `{ boardId, pageId }`. Returns `PageAIRepresentation`
(tech-spec §V.4) — the page's own line, its blocks as boxes in reading order,
the caps and the omitted count — **plus the picture**. This is exactly what a
user-attached page carries (§V.5.3), asked for by the model instead of chosen by
the user, which is the whole design: one representation, two doors, no second
dialect.

The picture is drawn on the call (§III.2), so it is of the page as it stands at
the revision the blocks were read at — including a change agent 8 made two rounds
ago. Where the renderer fails or times out, the text says so in the same sentence
that carries the blocks, the rule §V.5.3 already sets ("whether a picture rides
above the text is said in the text, never left to be assumed"). That is now an
**error** rather than the ordinary case, and it is said as one: a model reading a
page it was told it cannot see is strictly better than a model assuming it saw
one.

**Amended — the answer says two things about the page that cannot be read off
the blocks.** The blocks are boxes and words; they carry no colour and no
totals. `get_page`'s text now carries `occupancyNote`'s sentence — where the
work stands, band by band (§VIII) — and, since `contrastNote`
(`lib/render/contrast.ts`), one more: which lines of type on the page stand too
close in colour to what they are laid on, each named by the id
`restyle_on_canvas` takes, with both hexes, the ratio it came in at and the
ratio its size wants. Both are arithmetic over the same plan the picture is
drawn from, so a round the renderer failed still carries them and the two can
never be of different revisions.

Four things the build settled (2,932 → 2,942 cases):

- **It is silent on a page that clears**, unlike the standing note beside it.
  Where the work stands is a fact about every page; what cannot be read is a
  fact about a few, so a sentence confirming the ordinary case would ride on
  every round of every design for nothing. Over the 79 pages on the development
  database it speaks on **31** and costs a median 479 characters when it does.
- **It names three and counts the rest.** Those 31 pages carry 206 failing
  pairs and **125 are past the cap**, because a page that fails mostly fails
  *entirely* — which is the palette's fault rather than any one line's (§IX.5).
  Three lines named and "and 16 more" is the finding; sixteen ids is a
  paragraph, and the design that laid them already knows what it did.
- **The ids are filtered through `readableTarget`, not through the plan they
  came off.** A bound label is drawn like any other line, so its ratio is real
  and its id is one every canvas door refuses by name — naming it here would be
  stage 0's palette-label loop reopened at a door built after it. Its pair is
  still *counted*, so the total is the one `contrastLine` reports for the same
  page. On today's database the filter drops **0 of 206**: like the tidy's type
  floor (§IX.5), it is latent, and saying so is more honest than implying a
  symptom.
- **It costs no declaration tokens.** It rides in the answer's text rather than
  in `GET_PAGE`'s description, so both floors are byte-identical across the
  change — 15,112 and 10,503, measured on the stashed tree and on this one.
  (The boards shape reads 15 higher than §IX.5's last figure of 15,097 and none
  of it is this: `npm run floor` primes on the development project, and the two
  live runs below wrote a page into it. Worth knowing before the next change
  reads a floor move off a number the run itself moved.)

**Two live runs, and the pair of them is the reading.** Both `design:check`,
same page, `gemini-3.7-flash`, $0.13 and $0.12.

The first asked for "a wholesale line sheet for a coffee roastery, in this exact
five-colour palette and nothing else" — §IX.5's warm brief, the one
`paletteContrast` says holds no pair over 1.95:1. The design called `get_page`
twice, so it read the note twice, and did nothing about it: the page came back
**29 of 29 pairs failing**, worst 1.6:1, and the one thing it did between the two
looks was move two blocks. That is the note losing to the brief, and it is the
right precedence — the ask closed the list and nothing here is a refusal — but
it means the note is loudest on exactly the pages where compliance is
forbidden, which is §IX.5's 129-of-196 finding arriving at a second door. The
design should probably *say* so in its closing line rather than going quiet;
that is a prompt question and it is not answered here.

The second asked "tighten this page", of that same page, and said nothing about
colour. Its first act after `get_page` was five consecutive `restyle_on_canvas`
calls setting the type in `#24120a`, `#3d2218`, `#4a3025`, `#5a3a2d`, `#734d3c`
and lightening the card fills to `#faeae2` and `#fcf8f5` — **29 of 29 failing
became 8 of 30, and the worst pair went 1.6:1 → 3.4:1**. None of those eight
hexes is in the brief or on the board, which is the same argument §IX.5's ink
clause was proved on: a value that could not have arisen any other way. And it
named the reason itself, unprompted — "typography, **color contrast** and
structure … high-contrast espresso and terracotta tones for clear legibility"
— against an ask whose only word was "tighten".

So the note is read and acted on when the design is free to act, and correctly
loses to a closed list when it is not. What it is *not* is a fix for the run
that made the page: the same design that laid 29 unreadable lines read the note
twice and kept them, because it had been told to.

**`set_page_background`** `{ boardId, pageId, colour }` is the other new one, and
it is shared with agent 6 (`canvas.md` §XI.4). A hex, or `"none"` for white paper.
It is a page tool rather than a canvas tool because that is what it is about — the
ground one page is printed on — and because the thing it is *not* is
`set_canvas_background`, which paints the board the user's pages sit on and which
agent 8 does not have.

It reads back on the page object rather than as an object of its own, which is
the point of the rectangle underneath it being invisible to every other tool. A
model that could see its own background in `read_canvas` would eventually move it.

**Built, and it is the one page tool here that is not forked.** `duplicate_page`,
`resize_page`, `move_to_page` and `discard_page` each carry a second description
for this agent (`DESIGNER_*`), because agent 6's words send the model to
`inspect_board` or warn it off `compose_moodboard`. `set_page_background`'s
description names `read_canvas` — which both agents hold, and which is where a
page's `background` is read either way — so one declaration serves both and there
is no clause to keep in step across two files. That is the fork rule stated
properly: it was never about sharing an executor, it is about which tool the
description sends the reader to.

The paragraph naming it lives in §II.3 with the other page tools rather than in
§II.2's canvas block, because the ground is a page's and not an object's, and it
says the trap with it: nothing on the page moves when it is painted and the ground
goes behind what is already standing there, so near-black lettering on a page just
painted near-black is a page that looks emptied without anything having left it.
The instruction cost 133 tokens and the declaration 373, taking agent 8's floor
from 9,997 to 10,503.

A live `design:check` used it on first contact and in the right order: asked for
"a dark, moody welcome sign for an evening wedding — cream calligraphy on a deep
near-black page", the model put a 1080×1920 page and its very next call was
`set_page_background(#0c0f16)`, before a single object was placed. The run still
stopped on `rounds`, and three of the twelve went on a `font` restyle to
`display` and straight back to `hand` — the round budget is the constraint here,
not the door.

`add_page` is deliberately **not** in agent 8's set: `put_on_canvas` with
`kind: "page"` already makes one and takes a box, and two doors to one act is two
prose descriptions to keep in step.

### 3. Gallery toolset

The read side of the gallery. Placement is `put_on_canvas` — the same reference
id, whether it names an original or a version — and the copy semantics are said
in the instruction (§II.4) rather than given their own verb.

**`list_gallery`** — args `{ includeModifications?: boolean }`, default true.
`list_references`' answer, renamed for the vocabulary the instruction uses:
`{ total, shown, images[] }`, one digest line each — id, title, starred, shape,
keeps, tags, unread mark — capped at `CATALOG_LIMIT` 24, with the over-cap count
said. **No pictures.** Twenty-four uris on every round is the whole budget spent
on a list the model reads once.

**`get_image`** — args `{ imageId }`. One picture, in full:

- everything agent 2 wrote, under each dimension's own name, including the
  **palette** and the **rationale** — the two fields `digestTags` flattens away
  and which nothing but this door has ever answered with;
- `drawnFrom` where the picture is one agent 8 or agent 6 drew
  (`Reference.generationPrompt`), which is the one description that exists before
  the analysis does — so a picture generated this turn can still say what it
  shows;
- **its modification versions**, one line each: id, what it was cut for
  (`editIntent`), its shape. Not the full version — that is `get_modification` —
  because a frame with nine cuts under it would otherwise be nine paragraphs and
  nine pictures for a question about one photograph;
- **the picture itself**, the original bytes.

A picture with no analysis is answered with its shape, its `drawnFrom` if it has
one, its versions and its picture, and an explicit unread mark — not with six
empty dimensions. An empty palette beside an empty rationale reads as a
photograph with no colour in it.

One picture per call rather than a list, because the picture part is the cost and
a batch of four is a batch of four images the model asked for on a hunch.

**`get_modification`** — args `{ modificationId }`. The version's own row:
`editIntent` (what it was cut for, in the words it was asked in),
`editRationale` (why the cut is where it is, in agent 3's words), the region as
`[ymin, xmin, ymax, xmax]` normalized 0–1000 against the source, the source
frame's id and title, its own shape and pixel size, its own analysis if it has
one — **and the modified picture**.

The region is worth the line: it is the difference between "a crop of the
stairwell" and "the top-left third of the stairwell", and the second is what
tells the model whether cutting again would buy anything.

**`discard_image`** — agent 6's `discard_reference`, renamed. Offer only. The
answer names what would go with it — a photograph takes its versions, and any
board showing the frame or one of those versions is left with a gap — because
none of that is visible. Taking a picture off a board is `remove_from_canvas`
and is free.

### 4. Image toolset

The tools that make bytes. Both exist for agent 6 and both **end differently**
here.

**`generate_image`** — args `{ description, aspect? }`, agent 7 (`IMAGE`,
`gemini-3-pro-image`). Everything in tech-spec §III.7 holds: the shape honoured
natively where one of the ten canvases fits and folded into the prompt where it
does not, two attempts not three, the three refusal kinds told apart, the
per-turn budget counting calls rather than pictures.

**The completion rule the user asked for, written as the contract:** the tool
call does not return until the bytes are in GCS and the `Reference` row is filed.
Not "the model answered", not "the upload was kicked off" — the id in the answer
is an id `put_on_canvas` will accept on the very next round. Concretely, the
existing `importFromUrl` ending, awaited inside the tool: the PNG into the
project's own prefix, the row (`origin: GENERATED`, `generationPrompt`, a title
off the description's opening clause, width and height read off the PNG's IHDR
bytes) and agent 2's analysis job, in one transaction, worker kicked.

The analyzer job is the one part that is *not* awaited, and the distinction is
the point: the bytes and the row are what the next tool call needs, the analysis
is not — agent 8 knows what it asked to be drawn, and `drawnFrom` on `get_image`
says so while the reading is still minutes behind. Awaiting the analysis would
put a vision call in the middle of a tool loop for a description the model wrote
itself.

A generation that made bytes but could not file them is a **failure**, not a
picture. Half-landed is the one ending a tool loop cannot recover from, because
the model has an id in its hand that names nothing.

**`crop_image`** — args `{ imageId, intention, aspect?, toObjectId? }`, agent 3
(`FLASH` vision, the box loop, `sharp` doing the cutting). The changed ending is
the one already landed for agent 6 (`orchestrator-tool-reference.md` §IV,
"`crop_reference` files the cut"): **it files, it does not offer.** The cut is
made in the turn that asks for it and comes back as a version id, usable on the
next round.

`toObjectId` replaces agent 6's `boardId` + `pageId`: agent 8 addresses a *placed
object*, so "cut this to the shape of the slot it is sitting in" is one call
naming the object, and the executor reads the shape off that object's box. The
old spelling assumed the slot came from a template, and agent 8 has no
templates — its shapes are the boxes it wrote itself.

Passing a version's id nudges that version: the ask goes to the frame it came
from with its box attached, so the cut moves rather than a cut being taken out of
a cut. Unchanged, and it matters more here — agent 8 crops as an ordinary part of
fitting a picture to a box it drew.

### 5. `get_skill`

Args `{ skills: string[] }`, where the strings are an **enum in the declaration**
— the model sees the whole catalogue and cannot ask for one that does not exist.
Returns the full text of each, plus `notFound` (which the enum should make
impossible and which is reported anyway, because a declaration and an executor
are two files).

- `SKILLS_PER_CALL` = 8, `SKILLS_PER_DESIGN` = 12, **over as many calls as it
  takes**. Two numbers because they bound two different things: the per-call cap
  is what one *answer* may carry, and the per-design allowance is what the whole
  design may read. The pair replaced 3-per-call-and-one-call when the registry
  went to forty-seven (§V.2) — three slots against thirteen names was a choice,
  three against forty-seven was a lottery.
- **Several calls**, which is the half of it that matters: a skill is now a
  decision that can be made twice — once in round 1 off the brief, and again in
  round 4 when the page turns out to be a colour problem after all. §II.5's
  ledger says the round-1 choice is the weak one, and a second call is the only
  mechanism that lets a design correct it.
- A name asked for twice is **said, not re-sent**, and costs nothing: the text is
  already in the transcript and a second copy would spend the allowance on it.
- The skills stay in the transcript for the rest of the conversation. This is the
  one thing in agent 8's context that is *not* windowed: a skill is what the work
  is being judged against, and dropping it three rounds in is the agent
  forgetting the trade halfway through the job. It is also why the allowance is a
  number at all — `SKILLS_PER_DESIGN * SKILL_CHAR_BUDGET` is the ceiling on
  characters carried to the end of the work, 72,000 in the worst case and about
  47,000 at the registry's average length.
- `SKILL_CHAR_BUDGET` = 6,000 per skill, cut on a paragraph boundary with the cut
  said out loud. A skill is a page of writing, not a book.

The declaration's description carries the catalogue with each skill's one-line
summary, so choosing does not cost a round.

## V. The skills

A skill is **text**. No model call, no retrieval, no embedding — a named file
returned whole.

### 1. Where they live

`src/server/skills/<name>/skill.ts`, each exporting
`{ name, kind, title, summary, text }`. A directory rather than a flat file so a
skill can grow references beside it; a `.ts` module rather than a `.md` file
read at runtime because **the bundler has to trace it**: a `readFileSync` of a
markdown file in a Vercel function is a skill that works locally and 500s in
production, and there is no test that catches it because the test runs on a
filesystem that has the file.

`src/server/skills/index.ts` is the registry — a `Record<SkillName, Skill>` with
the union of names exported. Two things fall out and both are wanted: the tool's
enum is generated from the registry rather than kept in step with it by hand, and
a skill added without being registered is a type error rather than a `notFound`
at runtime.

### 2. The catalogue

Two kinds, and the split is real: one says what a *trade* does, the other says
what *design* does. A wedding designer skill that re-taught colour theory would be
the same six paragraphs in seven files.

**Occupations** — how a trade works, what it makes, what conventions it has, what
sizes it works at, what its failure modes are. Thirty-seven, grouped by the kind
of work rather than alphabetically, which is also the order the catalogue is read
in.

*The page and the press*

| name | covers |
|---|---|
| `wedding-designer` | the stationery suite and the day-of signage — invitation, save-the-date, welcome sign, seating chart, place card, menu. Sizes, hierarchy, formality registers |
| `banner-designer` | web and print banners. The standard slots, safe areas, how a message survives being 90px tall |
| `album-designer` | photo books and record sleeves. Spreads, gutters, sequencing, the difference between a page and a spread |
| `book-designer` | long-form text on paper. The text block and its margins, a type scale for reading, front matter, running heads, cover and spine |
| `editorial-designer` | magazines and features. Covers and cover lines, openers, pacing across a feature, pull quotes, a template with range |
| `poster-designer` | one image, one message, seen at distance. Hierarchy at a glance, standard sizes, print constraints, the wall it hangs on |
| `packaging-designer` | dielines and faces, shelf presence at two metres, mandatory small print, material as half the design |
| `presentation-designer` | decks. One idea a slide, reading from the back of a room, charts that survive a projector, a template that holds |
| `printmaker` | ink on paper by process. Separations and registration, limited colours, overprint, what each method gives |

*Identity and direction*

| name | covers |
|---|---|
| `logo-designer` | marks and wordmarks. The reduction test, counters and spacing, lockups and clear space, drawn letters against set ones |
| `brand-designer` | identity as a system. Palette, type stack, layout rules, photographic direction and tone, held across many pieces |
| `art-director` | the idea across a campaign. Casting and treatment, what the pictures are *of*, holding one look over many hands |
| `lettering-artist` | drawn letters rather than set ones. Scripts and monograms, stroke logic, ligatures, where lettering beats a typeface |

*Pictures*

| name | covers |
|---|---|
| `photographer` | how photographs are made and therefore how they should be chosen and cut — focal length, light, the frame's own decisions |
| `illustrator` | commissioned pictures that carry an idea. The brief, the concept, spot against full-page, a style that reproduces |
| `digital-artist` | illustration and paint. Rendering, edges, colour mixing, what a finished piece looks like |
| `concept-artist` | design for production. Sheets, callouts, silhouette reads, orthographic conventions |
| `character-artist` | designing people and creatures. Shape language, silhouette, costume as biography, turnarounds and expression sheets |
| `environment-artist` | places. Scale cues, atmospheric depth, staging a space so it reads |
| `collage-artist` | one image out of many. Juxtaposition, cut edges, scale play, layering and ground |

*Time*

| name | covers |
|---|---|
| `comic-artist` | sequential storytelling. Panel layout and gutters, page turns, balloon placement, pacing on paper |
| `storyboard-artist` | shots in sequence. Shot sizes, screen direction and continuity, what a panel must show, boards against animatics |
| `animator` | movement itself. Timing and spacing, keys and breakdowns, weight and arcs, acting through pose |
| `motion-designer` | graphics in time. Timing and easing, the beat of a sequence, transitions that explain, type read while moving |
| `3d-artist` | building and lighting in three dimensions. Topology, materials and shading, camera and render, why a scene looks fake |
| `cinematographer` | the camera as an author. Lens and aspect ratio, lighting for motion, exposure and contrast, a colour script |
| `production-designer` | the look of a filmed world. Sets and locations, palette by sequence, dressing as character, building for a lens |

*Screens and objects*

| name | covers |
|---|---|
| `screen-designer` | layouts made for screens. Viewport and breakpoints, the fold, density, touch targets, state, scroll as a sequence |
| `ux-designer` | flows before screens. Tasks and information architecture, wireframes, states and errors, testing with real people |
| `industrial-designer` | objects to be made and held. Form and stance, ergonomics, colour-material-finish, designing for a process |

*Space and body*

| name | covers |
|---|---|
| `architect` | buildings and space. Plan, section and elevation, circulation, daylight and structure, drawing as the medium |
| `interior-stylist` | rooms. Materials and finishes together, layered light, staging and scale, palettes that live with what is there |
| `exhibition-designer` | graphics in space. Wayfinding and sightlines, viewing distance and type size, sequence through a room, durable materials |
| `fashion-stylist` | lookbooks and shoots. Silhouette, fabric and colourway, casting and fit, a set of looks that reads as a collection |
| `textile-designer` | cloth and pattern. Repeats and layouts, scale and colourways, woven against printed, how a pattern behaves in use |
| `floral-designer` | arrangement with living material. Form and focal flowers, line and texture, seasonal palettes, scale to the room |
| `tattoo-artist` | designing for skin. Flow with the body, line weight and readability, how ink ages, the style traditions |

**Foundations** — the general knowledge, the kind taught in a first-year studio
course. These are the ones a moodboard leans on as much as a poster does. Thirteen
— ten in the first pass, three added later — and the list is close to closed:
first-year studio knowledge is finite in a way that the trades above are not.

| name | covers |
|---|---|
| `colour-theory` | hue/value/saturation, harmony schemes, temperature, how palettes carry mood, and what a limited palette buys |
| `composition` | the frame's geometry — thirds, leading lines, balance, tension, negative space, focal points |
| `typography` | type anatomy, pairing, scale ratios, measure, leading, tracking, and when a typeface is doing the talking |
| `visual-hierarchy` | how the eye is led — size, weight, contrast, position, and what "first, second, third" means on a page |
| `light-and-shadow` | key and fill, hard and soft, direction, and what light does to mood |
| `grid-systems` | columns, modules, baseline grids, margins and gutters, and why a grid is a decision made once |
| `depth-and-space` | the third dimension on a flat surface — overlap, scale, perspective, atmospheric depth, figure and ground, layers |
| `style-and-period` | the named looks, which decisions travel together in each, and where a mix becomes pastiche |
| `texture-and-materials` | surface — grain and weave, stock and finish, weight and wear, what a material does to a colour |
| `type-and-image` | words and pictures in one frame — type over a photograph, captions, overlays, where a title can sit at all |
| `colour-grading` | the finishing pass — tonal range and contrast curves, casts and split toning, named looks, and one grade binding assembled pieces into one image |
| `focal-point` | where the eye lands inside a picture — the ranking of pulls, gaze and sharpness, one point per frame, cropping and placing around it |
| `shape-and-form` | the primitives and their connotations, corners and radii, geometric against organic, silhouette, container shapes, one shape family per piece |

Fifty — thirty-seven occupations and thirteen foundations. Thirteen were written
first, and the thirty-four after them came in one pass with a stated principle:
every trade whose working knowledge a page might rest on gets a file, because a
trade with no file is a job the agent does from general impressions.

Four of the foundations were the holes in the first thirteen, and none of them is
a subdivision of one already there. `style-and-period` is the largest: the
product's input is a vibe, somebody says *70s Italian summer*, and every existing
foundation could only answer in the abstract — `colour-theory` discussing warm
and cool, `typography` discussing pairing, and not one of the thirteen knowing
what the phrase looks like. `texture-and-materials` is surface, which nothing
covered; `light-and-shadow` says how a surface reads under a key light and stops.
`type-and-image` was split across three files and owned by none — `colour-theory`
carried the legibility-over-a-photograph argument, `typography` the measure,
`composition` the negative space — and a subject split three ways is one that gets
read zero times. `depth-and-space` existed only inside `environment-artist`,
which is to say it was available to somebody making a place and to nobody else.

The eleventh and twelfth came later, on the same two arguments. `colour-grading`
is the `depth-and-space` case: the grade existed as three sentences inside
`cinematographer` and as the declined `retoucher` bench entry, while
`colour-theory` stops at choosing a palette — and the finishing pass that makes
assembled pieces read as one image is the most compositor-shaped knowledge on
the list. `focal-point` is the `type-and-image` case: the table above claimed
`composition` covered focal points and its text mentioned them once, with the
rest split across `visual-hierarchy` (layouts, not pictures), `depth-and-space`
(one paragraph on focus) and `photographer` (the lens) — and gaze direction,
the strongest pull there is, was in none of them. `shape-and-form` is the
thirteenth, on the `depth-and-space` argument again: shape language existed
only inside `character-artist` and `concept-artist`, available to somebody
drawing a figure and to nobody choosing a container, a corner radius or a
mark's silhouette.

On the occupations side the first seven had two shapes of hole. Identity was
one — a mark, a lockup and a guideline are among the most-asked design jobs there
are and the nearest file was `banner-designer` — and time was the other: nothing
in the set knew that a sequence of shots, a page turn or a frame rate existed.
The rest is coverage: the trades a reference actually comes from. A photograph
in front of somebody is as likely to be an interior, a garment, a set, a piece of
lettering or a tattoo as it is to be a poster.

The registry is a directory, so forty-seven is not a ceiling either. The bench is
in §V.4.

**What forty-seven costs**, measured rather than guessed (`npm run floor`, before
and after):

| | 13 skills | 47 skills |
|---|---|---|
| `get_skill` declaration | 612 tokens | 1,786 tokens |
| catalogue in that declaration | 1,658 chars | 6,356 chars |
| instruction (§II.5) | 2,726 tokens | 2,832 tokens |
| **agent 8's floor per round** | **10,529** | **11,809** |

An eighth of a round, paid on every round of every design whether or not the
design reaches for a new name, where the benefit is paid out only on the design
that does. That is the right side of the trade to be on and it is not a free
one; the number to watch as the bench in §V.4 is written is the declaration,
which is now 20% of agent 8's whole tool surface.

The writing itself is deliberately shorter than the first thirteen: the new files
average 3,948 characters against the originals' ~5,450, and the largest is 5,992
against a `SKILL_CHAR_BUDGET` of 6,000. That is not thrift for its own sake — the
allowance is twelve skills a design, and twelve of the first thirteen's length is
a third more transcript than twelve of these.

### 3. What a skill may not contain

Three rules, because a skill is text that reaches the model with the authority of
a system prompt:

- **No instructions to the agent.** A skill says how wedding stationery works; it
  does not say "always use get_page first". Loop discipline is §II.6's and lives
  in one place. A skill that tells the agent how to behave is a second, unversioned
  system prompt that only some turns get.
- **Nothing about this project.** No reference ids, no board names, no user. A
  skill is the same text for every project, which is what makes it a file.
- **No tool names.** The toolset changes; forty-seven files should not.

### 4. The bench

Names argued for and not written, kept here so the forty-eighth file is a
decision rather than a whim. All occupations, because the foundations are close
to closed (§V.2) while trades are not.

| name | covers | why it is not written |
|---|---|---|
| `type-designer` | drawing an alphabet rather than a word — spacing across a whole character set, weights and optical sizes, hinting and rendering | `lettering-artist` defines itself against this and covers what a page actually needs; the rest is a specialism a layout rarely rests on |
| `food-stylist` | food for a camera. Freshness windows, garnish, steam and gloss, plating for a lens rather than a table | genuinely moodboard-native and the first on this list to write; held back only because `photographer` and `art-director` together cover most of what a page needs from it |
| `hair-and-makeup-artist` | the face as part of a look. Register, period accuracy, what reads under a hard light and what disappears | pairs with `fashion-stylist`, which already says the three departments must share one reference |
| `retoucher` | grade, skin, compositing and cleanup — what a treatment can fix afterwards and what it cannot | sits between `photographer` and `cinematographer`, both of which state the limit |
| `landscape-designer` | planted space over time. Seasons, growth, sight lines, hard against soft landscape | the outdoor half of `interior-stylist` and `architect`; a real trade with a small overlap with what gets laid out on a page |
| `game-artist` | assets under a runtime budget, screen-space interface over a moving world, style guides for a pipeline | mostly covered by `concept-artist`, `environment-artist`, `3d-artist` and `screen-designer` together |
| `sign-painter` | hand-painted signage. Enamel, gold leaf, layout on a wall, letters made with a brush at scale | a vernacular `lettering-artist` already gestures at |
| `curator` | sequencing works in a room, wall texts, what hangs next to what | close to `exhibition-designer` and `editorial-designer` and hard to write without repeating both |
| `ceramicist` / `jeweller` | material craft at small scale — process constraints, glaze and metal, wear and repair | the two most requested making crafts with no file; the case for them is references, not layout |

The order is the order to write them in. Each addition now costs about 25 tokens
on the catalogue in every round of every design (§V.2's table), which is the
number that should stop this list becoming a hundred files: a trade earns a file
when a page might actually rest on its working knowledge, not when it exists.

## VI. The door agent 6 opens

**`design_page`** — args `{ boardId, pageId?, intention, imageIds?, newPage? }`.
Gate: `boards > 0`. Cost: model, vision, multi-round — **the most expensive tool
in agent 6's table by an order of magnitude**. No per-turn ceiling.

*`DESIGN_CALL_LIMIT` = 1 was the rule and is removed.* The argument for it was
that this bounds a call which is itself a loop — up to twelve rounds of vision
over a page, each a model call — so two in a turn was a bill the user could not
see coming, and "now do the other one" was a sentence the next turn answered
just as well.

What that missed is the shape of the ask. "A poster and a banner", "do all three
pages", "one for each of the two looks" are one message and two or three designs,
and the ceiling turned every one of them into the user typing the same sentence
again with no new information in it. It also made agent 6 lie by omission: the
refusal fires *after* the first page is written, so the turn's answer was a page
the user did not ask for alone and a sentence explaining why the rest were not
made.

What bounds a turn that designs four times is what bounds a turn that does
anything else four times — but it is not **`TURN_TOKEN_CEILING`** (§VII), which
this section claimed and which does not do it: that ceiling reads the bill off
*agent 6's* responses, and a design's rounds are agent 8's, so a turn that
designs four times never touches it. The bound a turn actually has is
**`maxDuration` on the tRPC route** (`app/api/trpc/[trpc]/route.ts`), in seconds
rather than tokens. `DESIGNER_ROUND_LIMIT` still bounds each design at twelve
rounds, and `GENERATE_CALL_LIMIT` and `CROP_CALL_LIMIT` are still shared across
the turn, so four designs cannot buy eight pictures between them.

*Removed once, re-added, removed again — 2026-08-30.* Between those two dates
the ceiling came back as a `DESIGN_CALL_LIMIT` of 4 beside a wall-clock reserve
(`DESIGN_RESERVE_MS` = 170s), on the reading above: the route died at 300s and
`ChatMessage` rows are written only after the turn returns, so a killed turn
left the boards written and the conversation holding no record of them. The
reserve was the real gate and it was the one that fired: a single design
measures ~157s of model latency alone, so *"create 3 new pages applying your
suggestions"* designed one page and refused the other two with "no time left in
this turn" — this section's own example ask, answered exactly the way this
section says a ceiling answers it.

The fix was the route rather than the gate, which the route's own docstring had
already prescribed: `maxDuration` is **800** now, the Fluid ceiling on this
plan, where the vibes worker has been since 2026-08-28 (`infra.md` §XIII).
Nothing counts designs any more. The residual is honest and much further away: a turn that
designs six or seven pages runs past 800s and dies the same way, which is a
failure to remove by persisting the turn incrementally rather than by counting
pages.

The declaration keeps the cost warning — *the most expensive tool you have by an
order of magnitude, so call it for the page they actually asked for* — because
the routing decision below is still the one that matters, and a model that
reaches for a design where `swap_on_board` would do is the failure the ceiling
was standing in for.

Agent 8 is an `AgentTool` exactly as agents 2–4 are (tech-spec §III): the
orchestrator needs the result back, and the sentence to the user is agent 6's to
write. Agent 8's own closing line rides in the result, the way agent 4's `note` did,
and agent 6 is free to say it in fewer words. It rides beside a report of the
page the design left, which is the half agent 4's answer had and this one did
not — see below.

**The routing decision is gone, because there is nothing left to route to.**
This section used to list when agent 6 should call `design_page` rather than
`compose_moodboard` — a kind of thing that is not a moodboard, an ask about
arrangement a template cannot answer, a page that needs judgement rather than
reassignment — and closed on "a grid of nine is not a design problem".

That rule was retired with agent 4 on 2026-08-24. Two things were true at once:
the grid of nine really is not a design problem, and a design of it is better
anyway. The template answer is cheaper and more predictable; it is not better on
any ask, including the ones it was written for. And the rule had a cost nothing
was measuring — every board in the product hung on agent 6 reading four bullet
points correctly, and a wrong reading is a page fitted to slots when the user
asked for judgement, which nothing downstream detects.

Two things were keeping agent 4 alive, and both were fixable without touching
agent 8's loop:

1. **Agent 8 could not make a board.** `design_page` is gated on `boards > 0`
   and refuses an unknown `boardId`, so the first board of a project had to come
   from a compose. Now it comes from **`add_board`** (§IV.2's note) — agent 6's
   own tool, ungated, no model call: a row and one empty page and nothing
   decided.
2. **Agent 8's answer was thinner.** A compose reported which pictures landed,
   which were left off, the page and the title; a design reported a closing line
   and a list of tool names, and when the round ceiling bit mid-work that line
   was a constant the model never wrote. Both are answered now, and neither
   touched the loop's shape: **`DESIGNER_CLOSING_ASK`** buys one tool-less round
   for the model's own sentence on exactly the endings that used to hand back a
   constant (8 of 47 designs by the census on `DESIGNER_ROUND_LIMIT`), and
   **`designReport`** (`server/agents/designer/report.ts`) reads the board back
   in the *door* — so `vibes.designPage` gets it as well as `design_page` — and
   answers with the page, what is on it, what was named and left off, what sits
   loosely beside the page, and what the design had to draw or cut.

The read-back is also what finally lets a `newPage` design name its page. The
door snapshots the board's page ids before the loop, so a page the model made
itself with `put_on_canvas` is told from the ones that were already there — where
before, the answer could only carry a `pageId` agent 6 had passed in.

`newPage` puts the work on a fresh page beside `pageId` and reads nothing else on
the board, which is the way "try another version" costs nothing that already
stands.

## VII. Budgets

Agent 8's per-turn ceilings, in one place. Every one of them exists because free
placement plus a tool loop plus vision has no natural stopping point.

| constant | value | bounds |
|---|---|---|
| `DESIGNER_ROUND_LIMIT` | 12 | tool rounds in one agent-8 call. A page that is not made in twelve is not going to be |
| `PICTURE_WINDOW` | 5 | rounds an image part survives in the transcript, deduped by uri (§III.1) |
| `DESIGNER_PICTURE_LIMIT` | 8 | image parts across the whole call, window or no window. The round limit bounds calls, not pictures, and `get_image` is one picture per round for as many rounds as there are |
| `SKILLS_PER_CALL` / `SKILLS_PER_DESIGN` | 8 / 12 | §IV.5. Calls per turn: as many as the allowance allows |
| `GENERATE_CALL_LIMIT` | 2 | inherited, per turn and shared with agent 6's — one budget, whoever spends it |
| `CROP_CALL_LIMIT` | 2 | inherited, same sharing |
| batched canvas calls | 10 | inherited, per call, surplus reported — `restyle_on_canvas` included |
| `CANVAS_TEXT_MAX_FONT` | designed | the ceiling on an *explicit* `fontSize` (`canvas.md` §XI.2). The box-derived path keeps `LAYOUT_TEXT_MAX_FONT` 96, so agent 4 composes exactly what it composed before |
| `RENDER_TIMEOUT_MS` | 8,000 | one on-demand draw (§III.2). Past it, text-only and the failure said |
| `RENDER_MAX_DIMENSION` | 1,600 | inherited from the board render — the model's tiling is the same either way |

The run row is `AgentKind.DESIGNER`, opened once per `design_page` call and
holding every round's usage — including the rounds that only looked. A loop
whose cost is recorded per model call and never per *turn* is a loop nobody can
see getting longer.

**Amended once "Let's Vibes" had put real runs through the loop.** One ceiling
in that table was silently applied and the census is what said so: read again
at 47 designs (`npm run design:runs`), `DESIGNER_ROUND_LIMIT` is reached by 11
of them and stops 8 mid-work, against 3 and 2 at 32 designs — and one page of
the six-page run in §IX.4 spent all twelve rounds reading and never called
`put_on_canvas` at all. Every other budget here refuses one call and leaves the
design running, and each of them says its own number when it bites
(`pictureCeilingSaid`, `cropCeilingSaid`, `generationCeilingSaid`,
`SKILLS_OVER_CALL_NOTE`). The round ceiling is the one that *ends* the design,
and it was the one the model was told about only afterwards — by
`DESIGNER_STUCK_LINE`, which is written for agent 6 to read to the user and
which agent 8 never sees.

| constant | value | bounds |
|---|---|---|
| `DESIGNER_ROUNDS_WARNED` | 3 | rounds left when the countdown starts, and said again every round after |

So the results of a round carry `roundsLeftSaid(left)` once three are left:
"3 more steps", "2 more steps", "one more step", then "No more tool calls will
run on this design". Four things about it, and the first two are the reason it
is worth any tokens at all:

- **A step is a turn, not a call**, said out loud, because `put_on_canvas` is
  batched to ten and a model placing one element per round in its last three
  had thirty placements available and used three. This is the sentence that
  changes what the model does rather than only what it knows.
- **The last emission is what the user is told.** A design that ends on a tool
  call ends on `DESIGNER_STUCK_LINE` — agent 6 apologising for a page — where a
  design that spends its final turn on a sentence ends on the model's own
  account of what it made.
- **At the head of the results turn, never after them.** The tail is where it
  would be read best and is the one place it cannot go: Vertex refuses a
  `functionResponse` turn whose trailing part is not itself a response, which is
  the same rule that puts a picture *before* the answer it came with (§III.1).
- **A design that finishes inside its rounds never sees it**, so the common path
  costs nothing. Three-quarters of designs answer by round eight.

Verified on the live path rather than only in the suite: an ask deliberately
written to run long ("rework this page one element at a time, look after every
change") reached the countdown at round 10, the request carrying it came back
accepted, and the design **stopped at round 11 with a finished line** rather
than running into the ceiling. The transcript shape is visible in
`npm run design:check`'s own per-round print as `u[trtr]` and `u[tr]` — the note
at index 0 of a turn that still ends on a response.

Which is also why the twelve did not move. The reading that argued for raising
it is a reading taken before the model was told the number existed; it has to be
taken again over designs that saw the countdown, and this section says so rather
than pre-empting it.

**The second reading, taken.** 58 designs on this database against the 47 above,
so eleven designs have now run with the countdown in front of them — five
ordinary agent-6 designs and a whole fresh six-page Vibes run (§IX.4). **None of
the eleven reached the ceiling.** The census's own at-the-limit count did not
move at all: 11 of 47 before, **11 of 56** succeeded designs after, which is the
same eleven designs. What moved is the mean, 7.0 → **7.4** rounds — designs
spend *more* of the budget and then close out inside it, which is the shape a
countdown should produce and is the opposite of what raising the ceiling would
have bought. The six pages of the new run ended at rounds 9, 11, 10, 8, 10 and
7; the six pages of the run before the countdown ended with four of them at
twelve, two stopped mid-work and one having placed nothing at all. Page 2 here
is the whole argument in one line: it went to eleven, one short of the wall, and
finished with its own account of the page.

So the twelve stays, and it is now a ceiling that is reached by nothing rather
than by a quarter of designs. The reading to take next is not this one again —
it is whether `DESIGNER_ROUNDS_WARNED` at 3 is the right distance, and that only
becomes a question if a design starts closing out with rounds still on the
clock. Nothing in these eleven does.

## VIII. Risks

- **`renderForModel` is the prerequisite** (§III.2) — step 4 of the loop has
  nothing to look at without it, and agent 8 becomes agent 4 with a worse bill.
  Build it first. Its own three risks:
  - **fidelity.** It is a re-implementation of a renderer, not excalidraw's, and
    a shape it draws differently from the export is a page the model judges
    differently from the user. The subset is small and this app writes all of it,
    which is what makes the bet reasonable — but a scene pasted in from
    elsewhere is not the subset, and the undrawn-outline rule is what keeps that
    honest rather than invisible.
  - **latency, inside a tool call.** Eight seconds is the cap and a twelve-round
    turn can ask several times. The per-revision cache is what keeps that from
    compounding — a look that follows a look with no write between it is a HEAD
    — so measure the cache hit rate before the render time.
  - **storage.** One object per revision per page, on a board being written
    every round. The lifecycle rule is the whole of the answer and it is a bucket
    setting rather than code, which is the kind of thing that is true in one
    environment and not the other.
- **The style dialect is a taste surface, and taste has no test.** A model that
  can set any hex on any fill can set seven of them on one page. Free placement
  made bad *arrangement* possible; this makes bad *colour* possible, and the only
  guards are the same three — the skill, the picture and the second look. The
  `colour-theory` and `composition` skills (§V.2) carry more weight the day this
  lands than they did the day they were written, and they should be re-read
  against real output rather than assumed to still cover it.

  **Read, and the first of the three guards was not standing.** Not because the
  writing is wrong — because nothing ever opened it. Of the 33 designs on the
  development database that recorded their skills (`npm run design:runs`, 67
  designs, $5.19), `colour-theory` was read by **0**, and so were
  `light-and-shadow` and `photographer`; the three slots went to `typography`
  (33 of 33), `visual-hierarchy` (28) and `grid-systems` (16), beside the
  occupation. The 23 designs handed a palette in their own intention are the
  sharpest cut of it: 23 of 23 read no colour skill, and those are the runs
  §IX.5's palette readings are taken from. So "re-read them against real
  output" turned out to be the second question — the first is whether the model
  reaches for the one that covers the failure, and every colour-shaped failure
  in §IX.5 was made by a design that had never seen a word of `colour-theory`.
  The ceiling of three is untouched: the argument for it is the transcript's
  character budget and nothing read here weakens it, and a design that spends
  all three on arrangement has not run out of slots. Where the ask for the
  fourth guard went is §IX.3's intention rather than §II.5's instruction, and
  the two live runs that decided that are recorded in §II.5.

  **And "taste has no test" is now half wrong.** Arrangement has none. *Legibility*
  does: `contrastRead` (§IX.5, `lib/render/contrast.ts`) measures every line of
  type against the ground it is actually laid on, blends included, and 196 of
  the 492 pairs on this database come in under what their size wants. That is
  not a verdict on a page and is not wired to a refusal — it is the one part of
  this surface where a bad choice has a number, and it is on every run log.

  **Corrected — every arrangement number on this page was measured with the
  wrong ruler** (`setOverflow` in `lib/render/render-plan.ts`, 2,930 → 2,932
  cases). `drawnBounds` is what ink, covered, the bands and the margins are all
  rectangles of, and for text it asked `textOverflow` — the flat 0.75 an em the
  *rasteriser* uses to decide how much transparent room to leave a line. That
  ratio over-estimates on purpose and says so (`text-set.ts` sets out the split
  at length), which costs nothing in a buffer and is the whole of the reading in
  a bounding box. Measured against `setWidth` over the 540 text draws on the
  database: the pad over-states a set line by a median 25% and by 80% at the
  worst, and it says 132 of them hang over their own box when only **20** do.
  The other 112 are paragraphs the put door already broke to the width it was
  given (§IX.5), reported as spilling half a box to one side.

  So the box that is a *measurement* now measures, and the pad stays where it
  was earned — nothing about the picture changes, and `render:check` is
  unmoved. What changes is the numbers: ink comes down 1–7 points on the
  text-heavy pages, and one welcome sign that read "nothing within 36% top, 40%
  bottom" reads "36% top, 10% right, 40% bottom, 10% left", which is two whole
  edges the pad had been reaching that the type never does.

  And it reached further than a log. `bandOccupancy` is what `get_page` tells
  agent 8 about where its own work sits, and `contrastRead` samples the ground
  under a line's *centre* — which an over-wide box walks to the right for every
  line that is not centred. It moved 55 of the 540 lines, two of them off the
  page entirely, so one roastery page's worst pair read 2.6:1 against the page
  background where the truth is `#78a8a4` on `#78a8a4`, **1.0:1** — type nobody
  can see, hidden by the ruler. The database census goes 203 → 206 failing
  pairs of 536: the correction makes the reading worse, which is the direction
  that says it was a correction.

  **Corrected again, and this time the ruler was a constant.** The correction
  above is about a measurement being over-generous; this one is about a
  measurement counting something that is not the design. `ink` — the share of
  the frame the drawn rectangles add up to, overlaps counted twice, and the one
  number on this line whose entire signal is "past 100% means it is piled in one
  corner" — was summing *every* draw, and `set_page_background` (§IX.2,
  `canvas.md` §XI.4) puts a page-sized rectangle at the back of every Vibes
  page. The bands and the margins have dropped a full-bleed backdrop since the
  day they were written and said why (`BACKDROP_COVERAGE`); ink never asked. So
  36 of the 80 pages on this database were reading exactly 100 points high, and
  the column said **36 pages were piled where 3 are** — a page carrying 17% of
  its own frame in work and one carrying 103% both came back over 100 and read
  as the same page. Median ink 60% → 50%, the worst page 391% → 173%, and
  nothing else on any line moves: the ground rule is now one exported
  predicate (`isBackdrop`) that all three readings ask, and on the 927 draws
  here the two copies it replaces never disagreed.

  The shape of it is the same as the ruler's and worth naming as a class: a
  reading written before a feature existed, correct on the day, quietly falsified
  by a stage that added ground to every page. Nothing failed, no test went red,
  and the number stayed on every run log being read as if it still meant what it
  said.

  **Corrected a third time, and this one is not a number but a *list*.** The two
  corrections above are about readings taken over a whole page. This is about
  the part of the second look that describes the page block by block — the text
  riding under the picture (`tech-spec` §V.4) — and about which blocks it drops
  when it cannot describe them all. `PAGE_BLOCK_CAP` is 24 and the pages agent 8
  makes with the style dialect now run past it: 10 of the 82 pages on this
  database are over the cap, 72 blocks go undescribed, and every one of those
  pages is a designed one rather than a composed one. The cap was spent in
  reading order, which runs top to bottom, so what it dropped was not two dozen
  scattered things but the foot of the page: the two densest pages here, 44 and
  49 blocks, described 16 and 18 blocks from the top third, 8 and 6 from the
  middle and **none at all** from the bottom third that twelve blocks stand in.
  A design asking `get_page` how its own page is standing was handed a list that
  stopped halfway down it — on the very ask whose standing flaw, four attempts
  deep, is a bare bottom third. The list and the occupancy note were disagreeing
  about the same page and only the note was right.

  Fixed by spending the cap — and the character budget beside it, which follows
  the same order so it cannot reintroduce the fold — on the blocks that reach
  furthest across the page (`byReach`, `lib/pages/page-blocks.ts`), said in
  reading order as before: 7/7/10 and 9/7/8 across the thirds on those two
  pages, and the omitted line now says the dropped ones are the smallest things
  on the page rather than leaving a model to place seventeen unknowns anywhere
  on the rectangle. Same class as the two above and worth the third naming: a
  rule written when a page was a dozen photographs, correct on the day, quietly
  falsified by the stage that let one page carry forty-nine things.

  **Corrected a fourth time, and this one is the other half of the first.** The
  first correction is about a text box being too *small* — a headline set wider
  than the box it was written into, ink in the picture and white space in the
  numbers. It fixed that direction and left the box as the floor, so
  `drawnBounds` returned the element's box *or* larger and never smaller. But a
  text element's box is room a design reserved, and the type inside it fills as
  much of that room as the words happen to need: `put_on_canvas` writes the box
  the design asked for and sets the words into it (§IX.5's wrap block), so the
  box is much more often the bigger of the two. Measured over the 579 text draws
  on this database, the box is a median **1.7x** the ink it holds, **208** of
  them over twice, and one **19.3x** — a single `&` in a 720-wide slot, read by
  every number on this line as a 720x94 rectangle of ink and drawn in the
  picture as a 38-wide ampersand.

  `inkBox` (`lib/render/render-plan.ts`) measures the type both ways: the set
  width and the set height, anchored where the alignment puts them, so a box
  wider than its type and a type wider than its box are one rectangle rather
  than two rules. **69 of the 82 pages** here read differently. Median ink
  47% → 43%, the worst page 173% → 161% and the crown changes hands, and the
  margin column gains **29 whole edges**: every welcome sign on this database
  now leaves the 17% at each side that its centred headline never reached, where
  before it read as type running edge to edge. Contrast does not move — 214
  failing of 575 pairs either way, 4 lines over a photograph — which is that
  reading being checked by the correction rather than corrected by it, and no
  pixel of any render moves, because `textOverflow` is still the rasteriser's
  own room and `render:check` comes back cell for cell where it was.

  Fourth in a row and the same class named a fourth time, with one addition
  worth keeping: this one was not falsified by a later stage. It was half-fixed
  by an earlier correction, which is the failure mode of fixing a ruler by the
  symptom that led you to it. The census that found the first — "what hangs over
  its box" — could only ever have found the direction it asked about.

  **Amended — the number is now in front of the agent that made the page.** The
  reading above ends "it is on every run log", and a run log is read by whoever
  is holding the terminal afterwards. `contrastNote` is the same read handed to
  the design inside the round it can still act in: `get_page` — the second look,
  which is one of the three guards this bullet names — now says which lines of
  type stand too close in colour to what they are laid on, by the id
  `restyle_on_canvas` takes (§IV.2). Still not a verdict and still not wired to
  a refusal. What changes is what the second look *is*: until now it was a
  picture, and a 1.5:1 pair of warm neighbours is the single thing a picture is
  worst at showing — the type is there, it is the right size, it is in the
  right place, and the page reads as designed until somebody tries to read a
  word of it.

  **Amended again — and this time it does not wait to be asked.** The reading
  above rides on `get_page`, which a design has to *call*. Both runs that proved
  it works spent the rounds after the page was already wrong, and the one told
  "in this exact five-colour palette and nothing else" read the note twice and
  kept all 29 unreadable lines. So the same arithmetic is now taken at the five
  canvas writes as well (`lib/canvas-objects/object-legibility.ts`), and the
  difference between the two doors is what each one can honestly say.

  `get_page` reports a **state**: these lines on this page stand too close in
  colour to their ground. A state fires on every round of a page whose palette
  holds no legible pair at all — 129 of the 196 failing pairs measured for
  §IX.5 — which is a sentence the design cannot act on arriving over and over.
  A write reports a **change**: which lines this call, and no earlier one, put
  beyond reading. A call that leaves a bad pair exactly as bad as it found it
  did not make it and is told nothing.

  All five writes ask it, because all five can cause it and only one of them is
  about colour: a put lays the ink down, a restyle sets that ink or repaints the
  block a dozen lines are standing on, a transform walks a line off the card it
  was legible on, a reorder puts a block between the two, and a removal takes the
  card out from under it. Which of the five it was is not in the answer — what
  the caller does about it is the same either way, and a reading that had to be
  argued per door is a reading four of them would not have got. It is agent 8's
  alone, on `CanvasToolNotes`' standing rule: agent 6 places the user's own words
  in the user's own colours, and a tool answer overruling them is a taste
  argument arriving as a measurement.

  What it would have said on the pages already made: replaying every page on
  this database as though its type had arrived at once onto the ground that was
  already there, **32 of 82 pages** would have heard it, naming or counting 214
  lines — a median of 5 per page, 19 at the worst, and 23 of the 32 past the cap
  of three that `CONTRAST_NOTE_LIMIT` sets. The cap doing most of the work is the
  same finding the page note's own cap produced: a page that fails mostly fails
  *entirely*, and three ids and "and 16 more" says the palette is wrong where
  nineteen ids would say nothing extra. The note offers the ground as the second
  way out for the same reason — on a closed palette it is the only one open.

  **And the A/B says it did not move this ask, which is worth more than a
  claim.** Two live `design:check` runs, same board, same ask word for word,
  minutes apart, on the warm lookbook whose five hexes have no legible pair in
  them: with the door note, `worst pair 8.4:1, all 13 clear`; with it patched
  out, `worst pair 6.1:1, all 13 clear`. Both arms put type in the palette's own
  browns, both called `get_page` next, and both then spent one
  `restyle_on_canvas` taking every line to near-black outside the list. The
  second look was already enough. (Both are the only two of the 84 pages on this
  database on that palette with no failing pair on them — the six sibling pages
  of that same board, designed before either note existed, read 1.3:1 to 1.6:1
  with 12/12, 14/20, 19/19, 18/18, 7/7 and 16/16 pairs failing.)

  So the door's reading is worth what the second look does not cover, and the
  run ledger says exactly how large that is: of the **78** designer runs on this
  database, **0** never call `get_page` — and **8** end with a write that nothing
  looked at afterwards. Those eight are pages whose last edit no reading ever
  saw, and they are the whole of what this buys that §IV.2 did not already. It is
  cheap (two plan builds per page per write, no font, no bucket, no codec), it is
  silent on every call that made nothing worse, and it arrives a round earlier on
  the other seventy — but it is not a second guard, it is the tail of the first
  one, and it should be described that way rather than as a fix.

  **Corrected a fifth time, and this one was never a rendering number at all.**
  The four above are about *which rectangle* a line of type is measured at. This
  one is about *how wide the letters in it are*, and it reaches further than the
  readings: the same arithmetic breaks every line the app writes.
  `text-set.ts` sets a string by character class — lowercase .49 of an em,
  capitals .68, a space .278 — and those are Helvetica's numbers, with a comment
  saying so and arguing that "a hand face sets a little wider and a monospace a
  little narrower, and neither moves a line by a word". Both halves are false,
  and the argument was never checked against a font file.

  Read straight out of the `.woff2` the mirror ships (`npm run fonts:set`, which
  parses `hmtx` through `cmap`), the seven faces are worth this per class:

  | face | space | narrow | wide | upper | digit | other |
  |---|---|---|---|---|---|---|
  | Excalifont (`hand`, and the default) | .400 | .360 | .727 | .678 | .606 | .543 |
  | Liberation (`sans`, families 2 and 9) | .278 | .272 | .833 | .660 | .556 | .511 |
  | Cascadia (`mono`) | .586 | .586 | .586 | .586 | .586 | .586 |
  | Nunito (`rounded`) | .261 | .284 | .917 | .639 | .600 | .523 |
  | Lilita (`display`) | .188 | .349 | .850 | .583 | .543 | .501 |
  | Virgil | .500 | .351 | .689 | .656 | .616 | .524 |
  | ComicShanns | .550 | .550 | .550 | .550 | .550 | .550 |

  Over a corpus of lines a page would carry, the single Helvetica table is out by
  **0.97–1.21x** on Excalifont and **0.81–1.33x** on Cascadia; per-face it is
  **0.96–1.11x** everywhere. Two things make that expensive rather than
  academic. Excalifont is what excalidraw draws a text element carrying *no*
  `fontFamily` in — which is every line `put_on_canvas` lays down with no `font`
  asked — so the one face nothing defaults to was the only one the table was
  right about. And a monospace sets its lowercase *wider* than any proportional
  face, not narrower: one advance for every glyph is set by the widest letter in
  the alphabet, so the direction the comment guessed is backwards on the face
  agent 8 reaches for most after the sans.

  The measure is now per face (`lib/render/font-set.ts`, a leaf module because
  `render-plan` reads the tables at module scope and sits downstream of
  `text-set` through `board-contents` — leaving them together was a real
  initialisation cycle, not a tidiness argument). All four doors that break a
  line take the face off the element: the put from the `font` it was asked with,
  the restyle from the family it is about to leave the block in, `reword_on_board`
  and `flooredType` from the block's own. `inkBox` takes it off the plan, so the
  read half agrees with the write half by construction.

  What it says about the boards already made: of the **609** pinned text blocks
  on this database — 298 `sans`, 162 `mono`, 104 carrying no family at all, 41
  `display`, 4 `hand` — **33** stand wider than the box they were given when
  measured in the face they are drawn in, where the Helvetica table could see
  only **23**. The ten it could not see are the default face and the monospace,
  exactly the two it was wrong about, and **16** blocks carry breaks the door
  would not make today. On the page census 20 of 84 pages read differently, with
  margins moving up to four points and the contrast column all but unmoved
  (214 → 212 of 601 pairs) — a small correction to a reading and a real one to a
  write, which is the opposite balance to the four above.

  `render:check` is byte-identical either side, and structurally had to be: the
  rasteriser draws the glyphs from a face file rather than from this arithmetic,
  so it never asked the table anything. That is the same reason the defect
  survived — the one comparison in this codebase that could have caught a wrong
  font metric is the one place the metric is not used. (Since the typography
  render the face file really is the named face — resvg, one TTF per call —
  where at the time of this census librsvg was substituting whatever the
  machine had; the blindness of `render:check` to the *metric tables* is
  unchanged, and the specimen tests in `rasterise.test.mts` are what now hold
  drawn width against the tables.)
- **The page background is a rectangle pretending not to be an object**
  (`canvas.md` §XI.4). Every read excludes it, every write refuses it, tidy skips
  it and resize carries it — and each of those is a separate place to forget. The
  failure is quiet and specific: one missed exclusion and the model is handed its
  own page background as a grabbable object sitting behind everything, and its
  first tidy sweeps it into the photo grid. Test the exclusions, not the setter.
- **Free placement can make an ugly page, and nothing in the system will say so.**
  Agent 4's constants file made a bad arrangement impossible; here the only
  guards are the skill, the picture and the second look. Keep a fixture set of
  asks — a welcome sign, a banner, a three-photo spread — and eyeball what comes
  out, because no test asserts taste.
- **The cost is pictures, and pictures are the thing the model wants more of.**
  `DESIGNER_PICTURE_LIMIT` is the backstop, and the failure mode it exists for is
  a model that answers "I should look at these first" to every round. Watch the
  `AgentRun` rows before raising it.
- **Two agents now write boxes** — agent 8 directly, agent 4 through the layout
  constants — and one board can carry both. A page composed by agent 4 and then
  adjusted by agent 8 no longer stands as composed, and `inspect_board`'s
  "still standing" read will say so. That is correct and will read as a bug the
  first time somebody sees it.
- **The skills are unversioned prose that reaches the model with system-prompt
  authority.** A bad paragraph in `colour-theory` is a bad paragraph in every
  turn of every project. They are code files for exactly this reason; review them
  as code.
- `PRO` is not an option: the eligibility floor is 3.5 or newer (tech-spec §II)
  and `PRO` is 3.1. Agent 8 is `FLASH`, like every other text and vision agent,
  and if a design read measurably degrades there is no better model to fall back
  to — only a better prompt or a better skill.

## IX. The door the user opens — "Let's Vibes"

§VI is the door agent 6 opens, one page at a time, inside a turn about something
else. This is the other one: the user says what they want made, in a form, and a
whole board comes back. It is the product's headline action rather than an
affordance on a canvas, and it is the only place in this app where an agent is
run without a chat message asking it to.

It replaces the **Tidy / by colour** pair in the editor's top-right island
(`canvas.md` §VI). That slot holds one control and this is what belongs in it;
tidy is not deleted but moves into `BoardMenu`, which already carries the
board-level actions (export, canvas background, reset). A press of tidy is
something a user reaches for occasionally and a press of this is what they came
for.

**Built.** Tidy is two entries at the top of `BoardMenu` and the island holds
the page controls and "Let's Vibes" (`canvas.md` §VI records what the move
settled). One thing the swap made visible that this section did not: the island
is *inside the editor*, so the headline action is only reachable with a board
already open. A project with no boards still starts one with "New board" and
presses it there — worth a second door if the empty state ever gets one, but not
a reason to keep the action out of the slot §IX asked for it to be in.

### 1. The form

Four fields the user asked for and one this design adds, all of them constraints
rather than instructions — the difference being that a constraint is something
the answer can be checked against.

| field | shape | why it is a field and not a sentence |
|---|---|---|
| **purpose** | free text, required, ≤ 200 | what is being made: "a welcome sign for a rustic autumn wedding". This is what a skill is chosen against (§IV.5), so it wants the noun in it |
| **pages** | 1 – `VIBES_PAGE_LIMIT` | how many. One design call each, so this is the field that sets the bill |
| **palette** | 1–5 hex, in the order typed | the constraint most worth making structured: a colour typed into prose is a colour the model paraphrases, and a hex is a hex. Seedable from the project's own photographs — `mergedPalette` already merges agent 2's palettes across a selection (`canvas.md` §V) and is the obvious default offer |
| **vibes** | free text, ≤ 200 | "warm, intimate, candlelit". Deliberately unstructured: this is the half of a brief that does not survive being turned into a dropdown |
| **page size** | one of the three presets | **added here.** A welcome sign is portrait and a banner is landscape, and nothing else in the form says which. Left out, the first page's shape is a guess the remaining five inherit — and `resize_page` moves nothing, so guessing wrong costs the whole run |

`Project.brief` is a free-text column that already exists and is a different
thing — a project's standing brief, not one board's. Prefilling `vibes` from it
is a reasonable offer and merging the two is not: the form is per-board and the
brief is not.

**Built — the form** (`lib/vibes/vibes-form.ts` and
`app/projects/[id]/vibes-form.tsx`, 2,798 → 2,811 cases). The pure half says
what the form opens holding and what to put beside a field that refuses; the
component is the fields and the arithmetic of the bill. Six things the build
settled that this section did not say:

- **`vibesRefusals` names the reason and `vibesBrief` still decides.** The
  submit button asks the reader itself, and a test asserts the two agree on
  every draft — no message beside a field means the mutation takes the brief,
  and a message means it does not. A second function deciding what a good brief
  is would be the browser and the server disagreeing a release apart, and the
  disagreement costs six model calls.
- **Nothing is refused out loud until the form has been submitted once.** A
  form that opens telling the user the purpose is empty is a form scolding them
  for not having typed yet — and the purpose is the only field with no default,
  so it is the only one that could.
- **The prefill of `vibes` from `Project.brief` was not built.** The two fields
  do not fit: the column is 5,000 characters of what the project is for and the
  field is 200 characters of how one board should feel, so the prefill's usual
  case is a form that opens already refusing itself. The offer stands if the
  brief is ever short enough to be one; it is not a merge either way.
- **The palette is seeded off the query the board is already holding.**
  `moodboard-canvas` reads `reference.analysisByProject` for the by-colour tidy,
  so the form is handed the same palettes as a list and the seed costs no round
  trip of its own. Seeded once rather than followed: a palette that reseeded as
  the analysis queue settled would take back a colour the user had removed.
- **An empty project opens on white.** `mergedPalette` over nothing is nothing
  and the reader requires one colour, so the form offers `#ffffff` — the one
  colour that cannot be a wrong guess, because it is what an unpainted page
  already stands on. Accepting it changes no pixel and only makes the palette a
  list the model is held to.
- **The bill is on the button.** "Design 3 pages", not "Start": six design
  calls is the most expensive single action in this product and it is one click
  from the canvas, so the count the user chose is read back to them on the
  control that spends it. The default is three rather than the ceiling for the
  same reason.

**Amended — the palette row has a reading under it** (`vibesPaletteNote`,
2,942 → 2,949 cases). The one thing on this form that is neither a field nor a
refusal: what the colours in the wells will and will not carry, in the same
three branches and off the same `paletteContrast` as the ink clause the
intention hands the model (§IX.3). It says nothing about a list that can carry
a caption, and on one that cannot it names the widest pair and says the pages
will set their type in a neutral instead. Not a refusal — the form submits
either way — and the argument for building it at all, against the flag that
held it for two iterations, is in §IX.5's palette bullet. The one rule this
adds to the two above: a *refusal* waits until the form has been submitted
once, and a *reading* does not, because it is a fact about the colour under the
cursor rather than about what the user has not typed yet.

### 2. What runs, in four steps

**`vibes.start`** — one mutation, no model call. Creates the board titled from
the purpose, writes the brief, adds `pages` empty pages at the chosen preset, and
sets each one's background to the theme colour (`canvas.md` §XI.4). Returns
`{ boardId, pageIds }`, and the browser navigates to the board.

Making every page up front rather than letting each design call make its own is
three things at once: the board is the right *shape* immediately, so the user
watches known pages fill in rather than wondering how many are coming; each
design call is handed a `pageId` instead of a `newPage` flag, so nothing races;
and the theme colour is decided once, by the form, rather than by page 1 and then
matched five times.

**Amended 2026-08-29 — the pages arrive unpainted, and the third reason is
withdrawn.** The paint is gone: `startBatch` adds the pages and nothing else, and
what a page stands on is the design agent's decision like every other visual
decision on it. The first two reasons for making the pages up front stand; the
third was wrong. Deciding the ground once, from the form, is not the same as
deciding it well, and the evidence is the 2026-08-29 batch run — every page of
all eight boards kept the flat `palette[0]` it was handed, and the user read the
set as unfinished: "the pages with plain background color look very bad".

The first attempt at a fix argued the model off that ground in the brief while
the same paragraph told it the ground was already laid, which is the wrong shape
— painting a page and then asking the model to reconsider is not a decision
handed over. So the page arrives standing on nothing and the brief says only
that (§IX.3). With the paint goes `palette[0]`'s billing as *the theme colour*:
the form carries the user's order because it is the order they typed and the
order the prompt lists, and no colour in the list is a ground until the agent
makes one.

**`vibes.designPage`** `{ boardId, pageId, index }` — one mutation per page,
called by the browser in sequence. Builds the intention (3) and calls the
existing `designPage({ boardId, pageId, intention, imageIds })` unchanged. That
door already takes exactly these arguments, which is why this section adds a
caller and not an agent.

**Sequential, browser-driven, and that is a decision.** There is no job queue and
no streaming in this app — a turn is a blocking tRPC mutation
(`orchestrator.send`) and is already the longest thing in it. Six pages in one
mutation is a single request running for minutes with nothing to show and nothing
to stop; six mutations is bounded work, honest progress, a failure at page four
that keeps pages one to three, and a Stop button that means it. If a queue ever
arrives this is the first thing to move onto it.

**The conversation gets the run.** A user row — `Let's Vibes — <purpose>` — and
one assistant row per page carrying agent 8's own closing line. Without it a board
appears in the project with no account of where it came from, and the next thing
the user does is ask agent 6 about it: agent 6 can read the board, but nothing
tells it what the board was *for*. This is the same reason agent 8's line rides
back through agent 6 in §VI, arriving at the same place by the other route.

**Amended 2026-08-23 — the run gets a conversation, not the conversation.** A
project holds many threads now (`orchestrator-tool-reference.md` §VII), and
`vibes.start` opens one of its own rather than writing six assistant rows into
whatever the user last had open. The run is a thread by any reading: one ask, a
known number of answers, and an end — and it is the one place in this app that
writes a conversation with nobody typing in it.

The id has to outlive the tab, because `vibes.resume` exists: a run picked up
the next morning writes its remaining pages into the same thread. It goes on the
board — `Moodboard.conversationId`, nullable — for the reason `vibesBrief` is
already there: `resume` reads the board and nothing else, and the board is the
one thing both halves of the run agree on. The thread needs no title column
written; it is named by its own first row, so the switcher reads
`Let's Vibes — dusk wedding`.

**Amended 2026-08-29 — the run keeps no thread at all.** Both paragraphs above
are withdrawn. The `Conversation`, its `Let's Vibes — <purpose>` row and the
assistant row per page are gone; `startBatch`'s transaction is
`moodboard.create` plus `enqueueVibesPage`, which is the only atomicity the run
ever needed.

The reason is what a batch made of the switcher: one thread per board, four
forms × three designs of them, none of them typed in and none of them read. The
account §IX.2 wanted is not lost, because it was never only in the thread — the
purpose is the board's title, the whole brief is on `Moodboard.vibesBrief`
verbatim, and what each page's design call did is on its own `AgentRun` row,
which is what the run panel has read since the queue arrived
(`multi-vibes-and-preview-prd.md` §II). What is lost is one thing, and it is
accepted: a refused page's reason lives only on that row, which the panel
surfaces inside `vibesSettledCutoff`. Past that window a failed page is just a
blank page — which the resume offer already finds and offers to design, and
which was always the real recovery path.

`Moodboard.conversationId` stays in the schema, nullable and unset for Vibes
boards. No migration: it is already nullable, the null branch already existed,
and nothing outside the Vibes path ever wrote it.

**Built — `vibes.start`** (`lib/vibes/vibes-start.ts` and
`server/api/routers/vibes.ts`, 2,774 → 2,785 cases). The deterministic half is a
pure function and the mutation is the thin part: `vibesBoard(brief)` returns the
title, the board's default size, the scene and the `pageIds`, and the router
does the ownership check, one `moodboard.create`, one chat row and nothing else.
Six things the build settled that this section did not say:

- **The pages are drawn one at a time through `addPage`**, each against the
  array the one before left, rather than by a loop computing its own gaps. That
  is the same path a user pressing "another page" takes, so a Vibes spread and a
  hand-made one are laid out by one implementation — and `nextPageBox` already
  answers "to the right of the rightmost, at the source's top edge".
- **The ground goes on page by page, inside the same loop.** A second pass over
  the finished pages would be a second walk for no gain, and the first page's
  ground is already excluded from the second page's adoption by `pageHolding`
  before geometry ever gets a say.
- **The board's `widthPx`/`heightPx` become the preset**, not just the pages'
  rectangles. A seventh page added by hand after the run then comes at the shape
  the set is in rather than at the app's own default — the one place a Vibes
  board's size has to outlive the form.
- **The title is the purpose**, through `normalizedBoardTitle`, so a pasted
  brief with a line break in it is one line on the tab row. The purpose is the
  only field that names what is being made; a board called "Untitled board"
  beside five others is the one thing this form has enough to avoid.
- **The user row carries the purpose alone.** The page count, the preset and the
  theme colour are all readable off the board itself, and a row restating them
  is the only part of the record that can go stale — a page discarded the next
  morning would leave a chat row saying six. *(Both this bullet and the next are
  about rows that no longer exist — 2026-08-29, above.)*
- **The row is written after the board, and is a turn of its own.** A create
  that fails leaves no row asking about a board that was never made, and the
  assistant rows that answer it are one per page arriving from `designPage`,
  each with its own `turnId` — the shape `chat.record` already uses for
  something the user did with their hands.

**Built — `vibes.designPage`** (`server/api/routers/vibes.ts`, with the brief's
new home on `Moodboard`, 2,785 → 2,788 cases). The mutation is the caller this
section promised and nothing else: an ownership check, the brief read back, the
gallery read once, `vibesIntention`, `designPage` unchanged, one chat row. Five
things the build settled that this section did not say:

- **The brief is stored on the board it made** — `Moodboard.vibesBrief`, a
  nullable `Json` column, written by `start`. §IX.2 said "writes the brief" and
  did not say where; the reason it has to be *somewhere* is that the two halves
  of the ask nothing on the board carries are the user's own words and the four
  colours past the ground. The purpose survives as a title only after
  `normalizedBoardTitle` has had it, which is not verbatim, and the vibes
  survive nowhere at all. It is also the whole of what `vibes.resume` needs.
- **It is read back through `vibesBrief`, the same function that read the
  form.** The column is input again on the way out — written by whatever build
  was running the day the board was made — so `storedBrief` guards the shape and
  hands the rest to the reader. A row whose preset was renamed is refused rather
  than patched, because a run finished against a half-read brief is six pages
  asked for something nobody typed.
- **The refusal goes in the conversation too**, not only the answer. §IX.2 asked
  for one assistant row per page carrying agent 8's closing line; a run that
  stops at page four would otherwise leave three answers under an ask for six
  pages with nothing saying which page went missing. The `AgentRun` row has the
  account and the user never sees it. *(2026-08-29: the rows are gone and the
  `AgentRun` row is the account — the run panel reads it, which is the half of
  this that was missing when the bullet was written.)*
- **The outcome is returned rather than thrown**, refusal and all. The browser
  is the loop, and a loop told a page failed can stop with the pages before it
  kept — which is the whole reason this is six mutations and not one.
- **No `budget` is passed**, alone among agent 8's callers. The picture ceilings
  are a *turn's* (§VII) and agent 6's door hands down the turn it is running
  inside; a Vibes page is a turn of its own, so each one opens its own ceilings
  — the honest reading of a run the user watches page by page and can stop.

The contract test that read "one door opens onto agent 8" is now two doors, and
what it asserts beside the list is the thing §IX.5 actually warns about:
`designerToolsets` and `runDesigner` appear nowhere in `src` outside the
designer's own directory, so two doors cannot quietly become two agents.

**Built — the loop** (`lib/vibes/vibes-loop.ts`, `app/projects/[id]/vibes-run.ts`,
`vibes-run-panel.tsx` and `board-reload.ts`, 2,811 → 2,826 cases). The browser
half this section asked for: one page at a time, a card that says which page and
how many, and a Stop button. The loop's *state* is a pure value with its own
tests — which page is next, what the last one answered, what sentence the user is
owed — and the component is the awaiting and the card. Six things the build
settled that this section did not say:

- **The loop cannot live where the form does.** The form is inside the editor,
  and the first thing `start` causes is the panel opening the *new* board, which
  unmounts that editor — so a loop driven from the press would stop on its own
  first page. It is mounted in `ProjectWorkspace`, which outlives every board and
  the switch to the references grid, and hears about the run through an
  announcement (`vibes-run.ts`) of the shape `cut-taken` uses: a run starts once,
  and a late subscriber reading "there is a run" would start a second one over
  the pages the first is designing.
- **A refusal stops the run rather than skipping the page.** Whatever refused
  page four is almost always still true for page five, and the pages already
  designed are kept either way — which is exactly the failure mode §IX.2 justifies
  six mutations by. `vibes.resume` is how the rest is picked up once the reason
  is gone.

  *Amended when the empty page got a name* (§IX.5's "a closing line is not a
  page"): a refusal is the only thing that stops the run, and a settled page is
  now one of three — designed, empty, refused. A page that answered and placed
  nothing does not halt the walk, because running out of rounds is that page's
  own accident and says nothing about the next one.
- **Stop is "ask for no more pages", and the button says so.** A tRPC mutation
  has no abort that reaches the model, so the page in flight finishes; it is also
  *recorded* when it lands, because the design really was written to the board and
  a loop that dropped it would hand the same page back to be designed twice.
- **The board on screen had to be told.** The editor owns its document from the
  moment it mounts (`moodboard-panel` pins the query on purpose), so a run
  filling in pages from this same browser was invisible until something asked for
  a reload — four minutes of an empty board. `board-reload.ts` is that request,
  counted rather than boolean because the same board is asked for again after
  every page, and the save gate runs before the remount so a page the user was
  drawing on is sent first.
- **The panel draws one mark per page, not a bar.** The pages exist up front,
  which is the whole reason `start` makes them, so the run has nothing to guess
  at — and a resumed run's untouched pages are exactly the gaps in what the loop
  was handed, which is how they read as already designed without a second query.
- **The run is in the stored conversation but not in the open column.** The
  assistant's column hydrates the chat store once and is written through by its
  own send path (`chat-log.ts`); the rows `start` and `designPage` write
  server-side arrive on the next load. §IX.2's reason for the rows — a board with
  no account of where it came from — is met, but the user watching the run sees
  it in the panel rather than in the chat. A live append is the missing half and
  belongs with whatever else ever needs to push a server-written row into an open
  column.

**Built — the resume door** (`vibesResumeOffer` in `lib/vibes/vibes-resume.ts`
and the offer card in `vibes-run-panel.tsx`, 2,826 → 2,833 cases). Picking a
half-finished board up is a button that announces a run, not a second loop: the
query already answers in `announceVibesRun`'s shape, so the press hands `pending`
to the same listener the form's own success hands `pageIds` to, and everything
below it — the walk, the card, Stop, the reload requests — is the code that was
already there. Four things the build settled:

- **The board being open is the whole trigger.** Nothing on the server watches
  for a closed tab (§IX.5), so the question is asked where the answer can be
  acted on: the panel reads whichever board the tab row settled on
  (`board-selection.ts`) and asks `vibes.resume` about it. That costs one scene
  read per board opened, which is the price of not keeping a second record of
  what ran — and it is the same read `moodboard.pages` already makes for the
  page picker (§V.5).
- **Only while nothing is running.** The query is disabled the moment a run is
  held, because a live run *is* that question answered — and re-enabled when the
  finished card is dismissed, which is how a run that stopped at page four is
  offered its remaining pages the moment the user puts the refusal away. The
  walk invalidates it at the end for the same reason it invalidates the tab
  row's picture: both were read before these pages existed.
- **`vibesResumeOffer` returns nothing for a finished board**, and that null is
  the load-bearing half rather than the label. A card reading "0 pages left" is
  the same question answered twice and one misread press away from laying a
  second design over the first — so a board with every page designed makes no
  offer at all, and the panel has one question to ask rather than an arithmetic
  to repeat.
- **What the card says is two sentences, both pure.** Where the board got to
  ("3 of 6 pages designed") and what finishing it costs ("Design 3 pages") — the
  second said the way §IX.4 has the form's own button say it, because this press
  buys exactly what that one did.

### 3. The prompt the form becomes

A pure function in `lib/` — form values plus the page's index plus the catalogue
in, one `intention` string out — so what the model is asked can be asserted
without reaching Vertex, like every other prompt in this file.

What it has to say, and each clause is there because leaving it out has a
specific failure:

- **The purpose and the vibes, in the user's own words.** Paraphrasing a brief is
  the one thing a brief cannot survive.
- **The palette as hexes**, said as a constraint: these are the colours, the page
  background is already the first of them, do not introduce a sixth. Without the
  last clause a model that has been handed five colours treats them as a starting
  point.

  *Amended when the contrast census read the list rather than the page*
  (§IX.5's palette bullet). Closing the list is right and stays; what the build
  found is that closing it is also what makes most of this product's unreadable
  pages unreadable. Of the 196 failing pairs on the database, **129 stood on a
  ground for which the brief holds no legible ink at all** — and the six-page
  lookbook that owns 86 of them was handed five hexes with **no pair over
  1.95:1 in it**, so no page obeying that palette could have carried a readable
  caption. A palette is five colour wells filled in by a person for mood;
  nothing about that act has any reason to leave a readable pair behind. So the
  same arithmetic `contrastRead` does after the fact is done over the list
  before the page exists (`paletteContrast`), and the clause now says which of
  the colours can carry small type on which — "of these, one pair holds apart
  enough to carry small type, one on the other: #78a8a4 and #2c3234 (4.9:1)" —
  or, where none can, names the widest and hands over the one thing outside the
  list the model may use: near-black or near-white, **for small type only**.
  Three things about that exception. Its scope follows the palette: with a pair
  that carries a headline it is for small type only, and where nothing in the
  list carries type on anything else in it at *any* size it covers the headline
  too — which is the case the two warm runs in §IX.5 both failed on, and each of
  them failed on nothing else. It is stated in the same paragraph as "do not
  introduce another one", because an exception in a paragraph of its own is a
  second rule rather than a carve-out of the first. And it costs no declaration
  tokens and no round: this is a sentence in an intention, computed from five
  hexes the form already holds.
- **Which page this is** — "page 3 of 6". A page that does not know it is one of
  six is a page that tries to say everything.
- **For page 2 and after, the coherence clause**: the earlier pages are on this
  board already, look at them, and make this one belong to the same set — same
  type, same palette, same margins, different content. This is the whole of what
  makes six pages a set rather than six unrelated designs, and it works because
  `read_canvas` carries the board picture (§IV.1). It is a request, not a
  mechanism; see (5).

  *Amended when the set came back a template* (§IX.5's second eyeballing). The
  clause now has a second half, on the same pages and in the same paragraph:
  arrange it differently, do not repeat a layout that is already on the board,
  what holds is the type, the palette and the margins and what has to move is
  where the weight sits and what the pictures do — "a set is pages that
  recognise each other, not one page filled in N times", with N the brief's own
  page count. The reason it is an amendment rather than a new clause is that the
  first half was answered *exactly*: six pages matched the type, the palette and
  the margins, took different content onto each, and were identical in weight to
  the decimal. "Different content, same set" is a template read literally, so
  the sentence that named only what holds now names what moves beside it.
- **The pictures**, as the same catalogue lines `list_gallery` answers with
  (§IV.3) so the model is not handed a second dialect, capped at `CATALOG_LIMIT`.
  The project's whole gallery, not the canvas selection — the board is new, so a
  selection on the board the user was looking at means nothing here. With two
  sentences the cap makes necessary: they do not all have to be used, and on a
  multi-page run the same photograph on two pages is a set that looks thin.
- **A reminder to read a skill first.** §II.6's loop already opens with it; a
  prompt this specific is exactly where a model skips it.

  *Amended when the ledger said which skill.* The reminder was being obeyed and
  spent the same way every time: of the 33 designs that recorded which of §V's
  thirteen they read, `colour-theory` was in **none**, and in none of the 23
  whose intention carried a palette either — three slots, an occupation and two
  ways of arranging a page (§VIII). So the reminder now names one of the three:
  "One of the three is colour theory: the colours here were chosen before the
  page was, and spending them well is most of what this page is." Two
  things about where it sits. It is on the reminder's own paragraph rather than
  a new one, because a second paragraph about step 1 is a second step 1. And it
  is *here* rather than in §II.5's instruction, where it was tried first and
  measurably did nothing across two live runs and two wordings: the skills are
  chosen in round 1 off the words in front of the model, the instruction is the
  same paragraph on every job, and this form is the only caller that knows the
  colours were decided before the page was.

  **It fired on the first ask, and what it cost is the occupation.** A live
  design on the amended intention ($0.17, 11 rounds, PORTRAIT_HD) opened with
  `get_skill(["colour-theory", "typography", "grid-systems"])` — the first
  design of 68 on this database to read the colour skill. Three slots is three
  slots, so naming one spends one: what the model dropped was
  `album-designer`, its own trade, not one of the two ways of arranging a page.
  That is the trade this clause makes and it should be read as a trade rather
  than a win, because the page it produced is not measurably more legible than
  the two made without it — 16 type-on-ground pairs on each, worst pair
  `#78a8a4` on a 35% `#415557` card over the charcoal ground, 4.17:1 on all
  three. What the clause fixes is that the guard is now *asked for*; whether
  reading it changes a page is a question one run cannot answer and §IX.5 is
  where the answer belongs.

**Built** (`lib/vibes/vibes-brief.ts`, with §IX.4's three constants and the
form's own reader beside it, 2,757 → 2,774 cases). The brief and the intention
are one module rather than two because they are one decision said twice, and a
second reading of "what did they want" between the form and the model is exactly
the split §IX.5 says the two doors into agent 8 must never become. Seven things
the build settled that this section did not say:

- **The form is refused, never repaired.** Sixty pages clamped to six is six
  design calls the user did not ask for and is billed for; a colour quietly
  dropped is a palette the finished board does not match; a purpose truncated at
  200 is a brief the model reads the front half of. `vibesBrief` returns null and
  every refusal is a message the form can put beside the field it belongs to.
- **A repeated colour collapses**, and only that. Left in, the duplicate spends
  one of five slots and reads to the model as an emphasis nobody meant — but it
  is also the one thing a user cannot have meant, which is why it is the only
  repair in the reader.
- **The palette is required, minimum one.** The palette is the whole of what
  holds the set together — the colour direction every page's type, fill and
  shape is worked in (§IX.3) — so a brief with no colours is a prompt with no constraint
  in it where its strongest one belongs. What it costs: a project whose
  photographs have no palette yet gets no seed from `mergedPalette`, so the form
  must offer a colour of its own rather than an empty row. That is a form
  decision and it is not made here. *(Written when the first colour was also the
  paint every page arrived on; that half went 2026-08-29 and the requirement did
  not move.)*
- **`index` is 0-based in and 1-based out.** The browser is holding
  `vibes.start`'s own `pageIds` when it calls, so the argument is a position in
  that array; "page 3 of 6" is the only form of that sentence anybody writes.
- **The catalogue lines are `list_gallery`'s fields in `page-brief`'s line
  shape** — `galleryList` picks the words and the cap, and the line is joined
  with ` · ` exactly as a block on a page brief is. One dialect for a picture
  named in the ask and the same picture listed by the tool, and no third one.
- **A project with no pictures says so** — "make the page out of type, shape and
  colour" — rather than sending a heading with nothing under it. The two
  sentences the cap makes necessary go with the list and not with its absence.
- **`themeColour(brief)` is a named function, not `palette[0]` at three call
  sites.** "The first colour" is a fact about this form, not about arrays, and
  `vibes.start` and every page's prompt have to agree about it.

### 4. Constants

| constant | value | bounds |
|---|---|---|
| `VIBES_PAGE_LIMIT` | 6 | pages per run, and therefore design calls. Six is already the most expensive single action a user can take in this app |
| `VIBES_PALETTE_LIMIT` | 5 | colours in the brief. Past five it is not a palette (`BOARD_PALETTE_LIMIT` 8 makes the same argument about swatches) |
| `VIBES_TEXT_LIMIT` | 200 | purpose, and vibes, each |
| catalogue cap | `CATALOG_LIMIT` 24 | inherited from `list_gallery`, same lines |

The submit button says what it is about to do — how many designs it will run —
because six design calls is six tool loops with vision in them, and the one thing
this form must not be is a button whose cost is invisible.

**Run for real, 2026-08-23** (`npm run vibes:run`, six pages, LANDSCAPE_HD, the
five colours `mergedPalette` seeded off the project's own photographs, "a
lookbook for the spring accessories drop, to send to stockists"). What it came
to, from the run row rather than from a memory:

```
6 designs   $0.63   12m 45s wall   revision 0 → 21
rounds      limit 12  max 12  mean 11.2   4 of 6 at the limit, 2 stopped mid-work
pictures    limit  8  max  8  mean  6.8   2 refused, 5 dropped by PICTURE_WINDOW
draws       27 between them, 18 made / 9 cached — 33% hit rate
put_on_canvas in 5 of 6 designs
```

**`VIBES_PAGE_LIMIT` 6 is not the binding constraint — `DESIGNER_ROUND_LIMIT`
12 is.** Four of the six pages spent their last round at the ceiling and two
were cut off mid-work by it, one of them having placed nothing at all. A run of
six pages costs about ten cents a page and thirteen minutes, which is defensible
for the headline action; a page cut off halfway through its own repair is the
thing the user actually sees. The reading to take from this table is that
raising the page limit would buy more of the same, and raising the *round* limit
would buy finished pages — but that ceiling is §VII's and is argued there, not
here.

The resume door was run against the board this left behind
(`npm run vibes:run -- --board <id> --resume`, $0.12, one design) and answered
correctly at both ends: "5 of 6 pages designed — Design the last page" going in,
page 5 alone designed, "every page of this run is designed" coming out. That
page hit the round ceiling too — three of the seven designs on this board did —
and stopped with its spec card drawn and empty, and it reused page 1's
photograph against the intention's own sentence about a set that looks thin. The
ceiling is the finding; both of those are downstream of it.

**The same table, taken again after §VII's countdown landed** — a fresh
six-page PORTRAIT_HD run, same script, same door:

```
6 designs   $0.56   ~11m wall
rounds      limit 12  max 11  mean  9.2   0 of 6 at the limit, 0 stopped mid-work
                                          9, 11, 10, 8, 10, 7
put_on_canvas in 6 of 6 designs
vibes.resume: every page of this run is designed
```

Every page ended by answering. The mean *rose* — 9.2 rounds against the last
run's 11.2 only because the last run's number is four pages pinned at the
ceiling rather than four pages that wanted twelve — and the two lines that
matter both went to six: every page placed something, and `vibes.resume` found
nothing left to do, which is the same reading twice from two different readers
(§IX.6). So the sentence above stands with its subject changed: the binding
constraint on this run was neither ceiling. What the run is now bounded by is
what the pages *look* like, which is §IX.5's business and where the two new
readings below were taken.

**A third time, with §IX.3's vary clause in the coherence paragraph** — same
brief, same five colours, same six PORTRAIT_HD pages, the one variable changed:

```
6 designs   $0.78   ~18m wall
rounds      limit 12  max 12  mean 11.5   3 of 6 at the limit, 0 stopped mid-work
                                          11, 12, 11, 11, 12, 12
put_on_canvas in 6 of 6 designs
vibes.resume: every page of this run is designed
```

Asking for six *different* arrangements costs rounds: the run went from 9.2 to
11.5 mean and from none at the ceiling to three, and $0.56 to $0.78. None of the
three was cut off — every page ended on its own line with work on it, which is
what §VII's countdown bought and is why "at the limit" is no longer the same
reading it was in the first table. The census moved with it: 11 of 56 designs at
the limit before this run, 14 of 62 after, mean rounds 7.4 → 7.8. A page that
has to invent a layout rather than fill one in spends the budget, and the
countdown is what lets it close out inside the ceiling anyway.

### 5. What can go wrong

- **Coherence is a request, not a mechanism.** Page 4 matching page 1 depends on
  agent 8 looking at the board picture and choosing to match it. Nothing checks,
  and nothing can: "these six look like a set" has no assertion. This is the
  first thing to eyeball on a fixture run, and if it fails the fix is the prompt
  or a skill, not code.

  **Eyeballed, 2026-08-23** (`npm run vibes:run`, the six pages in §IX.4's
  table). It works. Pages 1–4 and 6 read as one lookbook: the same ground, the
  same terracotta type against it, the same rounded card device carrying every
  photograph and every spec block, a running foot on all of them and a `0N / 06`
  folio in the same corner. Pages 3 and 4 are page 2's layout mirrored, which is
  a set rather than a repeat. Nothing in the code made that happen — the
  coherence clause asked for it and the board picture is what let the model
  answer.

  **Eyeballed a second time, on a run where every page finished** (§VII's
  countdown had landed; six PORTRAIT_HD pages for a coffee roastery, $0.56).
  Coherence is no longer the thing to watch — it now over-delivers. All six
  pages are the *same* page: rule under a wordmark, one centred headline, a
  strapline, one framed portrait crop at the same box, two rounded charcoal
  cards, `PAGE 0N / 06 · WINDOW & COUNTER SERIES` in the same foot. `planRead`
  says it in numbers before anyone looks — 166–169% inked and `41% / 65%`
  middle-and-bottom weight on all six, identical to the decimal. The first run's
  mirrored layouts read as a set; this one reads as a template filled in six
  times, and the difference is that every page here got to finish, so every page
  got to complete the same plan. That is a prompt reading rather than a bug:
  §IX.3's coherence clause asks a page to match the ones before it and says
  nothing about what it should vary, and the six-page case is where the missing
  half shows. Worth deciding before it is written — a "vary" clause is one more
  sentence and one more thing for a page to get wrong.

  **Written, and eyeballed a third time on the same brief** (§IX.3's amendment,
  §IX.4's third table). The clause was worth writing and it worked on the first
  ask: six pages, six arrangements, and the model says so in its own closing
  lines — "introducing a fresh editorial layout", "a distinctive split-card
  layout", "an asymmetric 2×2 split-grid". `planRead` agrees before anyone
  looks: the middle-and-bottom weight that was `41% / 65%` on all six is now
  `44/47`, `59/17`, `70/45`, `70/45`, `76/46`, `70/46`, and ink spreads 150–175%
  where it was 166–169%. Page 1 is a poster, page 2 a menu card over a split
  foot, page 3 a two-column feature over a three-card grid, page 4 twin panels
  over a picture-and-spec pair, page 5 an asymmetric 2×2, page 6 a stack of
  tiers — one wordmark, one type system, one palette across all of them. Two
  things it cost, both worth knowing: three of the six spent the whole round
  budget (§IX.4), and the denser pages walked straight into the next bullet.
- **The palette is a constraint nothing enforces**, for the same reason. A model
  that has been handed five hexes and reaches for a sixth produces a page that is
  fine on its own and wrong in the set. Worth a cheap check after the fact: read
  the fills off the finished pages and compare them against the brief — the read
  exists now that shapes are objects (`canvas.md` §XI.1).

  **Seen, 2026-08-23.** One page in six drifted: page 2's headline is set in
  black on a brief whose five colours are all warm — every other page's headline
  is the brief's own `#e19a6b`. One page out of six, in the one word on the page
  that is most visible, is exactly the shape this bullet predicted: fine alone,
  wrong in the set. The cheap check it proposes is now cheap for a second reason
  — `vibes.run`'s own pages are read back through `planRead` on every run, so
  the fills are already in hand.

  **Seen again on the second run, and the drift moved.** No page reached outside
  the five: every headline, card and rule on all six is one of the brief's own
  colours, and the model quoted the five hexes back in its own closing line for
  pages 3 and 4. What went wrong instead is *inside* the palette — the third
  line on each charcoal card is `#415557` slate on `#2c3234` charcoal, two
  neighbours of a five-colour set laid on each other, and it is unreadable at
  arm's length on pages 1, 2 and 4. So the failure this bullet predicted has a
  sibling it did not: a palette held perfectly and still spent wrongly. Contrast
  is not a colour the read can compare against a list — it is a *pair* — which
  makes it the one thing here no cheap after-the-fact check catches, and puts it
  with the skills (§V.2) rather than with the brief.

  **A third reading, and the pair did not come back.** Same brief and same five
  hexes, with §IX.3's vary clause the only change: every card on all six pages is
  `#2c3234` carrying `#78a8a4` or `#5a7476`, which is the light-on-dark end of
  the same set and legible at arm's length. Nothing here says the clause fixed
  it — a run is one sample and the two colours that collided are still both in
  the brief — but it does say the failure is occasional rather than structural,
  which is the reading that decides whether it is worth a mechanism. The skill
  already argues the point in prose (`colour-theory`: "a design that fails in
  greyscale fails in colour", and coloured type on coloured ground needing more
  separation than blocks of it would), so what is missing is not a sentence to
  write.

  **That last clause was wrong, and the ledger is what says so.** The skill does
  argue the point; no design has ever read it. Of the 33 designs that recorded
  their skills, `colour-theory` was read by none — and of the 23 whose intention
  handed them a palette of hexes, which is every run these three readings are
  taken from, 23 of 23 read no colour skill at all (§VIII). A design gets three
  and it spent all three on the occupation and two ways of arranging a page, so
  the argument for "no mechanism needed" was resting on a file the model never
  opened. There **was** a sentence to write, and it is not in the skill: the
  intention now names colour theory as one of the three (§IX.3), because this
  form is the one caller that knows the page's colours were chosen before the
  page was. Naming it in §II.5's instruction instead was tried first and did
  nothing — two live runs, two wordings, the same three skills both times — and
  that negative is the more useful half: the choice is made in round 1 off the
  words in front of the model, so a paragraph that is on every job loses to a
  brief that is about this one. What has not changed is the reading above. The
  failure is still occasional and this is still not a mechanism, which is the
  point: the cheap guard was never being asked for, and asking for it comes
  before deciding it is not enough.

  And it is still not known to be enough. The first design that read
  `colour-theory` (§IX.3) came back no more legible than the two beside it:
  measured over the three pages of the same brief, every one carries 16 pieces
  of type on a ground and every one's worst pair is `#78a8a4` on a 35%
  `#415557` card over the charcoal, 4.17:1 — under the 4.5:1 a body size wants
  and nowhere near the unreadable pair this bullet started from. So the reading
  to take next is the one this bullet has been asking for all along, now that
  it can finally be taken: pages designed with the skill against pages designed
  without it, on the same brief, more than one of each.

  **Built, as a reading rather than as a mechanism** (`lib/render/contrast.ts`,
  2,896 → 2,916 cases). Every reading above was taken by hand, and the two that
  disagreed — nine failing pairs unblended, none blended — disagreed because the
  arithmetic was being redone each time. `contrastRead(plan)` is that arithmetic
  once: for every line of type it walks *down* the plan from the line's own
  index to the first fill that covers the line's centre, composites every
  translucent layer above it onto the page's background, and reports the pair.
  It is on `planRead`, so `design:check`, `design:fixtures`, `design:pages` and
  `vibes:run` all say it in the same words, and it needed no new door: `plan`
  already resolves z-order with a page's children lifted into their own run, and
  it is the reader §III.2.1 has checked against excalidraw's own export.

  Four decisions the build made:

  - **WCAG's two thresholds, not one.** 4.5:1 under 24 scene units and 3:1 at or
    over it. One threshold flags every headline on this product, and a reading
    everybody learns to ignore is worse than none.
  - **Type over a photograph is counted, never judged.** The ground there is
    pixels no plan holds. It reads as `over a photograph: N lines` beside the
    pairs rather than as a clean page — invariant 7, at a reading rather than at
    a door.
  - **One sample point, the line's own centre.** A headline half on a card is
    two grounds and no single ratio, and taking the worse of the two would flag
    the pages that most obviously work.
  - **The hexes are said only when something failed.** On a page that clears,
    the ratio is the whole reading — the same argument `typedIn` makes about the
    pixel figure.

  Verified against the pictures rather than asserted: 42 of 42 sampled pairs
  across three real boards have a rendered PNG whose modal colour at the line's
  centre is *exactly* the hex this says the ground is, including the blends —
  `#344549` is a 40% `#415557` card on the `#2c3234` ground and the picture
  carries `#344549`.

  And the census it makes cheap says the failure is neither occasional nor
  structural but *per-run*. Over all 75 pages on the database: **27 pages carry
  a pair under what its size wants, 196 of 492 pairs**. It is not spread evenly.
  One six-page lookbook fails 86 of its 92 pairs at 1.5–1.6:1 — `#d8a280` on
  `#f2d4c9` and `#d8bca6` on `#f3e9e3`, two warm neighbours of a five-colour
  brief laid on each other at 12–15px, on every page. The roastery runs sit at
  2.0–3.8:1. Agent 4's composed pages and the welcome signs clear at 16.7:1.
  So the shape of it is: a design picks a pair *once*, early, and then holds it
  for six pages — which is the coherence clause working exactly as asked and
  spending it on the wrong choice. That is the reading this bullet has wanted,
  and it moves the question from "is a mechanism needed" to "the pair is chosen
  in round 1 and never revisited", which is where §IX.3 and §V.2 can reach it.

  **Built, and the reading it was owed turned out to be the wrong question**
  (`paletteContrast` in `lib/render/contrast.ts`, the ink clause in
  `lib/vibes/vibes-brief.ts`, 2,916 → 2,928 cases). Before running the A/B
  above, the same numbers were asked one more thing, and it is the answer this
  bullet should have started from: for each of the 196 failing pairs, did the
  brief's own colours hold *any* ink that would have cleared on the ground that
  line was standing on? **129 of the 196 did not.** The lookbook that owns 86 of
  them was handed five hexes with **no pair over 1.95:1 anywhere in it** — five
  warm neighbours — so no page obeying "everything you draw, type and fill
  belongs in this list" could have carried a readable caption, and no skill read
  in round 1 could have changed that. Only the other 67 were ever the design's
  to avoid, which is the half the skill argument reaches; two thirds of this
  product's unreadable type was the brief, not the design.

  That is a fault in a clause of §IX.3, not in the model. A palette is five
  colour wells filled in by a person for mood, and nothing about that act has
  any reason to leave a legible pair behind — the teal brief that made every
  other run on this database holds exactly one (`#78a8a4` on `#2c3234`, 4.9:1),
  and the warm one holds none. So `paletteContrast` does the same arithmetic
  `contrastRead` does after the fact, over the *list*, before a page exists, and
  §IX.3's palette clause now says what it found: which pairs can carry small
  type, or — when none can — what the widest is and the one ink outside the list
  the model may use, near-black or near-white, **for small type only**. The
  closed list is otherwise untouched below the point where it stops working:
  a headline in black on a palette that *can* carry one is still refused.

  **Four live runs, and the ink is visible in the hexes.** One page each,
  against the two briefs every earlier reading in this bullet was taken from,
  the clause the only change ($0.37 for all four):

  | brief | before | after |
  | --- | --- | --- |
  | warm lookbook, LANDSCAPE_HD | 86 of 92 pairs failing, worst 1.3:1 | 4 of 10, worst 1.9:1 |
  | warm lookbook, again | (page 1 of that run alone: 12 of 12) | 1 of 9, worst 1.9:1 |
  | teal spec sheet, PORTRAIT_HD | 6 of 14, worst 3.8:1 | 1 of 15, worst 3.8:1 |
  | warm lookbook, third branch | — | 1 of 10, worst 1.9:1 |

  `npm run design:pages` over the whole database afterwards: 203 of 536 pairs
  failing across 79 pages, against 196 of 492 across 75 before these four ran.
  The four pages added 44 pairs and 7 failures — 16% where the database it
  joined runs at 40%.

  **Amended 2026-08-30 — the list is a direction, not five fixed values.** The
  clause held the page to the exact hexes, and that is the half of it that was
  costing pages. Five colours chosen for mood leave a design with no tint to
  hold two blocks apart, no shade to sit a panel back, and no step lighter or
  darker to lift type off what it stands on — so a page that needs one of those
  forces one of the five where none of them fits. The brief now says the palette
  is the colour *direction* of the set: mixing inside it is the design's, and
  what may not arrive is named instead — a colour from outside the direction,
  brighter, cooler or louder than what is here, or a second family of colour
  beside it.

  The rule the clause was written for is unchanged, because the failure it was
  written against was never a tint: it was a sixth colour of its own family, a
  page fine alone and wrong in the set. The neutral-ink sentences above stay
  exactly as the census left them, minus their "the one thing you may add to the
  list" framing, which the direction reading makes untrue.

  The mechanism is in the elements rather than in the totals. Both warm pages
  set their body copy in a near-black that appears nowhere in the brief —
  `#2b211b` on one, `#231c18` on the other, six of ten lines and eight of nine —
  which is the ink the clause hands over and nothing else could have put there.
  The teal page never needed it: every one of its fifteen lines is `#78a8a4` or
  `#2c3234`, the one pair the clause named, and the model's own closing line
  says it — "set in the high-contrast pairing of `#78a8a4` and neutral ink".

  **And the residue named the last branch.** Both warm pages failed on exactly
  one thing and both times it was the *headline*: `#e19a6b` on `#f3e9e3` at
  1.9:1, at 36px and at 30px. That is the clause working as written — the
  neutral was scoped to small type — on a palette where the scope is wrong,
  because a list with no pair over 1.95:1 has nothing that carries a headline
  either. So the clause has a third branch: where **nothing** in the list clears
  even the large threshold, the neutral covers the headline too; where something
  does, it is named ("`#78a8a4` and `#344549` (3.8:1) will carry a headline")
  and the neutral stays with the captions.

  The fourth run is that branch, the same brief again: nine of ten lines in
  `#261f1b`, the 38px headline among them, and the one failure left is an 11px
  terracotta "WHOLESALE LINE SHEET & PRICING →" — an accent set in a brief
  colour on purpose, which is not something this clause has ever claimed to stop
  and should not. Across three runs on a palette that cannot carry type at all,
  the failing pairs went from 12 of 12 to 4, 1 and 1, and every survivor is one
  small line in terracotta on cream.

  The reading that settles it was already on the database and had been read
  backwards. This bullet's very first finding was "one page in six drifted:
  page 2's headline is black". Measured, page 2 is the *only* page in that run
  with any legible type on it — its six `#1e1e1e` lines are six of the run's six
  passing pairs, and all 86 failures are a brief colour on a brief colour. The
  drift was the design solving the problem, and the clause is now what asks for
  it rather than what forbids it.

  What was **not** built, and was flagged rather than decided for two
  iterations: the form (§IX.1) said nothing. It holds the five hexes,
  `paletteContrast` is pure, and a line under the palette row costs nothing and
  is the only place a person could change their mind about a colour. The
  question flagged was whether a mood board's form is allowed to have an
  opinion.

  **Built, and the answer is that it may have a reading and not a view**
  (`vibesPaletteNote` in `lib/vibes/vibes-form.ts`, the `note` prop on the
  form's `Field`; 2,942 → 2,949 cases). What the note says on the two real
  briefs on this database:

  ```
  #78a8a4 #5a7476 #415557 #2c3234 #344549   (nothing)
  #f2d4c9 #d8bca6 #f3e9e3 #e19a6b #d8a280   Type: no two of these hold apart
      enough to carry small type — the widest pair is #f3e9e3 and #e19a6b at
      1.9:1, where a caption wants 4.5:1. The pages will set their type in
      near-black or near-white; the colours are the fills.
  ```

  Four things the build settled that the flag did not say:

  - **It is a note, not a refusal, and the distinction is the product
    decision.** The warm five are the colours of the photographs in that
    project; a form that refused them would be overruling a person about their
    own mood on arithmetic they never asked for. The form submits either way
    and nothing about what runs changes. What it may do is tell them what their
    list will cost them *before* six design calls are billed, which is the one
    thing this door can do that no later door can.
  - **Silent on a list that clears**, for `contrastNote`'s reason (§IV.2) and
    one this door has of its own: the sentence appears the moment the last
    legible pair is removed and goes when one is put back. That is the whole of
    the feedback, and it is worth more than a line confirming the ordinary case
    — which on the teal brief would have been on screen for every run ever made
    from it.
  - **The same three branches `inkLine` has, off the same
    `paletteContrast`.** A form that told the user one thing and the intention
    the model another about the same five hexes would be the two readings of
    "what did they want" this section warns about, arriving one door earlier. A
    case holds the two to each other: whichever branch the intention takes, the
    note takes with it, silence exactly where the model is promised a pair.
  - **It reads the palette the *server* will read.** `briefPalette` came out of
    `vibesBrief` so the normalising and the duplicate rule are one
    implementation — the form holding `#2c3234` twice reads as the palette of
    one it will be submitted as — and a list the brief would refuse outright is
    left to its refusal rather than annotated underneath it.

  What the note cannot say is whether the palette is *wrong*: a board of five
  warm neutrals with black captions is a defensible board, and the run this
  clause was built from produced one. The form now says which board that is.

  And the census says how often it would say anything at all. Eleven of the
  thirty boards on this database were made by this form, and their briefs hold
  two palettes between them: the note is silent on the seven teal ones and
  speaks on **4**, every one of them the warm lookbook — the same brief the
  129-of-196 finding above came from and the one whose six pages carried 86
  failing pairs. So it is not a sentence that would have been on screen for
  every run; it is one that would have been on screen for exactly the run that
  needed it.
- **A closed tab stops the loop.** Pages already made stay, undesigned pages stay
  empty, and the board is left half-finished — which at least *looks* like what
  it is. `vibes.resume` picking up at the first empty page is the answer and is
  small; it should land with the first version rather than after someone loses a
  run.

  **Built** (`lib/vibes/vibes-resume.ts` and `vibes.resume` on the router,
  2,788 → 2,798 cases). `vibesRun({ elements, brief })` returns the run's pages
  in reading order, each with whether anything is on it, and `vibesPending`
  filters it; the query does the ownership check, reads the brief back through
  `storedBrief` and returns both lists off one read. Six things the build
  settled that this bullet did not say:

  - **It is a query, not a mutation.** Nothing is decided and nothing is
    written: `vibes.start` already put every page on the board, so resuming is
    a question asked of the scene rather than work to redo. The browser's loop
    is unchanged — it walks `pending` exactly as it walked `start`'s own
    `pageIds`, calling `designPage` with the index each entry carries.
  - **Which page is next is read off the scene, not off a record of what ran.**
    A record would be a second account of the same fact, kept current by every
    design call and wrong the morning a page is discarded by hand. The scene
    cannot be wrong about whether anything is on a page, because being on the
    page is what the question means.
  - **Blank means the page's own ground and nothing else** — asked of every
    live element on the page rather than of the read's four object kinds,
    because this is the one question where an arrow or a freehand stroke has to
    count. A page somebody drew on by hand is a page a design call would arrive
    on top of, and `unaddressable` (`canvas.md` §XI.1) exists precisely because
    those elements are invisible to the object read.
  - **Every blank page, not the tail after the last designed one.** A run
    stopped at page four leaves the same three pages either way, and a board
    whose second page was discarded and drawn again by hand has one hole in the
    middle that this fills without touching what is on either side of it. A
    page with something on it is never handed back: `designPage` places onto
    the page it is given, so a second call would put a second design over the
    first.
  - **The run is the first `brief.pages` pages of the board and not every page
    on it.** A seventh page added by hand afterwards is the user's own, and a
    resume that designed it would be this form spending a model call nobody
    asked for — the same failure as clamping sixty pages to six, arriving a day
    later. A board with *fewer* pages than the brief asked for is a run whose
    pages were discarded, and what comes back is what is there; "page 3 of 6"
    stays the brief's own number, because the brief is the ask and a page taken
    away afterwards is the user editing the result.
  - **A board with no brief on it is refused rather than answered empty.** It
    is `designPage`'s own refusal, made for the same reason — an empty list
    reads as "nothing left to do", which is exactly wrong for a board this form
    never made.

    *Amended when the door was built* (below): the refusal became a `null`. The
    reasoning above survives and only the shape changed — an empty `pending` is
    still not the answer — because the browser asks this of **every** board it
    opens, and most boards in a project were never a Vibes run. A throw there is
    an error the panel has to catch on the ordinary path; `null` is "there is no
    run here", which is what was being said all along.
- **A closing line is not a page.** The loop stops on a *refusal* and nothing
  else, and a design that runs out of rounds does not refuse — it answers with
  agent 8's own "I ran out of steps before I could finish" line. On the run in
  §IX.4 that happened twice: page 2 was cut off halfway through repairing its
  own header, which is visible and survivable, and page 5 spent all twelve
  rounds reading (`get_skill`, `read_canvas` ×3, `get_page` ×4, `get_image` ×2)
  and never called `put_on_canvas` at all. The run reported six successes, six
  assistant rows went into the conversation, and the board came out with five
  pages on it.

  Nothing here is wrong exactly — `designPage` did not fail and the page is
  blank rather than damaged — but two things follow. The first is that
  `vibes.resume` is not only the closed-tab answer: it is the *only* thing in
  the product that notices, and it noticed correctly ("5 of 6 pages designed —
  Design the last page" the moment the walk ended). The second is that a
  round-limit line carries no page number, so a user reading the conversation
  sees two paragraphs of "I ran out of steps" and cannot tell which page went
  missing — where the refusal path says "Page 4 was not designed" because
  `designPage` had nothing else to say. That asymmetry is worth closing, and it
  is one string in `vibes.designPage`.

  **Overtaken 2026-08-29.** The rows this finding is about are gone with the
  run's thread (§IX.2), and `lib/vibes/vibes-account.ts` with them. What survives
  it is the half that was never about the rows and is still load-bearing: the
  scene read below — a page that answered and placed nothing is not a designed
  page — and `empty` as a third outcome beside designed and refused. The run
  panel's pips and the resume offer are both counted from it. Read the build
  notes under this heading for that; the sentences about assistant rows are
  history.

  **Built** (`lib/vibes/vibes-account.ts`, `vibesPageDesigned` in
  `vibes-resume.ts`, three outcomes in `vibes-loop.ts`; 2,833 → 2,846 cases).
  It was one string and one read, and the read is the half this bullet had not
  asked for. Four things the build settled:

  - **Every assistant row names its page**, designed, empty or refused —
    `Page 5 of 6 is still empty — I ran out of steps before I could finish.`
    The total rides along because the row outlives the run: read a week later
    in a conversation with three boards in it, "Page 3" is a page of something
    and "Page 3 of 6" is a page of this ask. The refusal path keeps the
    sentence it already had and gains the same "of 6".
  - **The two rows of the run live in one module.** `vibesAsk` moved out of
    `vibes-start.ts` to sit beside `vibesSaid`: they are written minutes apart
    by two mutations and they are one account — the only account the user ever
    reads, because the panel is gone the moment the tab is.
  - **A page that placed nothing is not a designed page.** `vibes.designPage`
    reads the scene back the moment a design answers and asks
    `vibesPageDesigned` — the *same* reader `vibes.resume` asks, so the walk's
    account and the offer the board makes when it is next opened cannot
    disagree. One read of the elements column against a design call that costs
    minutes and dollars, and only when the design answered: a refusal placed
    nothing by definition. The run in §IX.4 would have reported "5 pages of 6
    designed — 1 page came back empty" rather than six successes.
  - **Empty is a third outcome and not a refusal.** The loop's settled page
    became `designed | empty | refused`, and only the last one halts: running
    out of rounds is that page's own accident and says nothing about the next
    one, where a quota or a board that went away is almost always still true a
    page later. So the run walks on, the count tells the truth at the end, and
    the page carries its own mark in the pip row — amber, a gap rather than a
    fault — with the resume offer picking it up the moment the card is put
    away.

  *Amended when the ceiling itself was answered* (§VII). Naming the page told
  the user which one went missing; it did nothing about the page going missing.
  The census that followed — 11 of 47 designs at the round limit, 8 stopped
  mid-work — is what moved the fix upstream of the account and into the loop:
  agent 8 is now told how many steps it has left three rounds out, so a design
  spending its last rounds one element at a time can batch them and a design
  that is done can stop and say so. An empty page is still a third outcome and
  the resume door still picks it up; what changed is how often either has to.

- **This is the most expensive action in the product**, and it is one click from
  the canvas. `VIBES_PAGE_LIMIT` and the cost said on the button are the whole of
  the restraint. Watch the `AgentKind.DESIGNER` rows (`npm run design:runs`)
  after real use before raising the limit.

  **Watched, 2026-08-23 — six stays.** 67 designs on the development database,
  $5.19 between them: a design is **$0.077** on average, so six of them is
  about **$0.46**, and the three real six-page runs in §IX.4 came to $0.56,
  $0.56 and $0.78 — the spread being what asking for variety costs (§IX.3),
  not the page count. The number that argues against raising it is not the
  money but the wait: 7.9 rounds mean and 15 of 65 designs at the round ceiling
  makes a six-page run eighteen minutes of sequential mutations with a Stop
  button as its only escape, and the twelfth page of a run nobody is watching
  is where a closed tab and `vibes.resume` stop being a nicety. Lowering it has
  no case either — no run has been cut short by the limit, and a lookbook is
  the thing this form is for. So the constant is left where it is, with the
  reading written down rather than the limit quietly moved.
- **Agent 8 now has two doors** — agent 6's `design_page` and this one — and they
  must not become two prompts. Both build an `intention` and call the same
  `designPage`; the day one of them starts passing something the other cannot is
  the day the agent has two behaviours and one instruction.
- **A line of type is not a paragraph, and the put door never said so.** Found
  on the third run (§IX.4), which is the first one whose pages are dense enough
  to reach it: `put_on_canvas` writes a text element with the box's `width` and
  `autoResize: false`, and stores the string exactly as it was passed. Nothing
  wraps it. Excalidraw's `text` field is *what is drawn after wrapping* — the
  door's own comment says so (`object-put.ts`) — so a sentence handed to a
  400-wide card is one long line that runs out of the card, off the page, and on
  pages 5 and 6 straight through the next block of type. Three of that run's six
  pages carry it and two are damaged by it; the template pages of the second run
  never showed it because every line on them was four words long, and the first
  run's landscape pages never showed it because the model placed each line as
  its own element on a page twice as wide.

  It is a bug at the door rather than a prompt reading — the model asked for a
  box and the door took the box, which is exactly what §XI's contract promises —
  and the fix belongs in `object-put.ts` beside the `fontSize` clamp, which is
  already the place that measures a string against its box. What is owed is
  wrapping to the width the caller gave (and a note when the text still does not
  fit, the way a clamped size is reported), not a refusal: a page that comes
  back missing its body copy is worse than one whose copy is wrapped a line too
  tight. `renderFont`'s families are the measurement, and `plan-read` already
  reads type sizes off a finished page, so the numbers exist.

  **Built — the words are broken to the box** (`src/lib/render/text-set.ts`,
  `object-put.ts`, `object-restyle.ts`; 13 cases, suite 2,857 → 2,870). Five
  things the build settled:

  1. **The measurement is character classes, not a flat ratio.** `setWidth`
     sums Helvetica's own advance widths averaged per class — capitals .68 em,
     lowercase .5, digits .56, `i`/`l`/`t`/punctuation .3, `m`/`w`/`M`/`W` .86,
     a space .28 — because the two numbers this codebase needs about a string's
     width are not the same number. `TEXT_ADVANCE` (0.75, `render-plan.ts`)
     decides how much transparent room a picture leaves around a line that
     already overflows and over-estimates on purpose; this decides where a line
     *breaks*, where being over by a hair breaks a headline that would have
     fitted. Checked against the real cases either way: `TASTING WORKSHOPS` at
     80px measures 907 against a true 898 and stays on one line in a 907 box,
     and 185 characters of body copy at 14px in a 475 box breaks where it has
     to.

     *Amended — the split is right and it had one caller too few.*
     `drawnBounds` is a third question and was taking `TEXT_ADVANCE`'s answer:
     where the ink of a set line actually *lands*, which is what ink, covered,
     the bands and the margins are all rectangles of and what `contrastRead`
     samples the ground under. There the error runs the same way it does at a
     break — over by a third is the reading. It measures now (`setOverflow`),
     the rasteriser's pad is untouched, and what that was costing is in §VIII.
  2. **The width is kept and the height grows.** That is excalidraw's own
     behaviour for an `autoResize: false` block, and it is the only reading that
     leaves the type at the size the box asked for: the boxes that carried this
     were *one line tall* — 475 by 18 units under a 185-character sentence — so
     sizing the words to fit inside the box would have set body copy at 3px.
     The block standing below where it was placed is the part the design has to
     settle, which is what `TEXT_WRAP_NOTE` says and what `wrapped` counts.
  3. **`originalText` stops being a copy of `text`.** The breaks go in the drawn
     string only, which is excalidraw's contract and what lets the editor
     re-wrap the sentence rather than resurrecting this door's guess at where it
     broke — and what lets a restyle re-wrap from the words rather than from the
     last width they were broken to.
  4. **A second door had the same bug and it took a live run to see.**
     `restyle_on_canvas` rewrote a text element's `height` from its `fontSize`
     alone, so the first run with the put fixed came back with both paragraphs
     wrapped in the picture and one line tall to the read — the model restyles
     what it has just put, every time. The height and the breaks now come from
     one `setBlock`, at both doors.
  5. **`transform_on_canvas` is the third door and is deliberately left.** A
     resize scales a text box's width and its `fontSize` together and does not
     re-wrap, so a paragraph dragged narrower keeps the breaks it had. Unlike
     the other two, its height is the box the model steered by — re-measuring it
     would fight the placement it just asked for — so what it needs is its own
     reading rather than the same three lines.

     **The reading, taken.** Leaving it was right and the argument above is the
     whole of it: a resize multiplies a block's width, its `fontSize` and its
     height by *one* number, so the breaks a block is already stored with stay
     right in the box that is left, and there is nothing to re-settle. Measured
     over all 440 text elements on the development database, re-broken at the
     scaled size and compared against the breaks they carry: at a scale of 3 no
     block changes line count at all, at 0.75 two do, at 0.25 thirteen do — and
     every one of the thirteen is a headline whose box was set to the width the
     words measure, `TASTING WORKSHOPS` in a 907-unit box at 80px, tipped over
     by the half-unit `round()` puts into `fontSize`. Re-wrapping at this door
     would break exactly those headlines, on a call that asked for a resize.

     **What the reading found instead was a missing floor.** The type scales
     with the box in both directions and the door clamped neither end. The
     *ceiling*'s absence is deliberate and load-bearing — `TYPE_CLAMP_NOTE`
     sent type larger than the put's 96 through here, because 96 is a property
     of deriving a size from a box and a resize derives nothing. (It no longer
     does, and the reason is `canvas.md` §XI.2's own amendment: the put grew an
     explicit `fontSize` and the restyle was built, so the clamped line has a
     one-call way out that does not move it and the next headline has a field to
     say its size in. The absence of a ceiling here is still deliberate — a
     resize derives nothing — it is simply no longer the *only* way up, and 13
     of the 574 text elements on this database sitting at exactly 96 against one
     at 110 is what says the two-call route was named and not taken.) Downwards
     there
     is nothing to reach: `LAYOUT_TEXT_MIN_FONT` 12 is the size the put clamps
     *up* to and the restyle refuses under, and it is where the type on this
     product actually lives — 69 of the 440 elements sit exactly on 12 and 254
     sit under 20, so one ordinary "make this half the size" took 283 of the 440
     under it, and a scale under a twenty-fifth rounded the type to **zero**: a
     line not merely small but gone, and gone in a way scaling back up cannot
     undo.

     **Built** (`flooredText` in `object-transform.ts`, `TYPE_FLOOR_NOTE` in
     `designer/canvas.ts`; suite 2,880 → 2,890 — since moved to `flooredType`
     in `render/text-set.ts`, see the tidy below). The size stops at 12 while the
     box goes on down, the shortfall comes back as `clamped` and reaches agent 8
     as `typeSet` on the put's own gate — and *from that moment the door is a
     text door*, because the type is no longer proportional to what holds it. So
     the block re-breaks to the narrower width and stands to the height its
     lines came to, from the same `setBlock` the other three take. Three things
     the build settled:

     - **The floor is where re-wrapping starts, not the door.** Above it,
       nothing; below it, everything. That is the sentence the bullet above was
       looking for and could not find while the question was "does a transform
       wrap".
     - **The note names its number and the put's deliberately does not.** A
       ceiling printed in prose comes back as the size the model asks for, so
       `TYPE_CLAMP_NOTE` withholds 96; a floor is a size to clear rather than
       aim at, and `object-style.ts` already says both ends of 12–512 out loud
       at the restyle door.
     - **A bound label takes the floor and keeps its breaks.** Its box belongs
       to the container that draws it, which is the same slot-versus-measurement
       split `reword_on_board` drew — and `setsToItsBox` is still what decides
       for everything else.

     Checked against the database rather than a live run, the way the fourth
     door was: every one of the 440 elements transformed on its own at five
     scales, with **0 under 12 and 0 at zero** at every one of them against 283
     and (at 0.04) 440 before. The 22 lines stored wider than their box come
     *down* to 10 under a halving, because 295 of the 440 hit the floor and
     re-broke on the way. Below a tenth the count rises again and every one of
     them is a single word in a box narrower than the word — `wrapToWidth`'s own
     documented refusal to cut a word in half, not a wrap that failed.

     **And one live run, because the fourth door's lesson was that a design
     restyles what it has just put.** `design:check` on "a dense coffee spec
     card: two cards of body copy, then shrink each text block down hard so it
     reads as fine print in a tight box" (gemini-3.7-flash, $0.14, 12 rounds,
     PORTRAIT_HD): **four** `transform_on_canvas` calls carrying 25 changes,
     most of them text blocks resized and re-placed, after one
     `restyle_on_canvas` that set three of them by `fontSize`. All 12 text
     elements on the finished page sit inside their own box — measured with
     `setWidth` against each stored width, 0 over — with the two body
     paragraphs standing 3 lines deep in their cards and one block at 14.42px,
     which is a put's 15 scaled by a resize.
     
     The floor was never reached, and *why* is the reading: asked for fine
     print, the model went to `restyle_on_canvas` with an explicit `fontSize`
     and put 13 in it. The resize is how it moves and re-fits a block, not how
     it chooses a size — so the floor is a guard on the accidental case rather
     than a bound on the intended one, which is the same shape as the put's own
     clamp. (It also asked for `size: [0, 820]` on two text blocks in one call,
     which the door has always refused — "only a shape may be flat" — and the
     next round came back with `to` alone and no `size`.)

     **The tidy is a fifth door and had no floor either — now closed.**
     `board-arrange.ts` writes `placement.fontSize` straight out of the same
     `elementPlacements`, so a press of tidy that shrank a captioned group
     shrank the caption's type with nothing under it. It was left as a user's
     own press with a visible result and one ⌘Z behind it; it is taken now
     because the two doors are not two rules and never were.

     **Built** (`flooredType` in `render/text-set.ts`; suite 2,890 → 2,894).
     The floor moved out of `object-transform.ts` and into the file the other
     three doors already share, and the tidy calls it beside the placement it
     was already writing. Nothing about the answer changed — the transform
     door's own cases pass untouched — which is the whole argument for moving
     it: a floor implemented twice is a floor that drifts, and this one carries
     the pinned/unpinned split and the bound-label branch with it.

     What separates the two doors is only what they say afterwards. The
     transform reports the shortfall as `clamped` and agent 8 reads it as
     `typeSet`, because a model that asked for 4px and got 12 has to know
     before it places the next thing. The tidy says nothing: the user is
     looking at the result, and a toast about point sizes on a press whose
     whole promise is "make this neat" is noise.

     **Census, before building: the tidy's exposure on real data is zero, and
     that is not the same as no bug.** Simulating a tidy over all 26 boards on
     the development database writes **0** text placements — 452 text elements,
     **none** of them in a group, and 123 arrangeable units of which **none**
     is a multi-element group. Nothing this app writes ever groups anything;
     `arrangeableUnits`'s member list exists for the captioned photo a *user*
     grouped in the editor, which is the one case the fix guards. So this is a
     latent door rather than a live one, and the census is the honest way to
     say so — the previous four were all found with elements on the board to
     point at.

  Verified on a real one-page run ($0.11, 139s, 11 rounds, PORTRAIT_HD): a spec
  sheet with two cards, each carrying a paragraph, every one of its 14 text
  elements inside its own box and the two paragraphs standing 4 and 5 lines deep
  in their cards. The same ask on the run before the fix is the one that put
  three sentences through the next block of type. A second run of the same ask
  after the restyle door was closed ($0.11, 131s, 11 rounds) came back with
  three cards, three paragraphs at three lines each and 16 of 16 text elements
  inside their own boxes — measured with `setWidth` against each element's
  stored width, which is the cheapest after-the-fact check this has.

  **Amended — there was a fourth door, and it is not on the canvas.**
  `reword_on_board` (`lib/boards/board-text.ts`) writes the words of a line the
  user asked to change, and it wrote them the way the put used to: one string in
  both fields, nothing broken, the box left alone on purpose. Its own comment
  said why — "guessing a new height here without a canvas to measure with would
  move a block that has no reason to move" — which was right for as long as
  there was nothing to measure with, and stopped being right the moment
  `text-set.ts` existed. So a headline reworded into a sentence ran out of the
  slot agent 4 composed it into, exactly as a put did, on the tool a user
  reaches for most. It now breaks the words to the slot and stands to what they
  came to, from the same `setBlock`. Two things this door settled that the
  canvas two did not:

  - **The width is still deliberately left alone**, and that is the split the
    reword's original comment was reaching for. A slot narrowed to its new
    wording is a layout this door was built not to redo; a slot whose words are
    broken to it is the layout standing.
  - **A block that sizes itself is not any door's to break** (`setsToItsBox`).
    Excalidraw wraps to the element's own width only when it is pinned
    (`autoResize: false`); otherwise the stored width is a measurement of the
    string it used to carry rather than a slot anybody chose, and breaking new
    words to it breaks them to a width nobody decided. The restyle door was
    re-wrapping those too, and was collapsing the newlines somebody typed into
    them on the way — both closed here, with `wrapToWidth` now keeping a hard
    break and taking out only the soft ones a width put in.

  Checked against the database rather than a live run, because this door is a
  user's sentence rather than a design: every text element on it is pinned (440
  of 440, none auto and none without the field), and the 21 lines still stored
  wider than their box — all of them on the two boards made before the put was
  fixed — come back inside it when the reword door is asked for them, at 2 and 3
  lines where they were 1. The four that first read as "still over" were the
  harness rewording a *duplicated* page's headline: the door lands each pair on
  the first block carrying those words, by design, and the check was reading the
  untouched twin.

### 6. Running one for real — `npm run vibes:run`

**Built** (`scripts/vibes-run.mts`; no new cases — it is a script, and the suite
is what it exists to be the other half of).

Every part of this section is under test with the model call injected: the
brief, the intention, the loop's arithmetic, the resume. What none of it could
cover is the run — six pages that each read well alone and do not belong beside
each other is a failed run, and §IX.5's first bullet is the standing admission
that no assertion will ever say so. `npm run design:check` is that other half
for one design and `npm run design:fixtures` is it for §VIII's three asks; this
is it for a whole board.

```sh
npm run vibes:run -- --project <id> --pages 6 --vibes "warm, unhurried, sunlit" "a lookbook for the spring drop"
npm run vibes:run -- --board <id> --resume        # pick up a half-finished one
npm run vibes:run -- --intentions                 # print what each page's model is asked
```

Four things about how it runs, each of which is the difference between measuring
the product and measuring the script:

- **It goes through the procedures, not the modules under them.** A caller over
  `vibesRouter` with the project's own user in the context, so `vibes.start`,
  `vibes.designPage` and `vibes.resume` run with their ownership checks, their
  stored brief, their chat rows and their page grounds intact. The one thing it
  re-implements is the browser's loop (`vibes-loop.ts`), because that is a React
  component — and what it re-implements is a `for` loop that stops on a refusal.
- **The form's own opening draft is the brief**, seeded from the project's
  photographs through `vibesDraft` exactly as the form seeds it; the flags are
  the fields somebody would have edited. A script inventing its own colours
  would be measuring a brief no user can type.
- **The whole set is drawn from one scene read, afterwards**, and every page
  gets a `planRead` line beside its PNG. A render taken mid-run is a board
  halfway through being written, and the question here is about the set.
- **It ends by asking `vibes.resume`**, which is how the blank page in §IX.5's
  new bullet was found: a run that walked every page and still reports pages
  pending is a page that came back with a line and nothing on it, and no
  assertion in this repo can catch that because no assertion lets a real model
  answer.

  *Amended when that bullet was built*: the closing `vibes.resume` is no longer
  the only place it shows. `vibes.designPage` reads the page back itself now, so
  the script says `empty: nothing was placed on the page` beside the line as the
  walk goes — the closing check stays, because a page discarded or drawn on
  between the walk and the read is a difference worth seeing.

It also found the reason none of this had ever run: `Moodboard.vibesBrief` had
been migrated onto the local Docker Postgres and never onto the Cloud SQL
instance `server/db.ts` actually dials, so `vibes.start` had been failing with
`P2022 ColumnNotFound` in the real app for four days with a green suite the
whole time. `infra.md` §"a migration written after the cutover has two databases
to reach" carries that, and the short version is that `npm run db:deploy` has to
be run twice — once bare, once with the tunnel up.
