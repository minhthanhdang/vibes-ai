import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContent,
  textOf,
  type Content,
  type GeneratePart,
} from "@/server/google/vertex";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { retryableEmpty, finishReasonOf } from "@/lib/agent/shared/model-finish";
import { pictureWindow } from "@/lib/agent/designer/picture-window";
import { sameEditAnswer, type EditOp } from "@/lib/edit/edit-ops";
import type { EditorToolset } from "@/server/agents/image-editor/toolset";

export const EDITOR_ROUND_LIMIT = 4;

export const EDITOR_PICTURE_LIMIT = 4;

export const EDITOR_ROUNDS_WARNED = 1;

export const EDITOR_CLOSING_ASK =
  "[This edit is over — nothing further will be applied and no tool is offered on this turn. Say what the picture you have made is: intent, what the edit leaves the user with in a handful of words, which is the label it is filed under rather than a sentence; and rationale, one line on why these were the edits, speaking plainly about the picture.]";

export const EDITOR_NOTHING_ASK =
  "[You called nothing, so nothing has been done to this picture and there is no version to file. Make the edits the user asked for now — the crop first if it is to be cut — or say plainly that there is nothing here to do.]";

export const EDITOR_PICTURE_CEILING_SAID = `[The picture this turn made is not shown: this edit has already looked at ${EDITOR_PICTURE_LIMIT} pictures, which is all one gets. Work from what you have already seen and from what the calls answered, and say in your closing line if you had to leave something you could not look at.]`;

export function editorRoundsLeftSaid(left: number): string {
  if (left <= 0) {
    return `[No more edits will be applied to this picture: all ${EDITOR_ROUND_LIMIT} steps are spent. What is on it now is what gets filed, and a call here reaches nothing — say what you made of it.]`;
  }
  const steps = left === 1 ? "one more step" : `${left} more steps`;
  return `[You have ${steps} on this picture and then no more. A step is one turn however many calls you put in it, so make every edit you can see the need for in the same turn and look once, rather than one call at a time.]`;
}

const CLOSING_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    rationale: { type: "STRING" },
  },
  required: ["intent", "rationale"],
  propertyOrdering: ["intent", "rationale"],
};

export type EditorCall = { name: string; args: Record<string, unknown> };

export type EditorOutcome = { result: Record<string, unknown>; pictures?: GeneratePart[] };

export type ImageEditorRun = {
  ops: EditOp[];
  intent: string;
  rationale: string;
  rounds: number;
  pictures: number;
  picturesDropped: number;
  modelCalls: number;
  usage: TokenUsage;
  fault?: string;
  finish?: string;
  stopped?: "rounds" | "repeat";
};

export async function runImageEditor({
  ask,
  instruction,
  toolset,
  generate = generateContent,
}: {
  ask: Content;
  instruction: string;
  toolset: EditorToolset;
  generate?: typeof generateContent;
}): Promise<ImageEditorRun> {
  const contents: Content[] = [ask];
  const asking = {
    systemInstruction: instruction,
    tools: [{ functionDeclarations: toolset.declarations }],
    temperature: 0.2,
  };

  const refused: EditorCall[] = [];

  let usage = NO_USAGE;
  let modelCalls = 0;
  let rounds = 0;
  let pictures = 0;
  let picturesDropped = 0;
  let fault: string | undefined;
  let finish: string | undefined;
  let stopped: "rounds" | "repeat" | undefined;
  let retried = false;
  let nudged = false;
  let said = "";

  for (;;) {
    const sent = pictureWindow(contents);
    picturesDropped = sent.dropped;
    modelCalls += 1;

    const response = await generate(MODELS.FLASH, sent.contents, asking);
    usage = addUsage(usage, usageOf(response));
    finish = finishReasonOf(response);

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);

    if (!requested.length) {
      said = textOf(parts);
      if (!said && retryableEmpty(finish) && !retried) {
        retried = true;
        continue;
      }
      if (!toolset.ops().length && !nudged && parts.length) {
        nudged = true;
        contents.push(
          { role: "model", parts },
          { role: "user", parts: [{ text: EDITOR_NOTHING_ASK }] },
        );
        continue;
      }
      if (parts.length) contents.push({ role: "model", parts });
      break;
    }

    const answers: GeneratePart[] = [];
    const left = EDITOR_ROUND_LIMIT - (rounds + 1);
    if (left <= EDITOR_ROUNDS_WARNED) answers.push({ text: editorRoundsLeftSaid(left) });

    const outcomes: { call: EditorCall; outcome: EditorOutcome }[] = [];
    for (const { name, args = {} } of requested) {
      const call = { name, args };
      outcomes.push({ call, outcome: await runSafely(toolset, call) });
    }

    const changed = outcomes.some(({ outcome }) => !("error" in outcome.result));
    const shown = changed ? await toolset.preview() : null;

    for (const [at, { call, outcome }] of outcomes.entries()) {
      if (shown && at === outcomes.length - 1) {
        if (pictures >= EDITOR_PICTURE_LIMIT) answers.push({ text: EDITOR_PICTURE_CEILING_SAID });
        else {
          pictures += 1;
          answers.push(shown);
        }
      }
      answers.push({ functionResponse: { name: call.name, response: outcome.result } });
    }

    contents.push({ role: "model", parts }, { role: "user", parts: answers });
    rounds += 1;

    const errors = outcomes.filter(({ outcome }) => "error" in outcome.result);
    fault = errorOf(errors.at(-1)?.outcome) ?? fault;

    if (errors.length === outcomes.length) {
      const asked = errors.map(({ call }) => call);
      if (asked.every((call) => refused.some((before) => sameEditAnswer(call, before)))) {
        stopped = "repeat";
        break;
      }
      refused.push(...asked);
    }

    if (rounds >= EDITOR_ROUND_LIMIT) {
      stopped = "rounds";
      break;
    }
  }

  const ops = toolset.ops();
  const nothing = { ops, intent: "", rationale: "" };
  const spent = { rounds, pictures, picturesDropped, usage, fault, finish, stopped };

  if (!ops.length) return { ...nothing, ...spent, modelCalls };

  const already = labelsIn(said);
  if (already) return { ops, ...already, ...spent, modelCalls };

  modelCalls += 1;
  const closing = await generate(
    MODELS.FLASH,
    [...pictureWindow(contents).contents, { role: "user", parts: [{ text: EDITOR_CLOSING_ASK }] }],
    {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      responseSchema: CLOSING_SCHEMA,
      temperature: 0.2,
    },
  );
  usage = addUsage(usage, usageOf(closing));

  const closed = closingSaid(textOf(closing.candidates?.[0]?.content?.parts ?? []));
  return { ops, ...closed, ...spent, usage, modelCalls };
}

async function runSafely(toolset: EditorToolset, call: EditorCall): Promise<EditorOutcome> {
  try {
    return await toolset.execute(call);
  } catch (cause) {
    return { result: { error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

function errorOf(outcome: EditorOutcome | undefined): string | undefined {
  const said = outcome?.result.error;
  return typeof said === "string" ? said : undefined;
}

function closingSaid(text: string): { intent: string; rationale: string } {
  return labelsIn(text) ?? { intent: "", rationale: text };
}

const LABELS_SAID = /\**\s*intent\s*\**\s*:\s*(.+?)\s*\n+\s*\**\s*rationale\s*\**\s*:\s*([\s\S]+)/i;

const unmarked = (said: string) => said.replace(/^\*+/, "").replace(/\*+$/, "").trim();

function labelsIn(text: string): { intent: string; rationale: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const said = JSON.parse(trimmed) as { intent?: unknown; rationale?: unknown };
    if (typeof said.intent === "string" && typeof said.rationale === "string") {
      return { intent: said.intent.trim(), rationale: said.rationale.trim() };
    }
  } catch {
    const written = LABELS_SAID.exec(trimmed);
    if (written) return { intent: unmarked(written[1]!), rationale: unmarked(written[2]!) };
  }
  return null;
}
