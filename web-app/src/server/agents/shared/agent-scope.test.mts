import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { agentPath, emit, watching, withAgent, withEvents } = await import("./agent-scope");
import type { TurnEvent } from "@/lib/agent/shared/turn-events";

const named = (events: readonly TurnEvent[]) =>
  events.map((event) => ("agent" in event ? [event.seq, event.agent, event.under] : [event.kind]));

test("emitting with nobody watching is a no-op, and the work still answers", async () => {
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

  assert.deepEqual(named(events), [
    [1, "orchestrator", []],
    [2, "designer", ["orchestrator"]],
    [3, "orchestrator", []],
  ]);
});

test("two agents inside one round each keep their own name", async () => {
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
