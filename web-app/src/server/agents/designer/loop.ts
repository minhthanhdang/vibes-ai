import "server-only";
import {
  MODELS,
  functionCallsIn,
  generateContentStream,
  textOf,
  type Content,
  type GeneratePart,
} from "@/server/google/vertex";
import { emit, watchedBy } from "@/server/agents/shared/agent-scope";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { NO_USAGE, addUsage, usageOf, type TokenUsage } from "@/lib/agent/shared/model-cost";
import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/shared/model-finish";
import { toolWindow } from "@/lib/agent/shared/tool-window";
import { pictureWindow } from "@/lib/agent/designer/picture-window";
import { designerInstruction } from "@/server/agents/designer/instruction";

export const DESIGNER_ROUND_LIMIT = 12;

export const DESIGNER_PICTURE_LIMIT = 8;

export const SKILL_TOOL = "get_skills";

export const DESIGNER_STUCK_LINE =
  "I ran out of steps before I could finish. What I placed is on the page and nothing was undone — read the page and tell the user what is there, and that it may want another pass.";

export const DESIGNER_CLOSING_ASK =
  "[This design is over — nothing further will be placed, and no tool is offered on this turn. Say in one or two sentences what you put on the page and what it still wants. This is the whole of what the user is told about it, so describe the page rather than the work you did on it.]";

export const DESIGNER_ROUNDS_WARNED = 3;

export function roundsLeftSaid(left: number): string {
  if (left <= 0) {
    return `[No more tool calls will run on this design: all ${DESIGNER_ROUND_LIMIT} steps are spent. Whatever you say next is the whole of what the user is told, so say what you made and what it still wants — a call here reaches nothing and is not placed.]`;
  }
  const steps = left === 1 ? "one more step" : `${left} more steps`;
  return `[You have ${steps} on this design and then no more — ${DESIGNER_ROUND_LIMIT} is all one design gets. A step is one turn however many calls you put in it, so place everything still missing in the same turn rather than one thing at a time. If the page is made, stop now and say what you made.]`;
}

export type DesignerCall = { name: string; args: Record<string, unknown> };

export type DesignerOutcome = {
  result: Record<string, unknown>;
  pictures?: GeneratePart[];
};

export type DesignerExecutor = (call: DesignerCall) => Promise<DesignerOutcome>;

export function pictureCeilingSaid(name: string | undefined, refused: number): string {
  const which = name ? `${name} returned` : "an earlier call returned";
  const more = refused === 1 ? "" : ` (${refused} pictures so far this call)`;
  return `[The picture ${which} is not shown: this design has already looked at ${DESIGNER_PICTURE_LIMIT} pictures, which is all one may${more}. The answer's words are all of it. Work from what you have already seen, and say plainly in your closing line if you had to place something you could not look at.]`;
}

type Round = { call: Content; result: Content; pinned: boolean };

export function designerRequest(ask: Content, rounds: readonly Round[]) {
  const pinned = rounds.filter((round) => round.pinned);
  const rest = rounds.filter((round) => !round.pinned);

  const windowed = toolWindow([ask, ...rest.flatMap(({ call, result }) => [call, result])]);
  const [head, ...kept] = windowed.contents;
  const pictures = pictureWindow([
    head!,
    ...pinned.flatMap(({ call, result }) => [call, result]),
    ...kept,
  ]);

  return {
    contents: pictures.contents,
    roundsDropped: windowed.dropped,
    picturesDropped: pictures.dropped,
  };
}

export function closingRequest(ask: Content, rounds: readonly Round[]): Content[] {
  const { contents } = designerRequest(ask, rounds);
  return [...contents, { role: "user", parts: [{ text: DESIGNER_CLOSING_ASK }] }];
}

export type DesignerAnswer = {
  line: string;
  calls: DesignerCall[];
  model: string;
  usage: TokenUsage;
  rounds: number;
  roundsDropped: number;
  modelCalls: number;
  pictures: number;
  picturesDropped: number;
  picturesRefused: number;
  finish?: string;
  stopped?: "rounds";
};

export async function runDesigner({
  ask,
  instruction = designerInstruction(),
  tools = [],
  execute,
  generate = generateContentStream,
}: {
  ask: string;
  instruction?: string;
  tools?: ToolDeclaration[];
  execute?: DesignerExecutor;
  generate?: typeof generateContentStream;
}): Promise<DesignerAnswer> {
  const askContent: Content = { role: "user", parts: [{ text: ask }] };
  const rounds: Round[] = [];
  const calls: DesignerCall[] = [];

  let usage = NO_USAGE;
  let modelCalls = 0;
  let roundsDropped = 0;
  let picturesDropped = 0;
  let pictures = 0;
  let picturesRefused = 0;
  let retried = false;

  for (;;) {
    const sent = designerRequest(askContent, rounds);
    roundsDropped = sent.roundsDropped;
    picturesDropped = sent.picturesDropped;
    modelCalls += 1;

    const response = await generate(
      MODELS.FLASH,
      sent.contents,
      {
        systemInstruction: instruction,
        ...(tools.length && { tools: [{ functionDeclarations: tools }] }),
        thinkingConfig: { includeThoughts: true },
      },
      watchedBy(),
    );

    usage = addUsage(usage, usageOf(response));

    const finish = finishReasonOf(response);
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const requested = functionCallsIn(parts);
    const text = textOf(parts);

    const spent = rounds.length >= DESIGNER_ROUND_LIMIT;

    if (!execute || !requested.length || spent) {
      if (!text && !requested.length && retryableEmpty(finish) && !retried) {
        retried = true;
        continue;
      }

      const exhausted = spent && requested.length > 0;

      let line = text;
      if (!line) {
        const closing = await generate(MODELS.FLASH, closingRequest(askContent, rounds), {
          systemInstruction: instruction,
        });
        usage = addUsage(usage, usageOf(closing));
        modelCalls += 1;
        line = textOf(closing.candidates?.[0]?.content?.parts ?? []);
      }

      return {
        line: line || (exhausted ? DESIGNER_STUCK_LINE : emptyReply(finish)),
        calls,
        model: MODELS.FLASH,
        usage,
        rounds: rounds.length,
        roundsDropped,
        modelCalls,
        pictures,
        picturesDropped,
        picturesRefused,
        ...(finish && { finish }),
        ...(exhausted && { stopped: "rounds" as const }),
      };
    }

    const run = execute;

    emit({
      kind: "calling",
      calls: requested.map(({ name, args = {} }, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name,
        args,
      })),
    });

    const outcomes = await Promise.all(
      requested.map(async ({ name, args = {} }) => {
        calls.push({ name, args });
        return { name, outcome: await runSafely(run, { name, args }) };
      }),
    );

    emit({
      kind: "called",
      results: outcomes.map(({ name, outcome }, at) => ({
        callId: `${modelCalls}.${at + 1}`,
        name,
        ok: !("error" in outcome.result),
      })),
    });

    const answers: GeneratePart[] = [];

    const left = DESIGNER_ROUND_LIMIT - (rounds.length + 1);
    if (left <= DESIGNER_ROUNDS_WARNED) answers.push({ text: roundsLeftSaid(left) });

    for (const { name, outcome } of outcomes) {
      for (const picture of outcome.pictures ?? []) {
        if (pictures >= DESIGNER_PICTURE_LIMIT) {
          picturesRefused += 1;
          answers.push({ text: pictureCeilingSaid(name, picturesRefused) });
          continue;
        }
        pictures += 1;
        answers.push(picture);
      }
      answers.push({ functionResponse: { name, response: outcome.result } });
    }

    rounds.push({
      call: { role: "model", parts },
      result: { role: "user", parts: answers },
      pinned: outcomes.some(({ name }) => name === SKILL_TOOL),
    });
  }
}

async function runSafely(execute: DesignerExecutor, call: DesignerCall): Promise<DesignerOutcome> {
  try {
    return await execute(call);
  } catch (cause) {
    return { result: { error: cause instanceof Error ? cause.message : String(cause) } };
  }
}
