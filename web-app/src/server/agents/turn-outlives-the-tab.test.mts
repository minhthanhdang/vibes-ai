import { test } from "node:test";
import assert from "node:assert/strict";

import { readSource } from "@/server/google/source-tree";

/// The streaming procedures' load-bearing lines, held over the source because
/// nothing in this repo can run them.
///
/// A tRPC mutation wants an authenticated context, and `src/server/api/` has no
/// tests and no way to have any — the idiom here is `current-board.test.mts`'s,
/// for the same reason it gives: what breaks these is not a wrong answer but a
/// dropped word. Every failure below compiles, type-checks, and quietly turns a
/// paid turn into a lost one.
///
/// The invariant itself — that abandoning the reader does not touch the work —
/// *is* asserted at runtime, in `event-stream.test.mts`. What cannot be
/// asserted there is that the procedures are still wired the way that test
/// assumes, which is what these hold.

const SEND = "src/server/api/routers/orchestrator.ts";

/// Each streaming door as `[file, procedure, write]`. The procedure is named
/// rather than the file taken whole because `vibes.ts` holds three of them and
/// only one streams: `start` writes a message too, and a whole-file search
/// would find that one and prove nothing about the one this is a rule about.
///
/// `write` is the line whose place in the body the second test holds. For
/// `send` it is the message write itself; for `designPage` it is the call to
/// `runVibesPage`, because the write moved inside that extraction
/// (multi-vibes-and-preview-prd §II.4) and what must stay true here is that
/// the call — and so the write — is started before the generator is handed
/// back. That the extraction really is where the row is written is
/// `conversation-doors.test.mts`'s to hold.
const DOORS: [string, string, RegExp][] = [
  [SEND, "send", /chatMessage\.create(Many)?\(/],
  ["src/server/api/routers/vibes.ts", "designPage", /runVibesPage\(/],
];

/// One procedure's source, from its own name to the start of the next. Sliced
/// rather than parsed, which is this repo's idiom for a rule about a file no
/// test can import.
function procedure(source: string, name: string) {
  const from = source.indexOf(`  ${name}: protectedProcedure`);
  assert.ok(from >= 0, `${name} is no longer a procedure in this router`);
  const rest = source.slice(from + 1);
  const to = rest.search(/\n  \w+: protectedProcedure/);
  return to >= 0 ? rest.slice(0, to) : rest;
}

for (const [path, name, write] of DOORS) {
  test(`${path} — ${name} returns a generator rather than being one`, async () => {
    /// The subtle one, and the reason it is written down. A generator's body
    /// does not run until it is *pulled*, which happens from the response-piping
    /// context — where `after()` throws because there is no request scope. The
    /// try/catch around `after` would swallow that, so the symptom is not an
    /// error: it is a turn whose lifetime was silently never extended, killed
    /// mid-round on a platform that reclaims the context when the response ends.
    ///
    /// So the resolver stays a plain `async` function that *returns* a
    /// generator, and everything that must happen inside the request — the
    /// ownership check, `after`, starting the work — happens before it is
    /// handed back.
    const body = procedure(await readSource(path), name);
    assert.doesNotMatch(
      body,
      /\.mutation\(async function\*/,
      "the resolver must return a generator, not be one — see the comment above",
    );
    assert.match(body, /return \(async function\*/, "this door no longer streams");
  });

  test(`${path} — ${name} keeps its write out of the generator`, async () => {
    /// tRPC calls `.return()` on the generator when the response is cancelled
    /// (`readableStreamFrom`'s `cancel`, verified in the installed copy), so a
    /// `chatMessage` write reached after a `yield` is a write a closed tab
    /// skips — and the tools have already filed their boards and pictures by
    /// then. The row must be written inside the promise that is started before
    /// iteration begins, which means: textually before the generator is handed
    /// back.
    const body = procedure(await readSource(path), name);
    const wrote = body.search(write);
    const handed = body.search(/return \(async function\*/);
    assert.ok(wrote >= 0, "this door no longer writes a message");
    assert.ok(
      wrote < handed,
      "the write is after the generator is handed back — a closed tab would skip it",
    );
  });
}

test("the turn's lifetime is tied to the work and never to the socket", async () => {
  const source = await readSource(SEND);
  /// `after` is what stops the platform reclaiming the context once the response
  /// ends, and the guard is `analysis-queue.ts`'s: absent a request it throws,
  /// and a lifetime that could not be extended is a turn that starts later,
  /// never one that was lost.
  assert.match(source, /after\(settled\)/);
  /// And the shape that must never appear: tRPC offers the procedure a way to
  /// hear that the client has gone, and handing it to the turn would delete the
  /// whole guarantee in one line. Matched as code rather than as the word, so
  /// the paragraph above this assertion is not itself a failure.
  assert.doesNotMatch(
    source,
    /\.signal\b|signal:\s/,
    "hearing the client leave is one line away from killing a paid turn",
  );
});
