import "server-only";
import {
  GoogleGenAI,
  type ApiError,
  type CountTokensConfig,
  type GenerateContentConfig,
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
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import { env } from "@/env";

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
function isThrottle(status: number, contentType: string | null) {
  return status === 404 && !contentType?.includes("application/json");
}

/// The SDK's own default ladder, passed rather than assumed — see `client()`.
/// `vertexFetch` shares it so that the two transports left in the app do not
/// disagree about which failures are worth a second ask.
const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

const RETRY_ATTEMPTS = 5;

export async function vertexFetch(path: string, init: RequestInit & { retries?: number } = {}) {
  const { retries = 4, ...rest } = init;

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

/// One client for the process. It holds a `GoogleAuth` of its own, which is what
/// caches the access token — a client per call would mint a token per call.
let cached: GoogleGenAI | undefined;

function client() {
  const { GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: location } = env();
  cached ??= new GoogleGenAI({
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
  });
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
function isThrottledCall(error: ApiError) {
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
export async function throttleRetried<T>(call: () => Promise<T>, retries = 4): Promise<T> {
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
  return throttleRetried(() =>
    client().models.generateContent({
      model,
      contents,
      config: config as GenerateContentConfig,
    }),
  );
}

/// What an instruction or a tool table costs before a word of conversation is
/// added to it — the prompt floor `scripts/floor.mts` measures. Positional for
/// `generateContent`'s reason, and one more call the SDK owns rather than a
/// hand-rolled `:countTokens` POST.
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

export function textOf(parts: GeneratePart[]) {
  return parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
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
