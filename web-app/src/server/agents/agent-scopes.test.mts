import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";

const { generateImage } = await import("@/server/agents/image-generator/image-generator");
const { recordModelCall, transcriptSettled, withTranscript } = await import("@/server/agents/shared/transcript");
const { readSource } = await import("@/server/google/source-tree");

/// Stage 4: every agent's public door opens a transcript scope, and a door
/// called inside another one joins it rather than starting a second file.
///
/// The functional half is the drawing agent, which is the one door a test can
/// walk through with nothing but a fake answer behind it. It stands in for the
/// tap it cannot reach — an injected `generate` never gets as far as
/// `generateContent` — by recording from inside the agent, which is exactly
/// where the real tap records from.
///
/// The other four doors are read off the source: `runOrchestratorTurn` wants a
/// database and agent 8 wants a board, and what is worth holding about them is
/// the one line each, not a fixture that builds a project.

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

  await withTranscript("orchestrator", async () => {
    recordModelCall({ ...ROUND, model: "gemini-3.7-flash", text: "drawing it" });
    await transcriptSettled();
    return generateImage({
      description: "a wide shot of the room",
      generate: answering(() => recordModelCall(ROUND)),
    });
  });
  delete process.env.AGENT_TRANSCRIPT_DIR;

  const { stem, records } = await transcriptsIn(directory);
  /// One file, named for the outermost agent, holding both agents' rounds in
  /// the order they ran — requirement 4.
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

/// The table from the task, held as a test: a door that loses its wrapper is an
/// agent that silently stops being recorded, and no other test in the suite
/// would notice — every one of them injects `generate` and asserts a loop.
const DOORS = [
  ["src/server/agents/orchestrator/turn.ts", "runOrchestratorTurn", "orchestrator"],
  ["src/server/agents/designer/design.ts", "designPage", "designer"],
  ["src/server/agents/analyzer/analyzer.ts", "analyzeReference", "analyzer"],
  ["src/server/agents/cropper/cropper.ts", "cropReference", "cropper"],
  ["src/server/agents/image-generator/image-generator.ts", "generateImage", "image-generator"],
];

for (const [path, door, label] of DOORS) {
  test(`${door} is wrapped as "${label}"`, async () => {
    const source = await readSource(path!);
    const entry = source.slice(source.indexOf(`export function ${door}(`));

    assert.ok(entry, `${door} is no longer the exported door of ${path}`);
    assert.match(entry.slice(0, 400), new RegExp(`withTranscript\\("${label}"`));
  });
}
