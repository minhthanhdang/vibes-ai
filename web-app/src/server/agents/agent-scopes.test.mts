import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";

const { generateImage } = await import("@/server/agents/image-generator/image-generator");
const { recordModelCall, transcriptSettled } = await import("@/server/agents/shared/transcript");
const { withAgent } = await import("@/server/agents/shared/agent-scope");
const { readSource } = await import("@/server/google/source-tree");

const answering = (record: () => void) =>
  (async () => {
    record();
    await transcriptSettled();
    return {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("png").toString("base64") } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    };
  }) as never;

const ROUND = {
  model: "gemini-3-pro-image",
  ms: 12,
  declarations: [],
  contents: [{ role: "user", parts: [{ text: "a wide shot of the room" }] }],
  thinking: [],
  text: "drawn",
  calls: [],
};

async function transcriptsIn(directory: string) {
  const [file] = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  assert.ok(file, "no transcript was written");
  const written = await readFile(join(directory, file), "utf8");
  return {
    stem: file.replace(/\.jsonl$/, ""),
    records: written.split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test("a door reached on its own opens the turn, and the turn is named after it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scopes-"));
  process.env.AGENT_TRANSCRIPT_DIR = directory;

  await generateImage({
    description: "a wide shot of the room",
    generate: answering(() => recordModelCall(ROUND)),
  });
  delete process.env.AGENT_TRANSCRIPT_DIR;

  const { stem, records } = await transcriptsIn(directory);
  assert.match(stem, /_image-generator_/);
  assert.equal(records.length, 1);
  assert.equal(records[0].agent, "image-generator");
  assert.deepEqual(records[0].under, []);
});

test("a door reached from inside a turn writes into that turn's file, under it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scopes-"));
  process.env.AGENT_TRANSCRIPT_DIR = directory;

  await withAgent("orchestrator", async () => {
    recordModelCall({ ...ROUND, model: "gemini-3.7-flash", text: "drawing it" });
    await transcriptSettled();
    return generateImage({
      description: "a wide shot of the room",
      generate: answering(() => recordModelCall(ROUND)),
    });
  });
  delete process.env.AGENT_TRANSCRIPT_DIR;

  const { stem, records } = await transcriptsIn(directory);
  assert.match(stem, /_orchestrator_/);
  assert.deepEqual(
    records.map((record: { seq: number; agent: string; under: string[] }) => [
      record.seq,
      record.agent,
      record.under,
    ]),
    [
      [1, "orchestrator", []],
      [2, "image-generator", ["orchestrator"]],
    ],
  );
});

const DOORS = [
  ["src/server/agents/orchestrator/turn.ts", "runOrchestratorTurn", "orchestrator"],
  ["src/server/agents/designer/design.ts", "designPage", "designer"],
  ["src/server/agents/analyzer/analyzer.ts", "analyzeReference", "analyzer"],
  ["src/server/agents/image-editor/image-editor.ts", "editReference", "image-editor"],
  ["src/server/agents/image-generator/image-generator.ts", "generateImage", "image-generator"],
];

for (const [path, door, label] of DOORS) {
  test(`${door} is wrapped as "${label}"`, async () => {
    const source = await readSource(path!);
    const entry = source.slice(source.indexOf(`export function ${door}(`));

    assert.ok(entry, `${door} is no longer the exported door of ${path}`);
    assert.match(entry.slice(0, 400), new RegExp(`withAgent\\("${label}"`));
  });
}
