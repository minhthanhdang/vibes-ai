import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { orchestrate } = await import("@/server/agents/orchestrator/orchestrator");
const { runDesigner } = await import("./designer/loop");
const { forStorage } = await import("@/lib/agent/shared/conversation");
import type { Content, GenerateConfig } from "@/server/google/vertex";
import type { Emitted } from "@/lib/agent/shared/conversation";

/// What the two agents ask for, and where the summaries are allowed to go once
/// they arrive.
///
/// The gate is gone. It existed because a summary is output tokens on a real
/// invoice (`docs/Metering.md` §II) and nothing read them — so they were asked
/// for only while a transcript was being written. Now the user reads them: the
/// summary is the label under the live turn, replacing a `Thinking…` that stood
/// for three minutes. So the rule these first two cases pin is the opposite one,
/// and it is stronger: the request must not depend on a dev instrument at all.
///
/// Where they may go is unchanged, and is the requirement this whole feature
/// could quietly break: a summary is a text part like any other, so a turn that
/// forgot to mark it would put the model's private reasoning in the user's
/// reply, in a stored bubble, or both. The third case is untouched.

type Part =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; args: Record<string, unknown> } };

function saying(...rounds: Part[][]) {
  const sent: { contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (_model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    return {
      candidates: [{ content: { parts: rounds[sent.length - 1] ?? [] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    };
  }) as never;
  return { sent, generate };
}

const thinking = (words: string): Part => ({
  text: words,
  thought: true,
  thoughtSignature: "opaque",
});

test("both agents ask for a summary whether or not a transcript is being written", async () => {
  /// The summary is a product surface now, not a thing a dev instrument
  /// switches on — so unset and set have to be the same call.
  for (const directory of [undefined, ".transcripts"]) {
    if (directory) process.env.AGENT_TRANSCRIPT_DIR = directory;
    else delete process.env.AGENT_TRANSCRIPT_DIR;

    const turn = saying([{ text: "Tell me about the light you are after." }]);
    await orchestrate({ message: "hello", generate: turn.generate });

    const design = saying([{ text: "I put the portrait at the top." }]);
    await runDesigner({ ask: "design the welcome sign", generate: design.generate });

    assert.deepEqual(turn.sent[0]!.config.thinkingConfig, { includeThoughts: true });
    assert.deepEqual(design.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  }
  delete process.env.AGENT_TRANSCRIPT_DIR;
});

test("agent 8's closing call still does not ask, with no transcript in sight", async () => {
  /// Asserted with the variable unset on purpose: the skip is the closing call's
  /// own rule — a label for work that is not coming — and not the shadow of a
  /// gate that has been removed. A summary here would buy output tokens and a
  /// delay in front of the one sentence the user is waiting on, and there is no
  /// next round for its signature to be echoed to.
  delete process.env.AGENT_TRANSCRIPT_DIR;

  /// A round that calls a tool with no executor behind it ends the loop with no
  /// sentence, which is what buys the closing call.
  const design = saying([{ functionCall: { name: "put_on_canvas", args: {} } }], [{ text: "Done." }]);
  await runDesigner({ ask: "design the welcome sign", generate: design.generate });

  assert.deepEqual(design.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  assert.equal(design.sent.length, 2);
  assert.equal("thinkingConfig" in design.sent[1]!.config, false);
});

test("the gate is gone from the two agents, not merely left unset", async () => {
  /// An agent reading the instrument again is the gate coming back under
  /// another name, and no assertion about one turn's config would notice.
  const { TEST, filesNaming, sourceFiles } = await import("@/server/google/source-tree");
  const app = (await sourceFiles("src", "scripts")).filter((path) => !TEST.test(path));
  assert.deepEqual(await filesNaming(/\btranscribing\(/, app), [
    "src/server/agents/shared/transcript.ts",
    "src/server/google/vertex.ts",
  ]);
});

test("a summary is not the reply, is not stored, and is still sent back next round", async () => {
  const { sent, generate } = saying(
    [thinking("The brief says warm, so I should ask about the light."), { functionCall: { name: "list_references", args: {} } }],
    [thinking("Three of them, and none is a window."), { text: "Tell me about the light you are after." }],
  );
  const { reply, parts } = await orchestrate({
    message: "hello",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 3 } }),
    generate,
  });

  /// Requirement 8, the reply: `textOf` drops the thought parts, so the user is
  /// shown the sentence and never the reasoning that led to it.
  assert.equal(reply, "Tell me about the light you are after.");

  /// Requirement 8, the row: `forStorage` drops them too, so no thought becomes
  /// a bubble in the chat column.
  const stored = forStorage(parts as Emitted[]);
  assert.equal(
    stored.some((part) => part.type === "text" && part.text.includes("warm")),
    false,
  );
  assert.deepEqual(
    stored.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ["Tell me about the light you are after."],
  );

  /// And the other half of the same rule: the API rejects a later round of the
  /// turn for dropping the signature the summary arrived with, so round 2's
  /// contents carry the part exactly as it came. This is what `wire` is for.
  const carried = sent[1]!.contents.flatMap((content) =>
    content.parts.filter((part) => part.thought),
  );
  assert.deepEqual(carried, [
    { text: "The brief says warm, so I should ask about the light.", thought: true, thoughtSignature: "opaque" },
  ]);
});
