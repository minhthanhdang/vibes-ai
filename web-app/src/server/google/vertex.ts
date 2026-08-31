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
import { stagedPictures, type PictureResolver } from "./dev-staging";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { env, googleProject } from "@/env";
import { usageOf } from "@/lib/agent/shared/model-cost";
import { redactedContents, type TranscriptRecord } from "@/lib/agent/shared/transcript";
import { recordModelCall, transcribing } from "@/server/agents/shared/transcript";

export const MODELS = {
  PRO: "gemini-3.1-pro-preview",
  FLASH: "gemini-3.7-flash",
  IMAGE: "gemini-3-pro-image",
} as const;

export function apiHost() {
  const location = env().GOOGLE_CLOUD_LOCATION;
  return location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
}

export class VertexError extends Error {
  constructor(readonly status: number, readonly body: string, readonly retryable: boolean) {
    super(`vertex ${status}${retryable ? " (retryable)" : ""}: ${body.slice(0, 300)}`);
  }
}

export function isThrottle(status: number, contentType: string | null) {
  return status === 404 && !contentType?.includes("application/json");
}

export const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

export const RETRY_ATTEMPTS = 5;

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

export function clientOptions(): GoogleGenAIOptions {
  return {
    enterprise: true,
    project: googleProject(),
    location: env().GOOGLE_CLOUD_LOCATION,
    googleAuthOptions: googleAuthOptions(),
    httpOptions: {
      retryOptions: { attempts: RETRY_ATTEMPTS, httpStatusCodes: RETRYABLE_STATUSES },
    },
  };
}

let cached: GoogleGenAI | undefined;

export function client() {
  cached ??= new GoogleGenAI(clientOptions());
  return cached;
}

export const resolvePictures = stagedPictures();

function bodySaid(error: ApiError) {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string" ? parsed.error.message : error.message;
  } catch {
    return error.message;
  }
}

export function isThrottledCall(error: ApiError) {
  return error.status === 404 && bodySaid(error).trimStart().startsWith("<");
}

function apiErrorOf(cause: unknown): ApiError | undefined {
  const error = cause as ApiError | undefined;
  return error instanceof Error && error.name === "ApiError" && typeof error.status === "number"
    ? error
    : undefined;
}

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

export type GeneratePart = Part;

export type Content = { role: "user" | "model"; parts: GeneratePart[] };

export type GenerateConfig = {
  systemInstruction?: string;
  tools?: { functionDeclarations: ToolDeclaration[] }[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  responseModalities?: string[];
  imageConfig?: { aspectRatio?: string };
  thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string };
};

export type GenerateAnswer = {
  candidates?: {
    content?: { parts?: GeneratePart[] };
    finishReason?: string;
    finishMessage?: string;
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: unknown;
};

export async function generateContent(
  model: string,
  contents: Content[],
  config: GenerateConfig = {},
  resolve: PictureResolver = resolvePictures,
): Promise<GenerateAnswer> {
  const started = Date.now();
  try {
    const sent = await resolve(contents);
    const answer = await throttleRetried(() =>
      client().models.generateContent({
        model,
        contents: sent,
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

export type GenerateChunk = {
  candidates?: {
    content?: { parts?: GeneratePart[] };
    finishReason?: string;
    finishMessage?: string;
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: unknown;
};

export type GenerateWatcher = { chunk: (parts: GeneratePart[]) => void };

export function assembled(chunks: readonly GenerateChunk[]): GenerateAnswer {
  const parts: GeneratePart[] = [];
  let finishReason: string | undefined;
  let finishMessage: string | undefined;
  let promptFeedback: GenerateAnswer["promptFeedback"];

  for (const chunk of chunks) {
    const candidate = chunk.candidates?.[0];
    parts.push(...(candidate?.content?.parts ?? []));
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (candidate?.finishMessage) finishMessage = candidate.finishMessage;
    if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback;
  }

  const usageMetadata = usageChunkOf(chunks);
  return {
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

export async function streamRetried(
  connect: () => Promise<AsyncIterable<GenerateChunk>>,
  watch: GenerateWatcher,
  retries = THROTTLE_RETRIES,
): Promise<GenerateChunk[]> {
  for (let attempt = 0; ; attempt++) {
    const chunks: GenerateChunk[] = [];
    let told = false;
    try {
      const stream = await connect();
      for await (const chunk of stream) {
        chunks.push(chunk);
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        if (parts.length) {
          try {
            watch.chunk(parts);
          } catch (cause) {
            console.error("stream watcher failed:", cause);
          }
          told = true;
        }
      }
      return chunks;
    } catch (cause) {
      const error = apiErrorOf(cause);
      const retryable =
        error !== undefined &&
        (RETRYABLE_STATUSES.includes(error.status) || isThrottledCall(error));
      if (told || !retryable || attempt >= retries) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

export async function generateContentStream(
  model: string,
  contents: Content[],
  config: GenerateConfig = {},
  watch: GenerateWatcher = { chunk: () => {} },
  resolve: PictureResolver = resolvePictures,
): Promise<GenerateAnswer> {
  const started = Date.now();
  try {
    const sent = await resolve(contents);
    const chunks = await streamRetried(
      () =>
        throttleRetried(() =>
          client().models.generateContentStream({
            model,
            contents: sent,
            config: config as GenerateContentConfig,
          }),
        ),
      watch,
    );
    const answer = assembled(chunks);
    transcribe(model, contents, config, Date.now() - started, { answer });
    return answer;
  } catch (cause) {
    transcribe(model, contents, config, Date.now() - started, { error: String(cause) });
    throw cause;
  }
}

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
    thinking: thoughtsOf(parts),
    text: textOf(parts),
    calls: functionCallsIn(parts).map(({ name, args }) => ({ name, args: args ?? {} })),
    finishReason: candidate?.finishReason,
    usage: answer ? usageOf(answer) : undefined,
    error,
  };
}

export async function countTokens(
  model: string,
  contents: Content[],
  config: CountConfig = {},
  resolve: PictureResolver = resolvePictures,
): Promise<number> {
  const sent = await resolve(contents);
  const { totalTokens } = await throttleRetried(() =>
    client().models.countTokens({ model, contents: sent, config: config as CountTokensConfig }),
  );
  return totalTokens ?? 0;
}

export type CountConfig = {
  systemInstruction?: string;
  tools?: { functionDeclarations: ToolDeclaration[] }[];
};

export function textOf(parts: GeneratePart[]) {
  return parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function thoughtsOf(parts: GeneratePart[]) {
  return parts.flatMap((part) => (part.thought && part.text ? [part.text] : []));
}

export function inlineDataOf(parts: GeneratePart[]): { mimeType: string; data: string } | null {
  for (const { inlineData } of parts) {
    if (inlineData?.data && inlineData.mimeType) {
      return { mimeType: inlineData.mimeType, data: inlineData.data };
    }
  }
  return null;
}

export function functionCallsIn(parts: GeneratePart[]) {
  return parts.flatMap(({ functionCall }) =>
    functionCall?.name
      ? [{ name: functionCall.name, args: functionCall.args as Record<string, unknown> | undefined }]
      : [],
  );
}
