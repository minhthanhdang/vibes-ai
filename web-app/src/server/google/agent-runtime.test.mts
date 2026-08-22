import { test } from "node:test";
import assert from "node:assert/strict";

/// The one surface that stayed on REST (tech-spec §VII "What stays on REST").
/// `AGENT_ENGINE_RESOURCE` is unset in every environment this app has ever run
/// in, so nothing here has ever executed outside a deploy that has not happened
/// — which is exactly why it was the least-defended module left: six mutations
/// were verified to leave all 1,982 other cases green. Either `class_method`
/// renamed, the `:query` verb renamed, `alt=sse` dropped, the `data:` prefix
/// left on the line before it is parsed, blank lines parsed as events, and the
/// resource guard deleted entirely.
///
/// What made them unassertable was not that the calls are remote — it is that
/// the transport was imported rather than passed. It is passed now, and the
/// cases below read the request this module assembles and hand back the answer
/// an Agent Engine would.
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AGENT_ENGINE_RESOURCE = "projects/1/locations/global/reasoningEngines/9";

const { query, streamQuery } = await import("@/server/google/agent-runtime");

type Sent = { path: string; init?: RequestInit & { retries?: number } };

function answering(response: Response) {
  const sent: Sent[] = [];
  const send = async (path: string, init?: RequestInit & { retries?: number }) => {
    sent.push({ path, init });
    return response;
  };
  return { sent, send };
}

const bodyOf = (call: Sent) => JSON.parse(String(call.init?.body)) as Record<string, unknown>;

/// Enqueued but deliberately not closed, so a consumer that stops early leaves
/// the stream open and `cancel` is a fact about the generator rather than about
/// the end of the data.
function streaming(chunks: string[]) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, wasCancelled: () => cancelled };
}

const closed = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );

async function collect(events: AsyncIterable<unknown>) {
  const seen: unknown[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

test("a call with no engine deployed fails before a request goes out, not at the far end", async () => {
  /// The guard is the whole difference between a readable "deploy the
  /// orchestrator first" and a POST to the literal path `undefined:query`,
  /// which is a 404 the throttle ladder would then ask four more times.
  const was = process.env.AGENT_ENGINE_RESOURCE;
  delete process.env.AGENT_ENGINE_RESOURCE;
  const { sent, send } = answering(Response.json({}));
  try {
    await assert.rejects(query({ agent: "AGENT_1" }, send), /AGENT_ENGINE_RESOURCE/);
    assert.equal(sent.length, 0);
  } finally {
    process.env.AGENT_ENGINE_RESOURCE = was;
  }
});

test("a blocking call names the resource's `:query` verb and asks for `query`", async () => {
  const { sent, send } = answering(Response.json({ output: { picked: 3 } }));

  const answer = await query({ agent: "AGENT_1", brief: "chairs" }, send);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.path, `${process.env.AGENT_ENGINE_RESOURCE}:query`);
  assert.equal(sent[0]!.init?.method, "POST");
  /// `class_method` is the deployed agent's own method name and is not the URL
  /// verb repeated: the resource takes `:query`, the payload takes `query`, and
  /// the stream below takes `:streamQuery` with `stream_query`. Renaming either
  /// half of either pair is a request the engine rejects.
  assert.deepEqual(bodyOf(sent[0]!), {
    class_method: "query",
    input: { agent: "AGENT_1", brief: "chairs" },
  });
  assert.deepEqual(answer, { output: { picked: 3 } });
});

test("a streamed call asks for SSE, because the default response shape is not lines", async () => {
  const { sent, send } = answering(closed(['data: {"text":"one"}\n']));

  await collect(streamQuery({ agent: "AGENT_1" }, send));

  assert.equal(sent[0]!.path, `${process.env.AGENT_ENGINE_RESOURCE}:streamQuery?alt=sse`);
  assert.deepEqual(bodyOf(sent[0]!), { class_method: "stream_query", input: { agent: "AGENT_1" } });
});

test("the `data:` prefix comes off, so an event is the agent's payload and not a frame", async () => {
  const { send } = answering(closed(['data: {"event":1}\n', 'data:{"event":2}\n', '{"event":3}\n']));

  /// All three spellings are on the wire from this service: the prefix with a
  /// space, without one, and — for a non-SSE fallback — no prefix at all. A
  /// frame handed to `JSON.parse` with its prefix still on throws at the first
  /// character, which surfaces as a malformed answer from the agent rather than
  /// as the read fault it is.
  assert.deepEqual(await collect(streamQuery({}, send)), [
    { event: 1 },
    { event: 2 },
    { event: 3 },
  ]);
});

test("the blank lines that separate SSE frames are not events", async () => {
  /// Every frame ends with one, and a keep-alive is nothing but them. Yielded
  /// rather than skipped they are a `JSON.parse("")` — one dead stream per idle
  /// agent, thrown from inside the consumer's `for await`.
  const { send } = answering(closed(['data: {"a":1}\n', "\n", "\n", 'data: {"b":2}\n', "\n"]));

  assert.deepEqual(await collect(streamQuery({}, send)), [{ a: 1 }, { b: 2 }]);
});

test("an event split across two reads is one event, because a chunk is not a line", async () => {
  const { send } = answering(closed(['data: {"half"', ':"one"}\n', 'data: {"two":2}\n']));

  assert.deepEqual(await collect(streamQuery({}, send)), [{ half: "one" }, { two: 2 }]);
});

test("a consumer that stops early releases the response body it stopped reading", async () => {
  /// The generator holds a locked reader on an open body. A caller that takes
  /// the first event and breaks returns the generator here, and only its own
  /// cleanup can close the connection — the caller has no handle on the reader
  /// to close it with.
  const { body, wasCancelled } = streaming(['data: {"first":true}\n', 'data: {"second":true}\n']);
  const { send } = answering(new Response(body));

  for await (const event of streamQuery({}, send)) {
    assert.deepEqual(event, { first: true });
    break;
  }

  assert.equal(wasCancelled(), true);
});
