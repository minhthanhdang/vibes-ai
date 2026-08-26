import "server-only";
import {
  GoogleGenAI,
  type ApiError,
  type CountTokensConfig,
  type GenerateContentConfig,
  type GoogleGenAIOptions,
  type Part,
} from "@google/genai";
import { accessToken, googleAuthOptions } from "./auth";
/// The declared shape of a tool, imported rather than restated. It is not the
/// SDK's `FunctionDeclaration` — that types `parameters` as its own enum-keyed
/// `Schema`, and every declaration in `agent-tools.ts` is plain JSON Schema
/// written with string literals, a vocabulary the wire takes and that enum does
/// not. So the structural type stays and the cast is made once, in
/// `generateContent` below. It is declared over there because that module is
/// loaded in the browser too and cannot reach this `server-only` one; a type
/// import in this direction is erased and costs nothing.
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { env } from "@/env";
import { usageOf } from "@/lib/agent/shared/model-cost";
import { redactedContents, type TranscriptRecord } from "@/lib/agent/shared/transcript";
import { recordModelCall, transcribing } from "@/server/agents/shared/transcript";

/// Single point of indirection: PRO is a preview id and may be renamed.
/// tech-spec §II, verified live on `global` in infra.md §X.
///
/// Every text and vision agent calls `FLASH`. That is the eligibility floor
/// (§I: 3.5 or newer) and not a price decision — `PRO` is 3.1, so no amount of
/// reasoning quality would buy it back. `PRO` stays declared and stays priced in
/// `MODEL_PRICES` because it is the fallback for a read that measurably degrades
/// on flash, one agent at a time (§II); a constant deleted here is a fallback
/// that has to be re-derived under a bad board.
export const MODELS = {
  PRO: "gemini-3.1-pro-preview",
  FLASH: "gemini-3.7-flash",
  IMAGE: "gemini-3-pro-image",
} as const;

/// Still here for `vertexFetch` alone. The SDK below computes the same host from
/// the same rule — `global` is served from the unprefixed domain and every
/// region from its own — so the model calls no longer need this; Agent Runtime,
/// which the SDK has no surface for, still does.
export function apiHost() {
  const location = env().GOOGLE_CLOUD_LOCATION;
  return location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
}

/// `retryable` says the backoff below was exhausted rather than that a retry is
/// still owed, which is what lets a caller tell "the service was busy" from
/// "the request was wrong" when it writes a sentence about the failure.
/// Exported so the callers that do can be tested against the real thing.
export class VertexError extends Error {
  constructor(readonly status: number, readonly body: string, readonly retryable: boolean) {
    super(`vertex ${status}${retryable ? " (retryable)" : ""}: ${body.slice(0, 300)}`);
  }
}

/// Burst throttling comes back as an HTML 404 page rather than a JSON error,
/// for every model including working ones (infra.md §X). A genuine missing
/// model returns JSON. Distinguish on content type, not status.
///
/// Exported beside `isThrottledCall` below, which decides the same fact for the
/// SDK transport off the body text because no header reaches it: two readings
/// of one signal, and the test that holds them requires the two to answer the
/// same 404 the same way.
export function isThrottle(status: number, contentType: string | null) {
  return status === 404 && !contentType?.includes("application/json");
}

/// The SDK's own default ladder, passed rather than assumed — see
/// `clientOptions()`. `vertexFetch` shares it so that the two transports left in
/// the app do not disagree about which failures are worth a second ask.
///
/// 404 is deliberately absent and both transports add it back only for a
/// throttling body, never for the status alone.
export const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

export const RETRY_ATTEMPTS = 5;

/// How many times either transport asks again after a throttling 404, which is
/// the one failure the SDK's ladder above does not cover. Named rather than
/// written twice because the two loops have to agree: `image-generator.ts` tells
/// the user the drawing service is "busy" on the strength of this number, and a
/// default that drifted on one transport would make that sentence true of one
/// model call and false of the next.
export const THROTTLE_RETRIES = 4;

export async function vertexFetch(path: string, init: RequestInit & { retries?: number } = {}) {
  const { retries = THROTTLE_RETRIES, ...rest } = init;

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${apiHost()}/v1/${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        ...rest.headers,
      },
    });

    if (response.ok) return response;

    const contentType = response.headers.get("content-type");
    const retryable =
      RETRYABLE_STATUSES.includes(response.status) || isThrottle(response.status, contentType);
    if (!retryable || attempt >= retries) {
      throw new VertexError(response.status, await response.text(), retryable);
    }

    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
  }
}

/// What the client is built from, named apart from the client it builds: a
/// `GoogleGenAI` gives no reading of the options it was handed, so a ladder
/// written straight into the constructor call is a policy nothing can ask
/// about. Built fresh each call and cached only through `client()` below.
export function clientOptions(): GoogleGenAIOptions {
  const { GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: location } = env();
  return {
    /// `enterprise`, not `vertexai`: the same flag under the platform's current
    /// name (infra.md §XI) and the one the SDK asks for. Passing both with
    /// different values throws.
    enterprise: true,
    project,
    location,
    /// The inline service-account key rather than ambient ADC. infra.md §VI:
    /// Vercel has no metadata server, so a client left to find its own
    /// credentials finds none.
    googleAuthOptions: googleAuthOptions(),
    /// Retries are opt-in. Absent this object the SDK hands back the first
    /// response whatever it says — the documented ladder (5 attempts, 1s
    /// initial, 60s cap, base 2, jitter) applies only once it is passed, so
    /// leaving it out buys no backoff rather than the defaults.
    httpOptions: {
      retryOptions: { attempts: RETRY_ATTEMPTS, httpStatusCodes: RETRYABLE_STATUSES },
    },
  };
}

/// One client for the process. It holds a `GoogleAuth` of its own, which is what
/// caches the access token — a client per call would mint a token per call.
let cached: GoogleGenAI | undefined;

/// Exported for the test that holds the caching, `clientOptions()`'s reason: a
/// singleton nothing can ask about is a policy nobody keeps. Nothing outside
/// this file calls it — `generateContent` and `countTokens` below are its two
/// callers, and they are what the rest of the app reaches the model through.
export function client() {
  cached ??= new GoogleGenAI(clientOptions());
  return cached;
}

/// What a non-JSON error body says. The SDK reads the body before we see it and
/// re-wraps anything that is not JSON as `{"error":{"message":"<the raw
/// text>",…}}`, so the throttling HTML survives — it is just read off a string
/// now instead of off a `content-type` header.
function bodySaid(error: ApiError) {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string" ? parsed.error.message : error.message;
  } catch {
    return error.message;
  }
}

/// The 404 that means "slow down" rather than "no such model" (infra.md §X).
/// Deliberately not added to the ladder above: a genuine missing model answers
/// with JSON, and blanket-retrying 404 would turn a configuration error into
/// four wasted calls and a slower failure.
///
/// Exported for the test that puts it beside `isThrottle`: this transport reads
/// the body because the SDK has already thrown the headers away, and the two
/// readings drifting apart would give one transport a retry the other does not.
export function isThrottledCall(error: ApiError) {
  return error.status === 404 && bodySaid(error).trimStart().startsWith("<");
}

/// By name and shape rather than by `instanceof`. The SDK ships a CJS build and
/// an ESM build of the same module, and a process that has loaded both — which
/// any mix of `.ts` and `.mts` does — holds two `ApiError` classes that fail each
/// other's identity check. Both carry the two fields the retry reads.
function apiErrorOf(cause: unknown): ApiError | undefined {
  const error = cause as ApiError | undefined;
  return error instanceof Error && error.name === "ApiError" && typeof error.status === "number"
    ? error
    : undefined;
}

/// The one retry the SDK cannot be asked for, wrapped around the one it can.
/// Everything in `RETRYABLE_STATUSES` has already had its backoff by the time an
/// `ApiError` reaches here, so the loop below runs for throttling alone and the
/// `retryable` flag still means what `VertexError` says it means.
/// Exported for the test that holds the HTML/JSON line.
export async function throttleRetried<T>(
  call: () => Promise<T>,
  retries = THROTTLE_RETRIES,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (cause) {
      const error = apiErrorOf(cause);
      if (!error) throw cause;

      const throttled = isThrottledCall(error);
      if (!throttled || attempt >= retries) {
        throw new VertexError(
          error.status,
          error.message,
          throttled || RETRYABLE_STATUSES.includes(error.status),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
}

/// The SDK's `Part`: one interface with every field optional rather than a union
/// of the five shapes this app builds. `"text" in part` no longer narrows a
/// type, so a read is `part.text ?? ""` — and `thoughtSignature`, which a Gemini
/// 3 tool round has to echo back untouched, is now a field the type knows about
/// rather than something `conversation.ts`'s `wire` preserves by accident.
export type GeneratePart = Part;

export type Content = { role: "user" | "model"; parts: GeneratePart[] };

/// Flat, as the SDK takes it: what the REST body nested under `generationConfig`
/// sits at the top of `config` here.
export type GenerateConfig = {
  systemInstruction?: string;
  tools?: { functionDeclarations: ToolDeclaration[] }[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  responseModalities?: string[];
  imageConfig?: { aspectRatio?: string };
  /// Asked for on every round of agents 6 and 8: the summary is the progress
  /// label the user is shown while a round runs. It is output tokens at the
  /// output rate and `usageOf` counts it (`docs/Metering.md` §II) —
  /// `includeThoughts` buys the *sentence*, never the thinking, which happens
  /// and bills either way. `thinkingBudget`/`thinkingLevel` are the knobs that
  /// would move that, and nothing in the app sets one.
  thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string };
};

/// Read structurally rather than as the SDK's `GenerateContentResponse`, which
/// is a class with `text` and `functionCalls` getters on it. Every injected fake
/// in the suite returns a plain object shaped like this; typing the seam as the
/// class would make each of them a lie that still compiles.
export type GenerateAnswer = {
  candidates?: {
    content?: { parts?: GeneratePart[] };
    finishReason?: string;
    /// The IMAGE model's own sentence about an answer with no image in it —
    /// an image safety block arrives as a candidate with no parts and this
    /// beside it, verified live.
    finishMessage?: string;
  }[];
  /// The whole request turned away on its way in, decided on the prompt alone
  /// and so written in place of a candidate rather than beside one — the one
  /// refusal a second identical call is answered with identically.
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  /// Passed through rather than dropped: this is the only exact reading of
  /// what a call cost, and every agent below sums it onto its run row. Left
  /// untyped beyond `unknown` here so the parsing lives in one pure place
  /// (`usageOf`) that a test can reach without a server-only import.
  usageMetadata?: unknown;
};

/// Positional, in this order, and it stays that way. Four agents take this
/// function as an injected `generate` and five test files fake it under
/// `typeof generateContent`; the SDK's parameter-object call belongs on this
/// side of the seam and nowhere else.
export async function generateContent(
  model: string,
  contents: Content[],
  config: GenerateConfig = {},
): Promise<GenerateAnswer> {
  const started = Date.now();
  try {
    const answer = await throttleRetried(() =>
      client().models.generateContent({
        model,
        contents,
        config: config as GenerateContentConfig,
      }),
    );
    transcribe(model, contents, config, Date.now() - started, { answer });
    return answer;
  } catch (cause) {
    transcribe(model, contents, config, Date.now() - started, { error: String(cause) });
    throw cause;
  }
}

/// The tap, here and not at the injected `generate` seams: every agent already
/// defaults to the function above, so one tap catches all of them and catches
/// the next one for free — where wrapping at each seam would mean threading a
/// wrapper through five call chains and forgetting the sixth.
///
/// Two consequences, stated so they are not discovered later. A test that
/// injects a fake `generate` records nothing, because the fake never reaches
/// this function — correct, the suite asserts loops rather than calls, and it
/// is why `npm run smoke` is still the way to capture a real transcript. And
/// `throttleRetried` is inside the timing, so a call retried four times is one
/// record: the transcript is about the conversation, not the transport.
///
/// The guard is here rather than inside `recordModelCall` because assembling a
/// record walks every part of every content: a turn that is not being recorded
/// must not do that work.
function transcribe(
  model: string,
  contents: Content[],
  config: GenerateConfig,
  ms: number,
  outcome: TranscriptOutcome,
) {
  if (transcribing()) recordModelCall(transcribed(model, contents, config, ms, outcome));
}

export type TranscriptOutcome = { answer?: GenerateAnswer; error?: string };

/// One chunk of a streamed emission, read structurally for `GenerateAnswer`'s
/// reason: every injected fake in the suite is a plain object.
export type GenerateChunk = {
  candidates?: {
    content?: { parts?: GeneratePart[] };
    finishReason?: string;
    finishMessage?: string;
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: unknown;
};

/// The side channel a streamed call writes to as it goes. One call per chunk
/// that carried parts, with the parts exactly as they arrived — the caller
/// decides what a delta *means*, because only the caller knows whether it is
/// drawing a label or a reply.
export type GenerateWatcher = { chunk: (parts: GeneratePart[]) => void };

/// The chunks of one streamed call as the one answer they are.
///
/// The parts are concatenated verbatim and merged **never**. A merge would have
/// to decide which of two fragments keeps a `thoughtSignature`, and the API's own
/// rule is to return the parts as they arrived — so the safe assembly is the one
/// that does nothing, and it is safer than any merge rather than riskier.
/// `textOf` joins them and gets the same string a non-streamed answer gave;
/// `functionCallsIn` is unaffected, because a `functionCall` arrives whole in one
/// chunk rather than tokenised across several.
///
/// The cost is paid one layer up: a round's narration arrives as several text
/// parts, so `forStorage` merges adjacent ones into one bubble — on the stored
/// side alone, where no signature has to survive.
export function assembled(chunks: readonly GenerateChunk[]): GenerateAnswer {
  const parts: GeneratePart[] = [];
  let finishReason: string | undefined;
  let finishMessage: string | undefined;
  let promptFeedback: GenerateAnswer["promptFeedback"];

  for (const chunk of chunks) {
    const candidate = chunk.candidates?.[0];
    parts.push(...(candidate?.content?.parts ?? []));
    /// The last chunk that carried each, rather than the last chunk: a trailing
    /// chunk with nothing on it must not erase the reason the call stopped.
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (candidate?.finishMessage) finishMessage = candidate.finishMessage;
    if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback;
  }

  const usageMetadata = usageChunkOf(chunks);
  return {
    /// A stream that yielded nothing is an answer with no candidates, which is
    /// what a non-streamed empty emission already reads as: `textOf` is `""`,
    /// `finishReasonOf` is undefined, and `emptyReply` still answers.
    ...(chunks.length && {
      candidates: [
        {
          content: { parts },
          ...(finishReason && { finishReason }),
          ...(finishMessage && { finishMessage }),
        },
      ],
    }),
    ...(promptFeedback && { promptFeedback }),
    ...(usageMetadata !== undefined && { usageMetadata }),
  };
}

/// Which chunk's `usageMetadata` is the call's.
///
/// Vertex reports it cumulatively and the counts only climb, so the largest
/// total is the final reading — and reading it that way survives both a trailing
/// chunk that carries none and a build that reports it once at the end. Summing
/// would bill a five-chunk answer five times.
export function usageChunkOf(chunks: readonly { usageMetadata?: unknown }[]): unknown | undefined {
  let best: unknown;
  let most = -1;
  for (const { usageMetadata } of chunks) {
    if (usageMetadata === undefined || usageMetadata === null) continue;
    const total = Number((usageMetadata as { totalTokenCount?: unknown }).totalTokenCount ?? 0);
    if (total >= most) {
      most = total;
      best = usageMetadata;
    }
  }
  return best;
}

/// The streaming half of the seam, positional in `generateContent`'s own order
/// with the watcher last and optional.
///
/// That last detail is what makes this a widening rather than a fork: a function
/// of three parameters is assignable to a type of four, so `typeof
/// generateContent` and every `as never` fake in the suite still stand in for
/// this unchanged — and a fake that ignores the watcher and answers whole is a
/// legal stream that emitted nothing, which is the honest reading of it. One
/// code path through the round loops, because a harness that measures a copy of
/// the turn measures the copy.
///
/// **One accepted regression, stated rather than papered over.**
/// `throttleRetried` wraps the call that *returns* the generator, so a throttled
/// or unavailable response at connect is still retried five ways — but a failure
/// mid-iteration is not, and cannot be without re-issuing the call and
/// retracting text already drawn. A mid-stream failure is therefore a failed
/// turn where today it might have recovered.
export async function generateContentStream(
  model: string,
  contents: Content[],
  config: GenerateConfig = {},
  watch: GenerateWatcher = { chunk: () => {} },
): Promise<GenerateAnswer> {
  const started = Date.now();
  const chunks: GenerateChunk[] = [];
  try {
    const stream = await throttleRetried(() =>
      client().models.generateContentStream({
        model,
        contents,
        config: config as GenerateContentConfig,
      }),
    );
    for await (const chunk of stream) {
      chunks.push(chunk as GenerateChunk);
      const parts = (chunk as GenerateChunk).candidates?.[0]?.content?.parts ?? [];
      /// Guarded, for `recordModelCall`'s reason: a watcher that throws must not
      /// kill a call the project has already paid for.
      if (parts.length) {
        try {
          watch.chunk(parts);
        } catch (cause) {
          console.error("stream watcher failed:", cause);
        }
      }
    }
    const answer = assembled(chunks);
    transcribe(model, contents, config, Date.now() - started, { answer });
    return answer;
  } catch (cause) {
    transcribe(model, contents, config, Date.now() - started, { error: String(cause) });
    throw cause;
  }
}

/// What a round is worth keeping, read off the same values the call was made
/// with. Exported for its test alone: the tap above cannot be reached without
/// the SDK behind it, and this is the half of it worth asserting.
export function transcribed(
  model: string,
  contents: Content[],
  config: GenerateConfig,
  ms: number,
  { answer, error }: TranscriptOutcome,
): Omit<TranscriptRecord, "seq" | "at" | "agent" | "under"> {
  const candidate = answer?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return {
    model,
    ms,
    systemInstruction: config.systemInstruction,
    declarations: (config.tools ?? []).flatMap((tool) =>
      tool.functionDeclarations.map((declaration) => declaration.name),
    ),
    contents: redactedContents(contents),
    /// The two halves of one emission: `thoughtsOf` is why the transcript is
    /// worth reading, and `textOf` drops the same parts so the record's `text`
    /// is the sentence the user was shown.
    thinking: thoughtsOf(parts),
    text: textOf(parts),
    calls: functionCallsIn(parts).map(({ name, args }) => ({ name, args: args ?? {} })),
    finishReason: candidate?.finishReason,
    usage: answer ? usageOf(answer) : undefined,
    error,
  };
}

/// What an instruction or a tool table costs before a word of conversation is
/// added to it — the prompt floor `scripts/floor.mts` measures. Positional for
/// `generateContent`'s reason, and one more call the SDK owns rather than a
/// hand-rolled POST at the token-counting URL — which is why no file here
/// spells that URL's verb, and `sdk-boundary.test.mts` holds it that way.
export async function countTokens(
  model: string,
  contents: Content[],
  config: CountConfig = {},
): Promise<number> {
  const { totalTokens } = await throttleRetried(() =>
    client().models.countTokens({ model, contents, config: config as CountTokensConfig }),
  );
  return totalTokens ?? 0;
}

export type CountConfig = {
  systemInstruction?: string;
  tools?: { functionDeclarations: ToolDeclaration[] }[];
};

/// What the model said to whoever asked. A thought summary is a text part with
/// `thought` on it, so without the filter the model's private reasoning is
/// concatenated onto the front of the user's reply the moment `includeThoughts`
/// is asked for anywhere — in the chat, and in agent 8's closing line.
export function textOf(parts: GeneratePart[]) {
  return parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/// The other half of the same split, in the order the model wrote them: the
/// transcript's `thinking`. Empty on every call that did not ask for summaries.
export function thoughtsOf(parts: GeneratePart[]) {
  return parts.flatMap((part) => (part.thought && part.text ? [part.text] : []));
}

/// The first image of an answer. The IMAGE model interleaves text and image
/// parts, and one call asks for one picture — a second image part would be one
/// nobody asked for, so the first is the answer.
export function inlineDataOf(parts: GeneratePart[]): { mimeType: string; data: string } | null {
  for (const { inlineData } of parts) {
    /// Both fields or neither: bytes with no media type are something nothing
    /// downstream can store, and a media type with no bytes is not a picture.
    if (inlineData?.data && inlineData.mimeType) {
      return { mimeType: inlineData.mimeType, data: inlineData.data };
    }
  }
  return null;
}

/// A call this loop could actually obey. The SDK's `FunctionCall.name` is
/// optional, and a call naming no tool is an emission to preserve rather than an
/// instruction to follow — the same answer the round loop already gives a call
/// that arrived with no arguments.
export function functionCallsIn(parts: GeneratePart[]) {
  return parts.flatMap(({ functionCall }) =>
    functionCall?.name
      ? [{ name: functionCall.name, args: functionCall.args as Record<string, unknown> | undefined }]
      : [],
  );
}
