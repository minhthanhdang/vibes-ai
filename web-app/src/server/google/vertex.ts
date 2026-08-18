import "server-only";
import { accessToken } from "./auth";
import { env } from "@/env";

/// Single point of indirection: PRO is a preview id and may be renamed.
/// tech-spec §II, verified live on `global` in infra.md §X.
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

export function modelPath(model: string) {
  const { GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: location } = env();
  return `projects/${project}/locations/${location}/publishers/google/models/${model}`;
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

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

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
    const retryable = RETRYABLE_STATUSES.has(response.status) || isThrottle(response.status, contentType);
    if (!retryable || attempt >= retries) {
      throw new VertexError(response.status, await response.text(), retryable);
    }

    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
  }
}

export type GeneratePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  // A `gs://` uri the model reads itself. tech-spec §IV: images move between
  // tiers as artifact references, never as base64 through context.
  | { fileData: { fileUri: string; mimeType: string } }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type Content = { role: "user" | "model"; parts: GeneratePart[] };

export type GenerateConfig = {
  systemInstruction?: string;
  tools?: { functionDeclarations: FunctionDeclaration[] }[];
  generationConfig?: Record<string, unknown>;
};

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export async function generateContent(model: string, contents: Content[], config: GenerateConfig = {}) {
  const { systemInstruction, ...rest } = config;
  const response = await vertexFetch(`${modelPath(model)}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      contents,
      ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
      ...rest,
    }),
  });
  return (await response.json()) as {
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
}

export function textOf(parts: GeneratePart[]) {
  return parts
    .flatMap((part) => ("text" in part ? [part.text] : []))
    .join("")
    .trim();
}

/// The first image of an answer. The IMAGE model interleaves text and image
/// parts, and one call asks for one picture — a second image part would be one
/// nobody asked for, so the first is the answer.
export function inlineDataOf(parts: GeneratePart[]) {
  for (const part of parts) {
    if ("inlineData" in part) return part.inlineData;
  }
  return null;
}

export function functionCallsIn(parts: GeneratePart[]) {
  return parts.flatMap((part) => ("functionCall" in part ? [part.functionCall] : []));
}
