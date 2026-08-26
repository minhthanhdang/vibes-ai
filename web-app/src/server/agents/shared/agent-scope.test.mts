import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { agentPath, emit, watching, withAgent, withEvents } = await import("./agent-scope");
import type { TurnEvent } from "@/lib/agent/shared/turn-events";

/// The scope, on its own. What matters here is the case every deployment is
/// actually in — nobody watching, no transcript directory — and the one the
/// feature exists for: agent 8 labelling its own rounds without agent 6 having
/// passed it anything.
///
/// `AGENT_TRANSCRIPT_DIR` is never set by any case below, deliberately. The
/// whole point of the generalisation is that the label stack works when the
/// instrument is off, and a case that switched the instrument on would be
/// asserting the thing that already worked.

const named = (events: readonly TurnEvent[]) =>
  events.map((event) => ("agent" in event ? [event.seq, event.agent, event.under] : [event.kind]));

test("emitting with nobody watching is a no-op, and the work still answers", async () => {
  /// The state `npm run smoke`, the Vibes CLI and every other test in the suite
  /// run in. It must cost a `getStore()` and a return.
  const answered = await withAgent("orchestrator", async () => {
    emit({ kind: "thinking", text: "nobody hears this" });
    assert.equal(watching(), false);
    return "answered";
  });
  assert.equal(answered, "answered");
});

test("a door reached on its own names itself, with nothing enclosing it", async () => {
  const events: TurnEvent[] = [];
  await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", async () => {
        assert.deepEqual(agentPath(), { agent: "orchestrator", under: [] });
        emit({ kind: "thinking", text: "routing" });
      }),
  );
  assert.deepEqual(named(events), [[1, "orchestrator", []]]);
});

test("a door reached from inside another labels itself under it", async () => {
  /// Agent 8 inside agent 6's `design_page` call — the case the whole scope
  /// exists for, and the one no parameter could carry across the toolset seam.
  const events: TurnEvent[] = [];
  await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", async () => {
        emit({ kind: "thinking", text: "routing" });
        await withAgent("designer", async () => {
          emit({ kind: "thinking", text: "designing" });
        });
        emit({ kind: "thinking", text: "replying" });
      }),
  );

  /// One sequence across both agents, so the events read in the order they
  /// happened whichever agent made them.
  assert.deepEqual(named(events), [
    [1, "orchestrator", []],
    [2, "designer", ["orchestrator"]],
    [3, "orchestrator", []],
  ]);
});

test("two agents inside one round each keep their own name", async () => {
  /// The copy-not-push rule, which is the bug `transcript.ts`'s comment says it
  /// already paid for once: a round runs its tools through `Promise.all`, so a
  /// shared stack would label the cropper's rounds "designer".
  const events: TurnEvent[] = [];
  await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", async () => {
        await Promise.all([
          withAgent("designer", async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            emit({ kind: "thinking", text: "designing" });
          }),
          withAgent("cropper", async () => {
            emit({ kind: "thinking", text: "cropping" });
          }),
        ]);
      }),
  );

  const labelled = events.map((event) => ("agent" in event ? [event.agent, event.under] : []));
  assert.deepEqual(labelled.sort(), [
    ["cropper", ["orchestrator"]],
    ["designer", ["orchestrator"]],
  ]);
});

test("a sink that throws does not reach the work being watched", async () => {
  /// The invariant the emit's guard is there for: a stream nobody can read must
  /// never break the turn it is streaming.
  const answered = await withEvents(
    () => {
      throw new Error("the socket is gone");
    },
    () =>
      withAgent("orchestrator", async () => {
        emit({ kind: "thinking", text: "routing" });
        emit({ kind: "called", results: [{ callId: "1.1", name: "list_references", ok: true }] });
        return "answered";
      }),
  );
  assert.equal(answered, "answered");
});

test("agentPath outside every door answers rather than throwing", async () => {
  assert.deepEqual(agentPath(), { agent: "", under: [] });
  assert.equal(watching(), false);
});

test("the sink is in scope before the door pushes the first label", async () => {
  /// `withEvents` is called by the procedure, outside the agent — so a door
  /// that emits on its very first line is already heard.
  const events: TurnEvent[] = [];
  await withEvents(
    (event) => events.push(event),
    async () => {
      assert.equal(watching(), true);
      await withAgent("analyzer", async () => emit({ kind: "delta", text: "a" }));
    },
  );
  assert.deepEqual(named(events), [[1, "analyzer", []]]);
});
