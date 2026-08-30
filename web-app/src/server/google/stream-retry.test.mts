import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";

import {
  VertexError,
  streamRetried,
  type GenerateChunk,
  type GeneratePart,
} from "@/server/google/vertex";

const quota429 = () =>
  new ApiError({
    message: JSON.stringify({
      error: {
        code: 429,
        message:
          "got status: RESOURCE_EXHAUSTED. Quota exceeded for generate_content_requests_per_minute_per_project_per_base_model.",
        status: "RESOURCE_EXHAUSTED",
      },
    }),
    status: 429,
  });

const throttled404 = () =>
  new ApiError({
    message: JSON.stringify({
      error: {
        message: "<!DOCTYPE html>\n<html lang=en>\n<title>Error 404 (Not Found)!!1</title>\n",
        code: 404,
        status: "Not Found",
      },
    }),
    status: 404,
  });

const badRequest400 = () =>
  new ApiError({
    message: JSON.stringify({ error: { code: 400, message: "Invalid JSON" } }),
    status: 400,
  });

const chunkOf = (text: string): GenerateChunk => ({
  candidates: [{ content: { parts: [{ text }] } }],
});

const usageOnly = (): GenerateChunk => ({ usageMetadata: { totalTokenCount: 5 } });

async function* yielding(chunks: GenerateChunk[]): AsyncGenerator<GenerateChunk> {
  yield* chunks;
}

async function* yieldingThenThrowing(
  chunks: GenerateChunk[],
  error: unknown,
): AsyncGenerator<GenerateChunk> {
  yield* chunks;
  throw error;
}

const connecting = (streams: AsyncIterable<GenerateChunk>[]) => {
  let calls = 0;
  const connect = async () => {
    const stream = streams[calls++];
    assert.ok(stream, "connected more times than streams were provided");
    return stream;
  };
  return { connect, calls: () => calls };
};

const watching = () => {
  const told: GeneratePart[][] = [];
  return { told, watch: { chunk: (parts: GeneratePart[]) => void told.push(parts) } };
};

async function instantly<T>(run: () => Promise<T>): Promise<T> {
  const slept = globalThis.setTimeout;
  globalThis.setTimeout = ((wake: () => void) => slept(wake, 0)) as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = slept;
  }
}

test("a 429 before any chunk reconnects, and only the winning attempt reaches the watcher", async () => {
  const { connect, calls } = connecting([
    yieldingThenThrowing([], quota429()),
    yielding([chunkOf("hello"), chunkOf(" world")]),
  ]);
  const { told, watch } = watching();

  const chunks = await instantly(() => streamRetried(connect, watch, 1));

  assert.equal(chunks.length, 2);
  assert.equal(calls(), 2);
  assert.equal(told.length, 2);
  assert.equal(told[0]?.[0]?.text, "hello");
});

test("a throttling HTML 404 thrown mid-stream is asked again like any other throttle", async () => {
  const { connect, calls } = connecting([
    yieldingThenThrowing([], throttled404()),
    yielding([chunkOf("answered")]),
  ]);

  const chunks = await instantly(() => streamRetried(connect, { chunk: () => {} }, 1));

  assert.equal(chunks.length, 1);
  assert.equal(calls(), 2);
});

test("once text has reached the watcher a 429 is terminal, because a replay would repeat it", async () => {
  const thrown = quota429();
  const { connect, calls } = connecting([yieldingThenThrowing([chunkOf("streamed")], thrown)]);
  const { told, watch } = watching();

  await assert.rejects(streamRetried(connect, watch, 1), (error: unknown) => {
    assert.equal(error, thrown);
    return true;
  });
  assert.equal(calls(), 1);
  assert.equal(told.length, 1);
});

test("a VertexError already spent its own budget, and anything else is not ours to retry", async () => {
  for (const thrown of [new VertexError(429, "quota", true), new TypeError("fetch failed")]) {
    const { connect, calls } = connecting([yieldingThenThrowing([], thrown)]);

    await assert.rejects(streamRetried(connect, { chunk: () => {} }, 1), (error: unknown) => {
      assert.equal(error, thrown);
      return true;
    });
    assert.equal(calls(), 1);
  }
});

test("a 400 before any chunk is a bad request, not a busy service, and is not asked again", async () => {
  const thrown = badRequest400();
  const { connect, calls } = connecting([yieldingThenThrowing([], thrown)]);

  await assert.rejects(streamRetried(connect, { chunk: () => {} }, 1), (error: unknown) => {
    assert.equal(error, thrown);
    return true;
  });
  assert.equal(calls(), 1);
});

test("quota that never lets up rethrows the final 429 once the budget is spent", async () => {
  const last = quota429();
  const { connect, calls } = connecting([
    yieldingThenThrowing([], quota429()),
    yieldingThenThrowing([], last),
  ]);

  await assert.rejects(
    instantly(() => streamRetried(connect, { chunk: () => {} }, 1)),
    (error: unknown) => {
      assert.equal(error, last);
      return true;
    },
  );
  assert.equal(calls(), 2);
});

test("a usage-only chunk does not block the retry, and a failed attempt's chunks are dropped", async () => {
  const { connect, calls } = connecting([
    yieldingThenThrowing([usageOnly()], quota429()),
    yielding([chunkOf("fresh"), usageOnly()]),
  ]);
  const { told, watch } = watching();

  const chunks = await instantly(() => streamRetried(connect, watch, 1));

  assert.equal(calls(), 2);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.candidates?.[0]?.content?.parts?.[0]?.text, "fresh");
  assert.equal(told.length, 1);
});

test("a throwing watcher neither stops the stream nor licenses a replay of what it was handed", async () => {
  const said = console.error;
  console.error = () => {};
  try {
    const complaining = {
      chunk: () => {
        throw new Error("watcher broke");
      },
    };

    const finishing = connecting([yielding([chunkOf("one"), chunkOf("two")])]);
    const chunks = await streamRetried(finishing.connect, complaining, 1);
    assert.equal(chunks.length, 2);

    const thrown = quota429();
    const dying = connecting([yieldingThenThrowing([chunkOf("one")], thrown)]);
    await assert.rejects(streamRetried(dying.connect, complaining, 1), (error: unknown) => {
      assert.equal(error, thrown);
      return true;
    });
    assert.equal(dying.calls(), 1);
  } finally {
    console.error = said;
  }
});
