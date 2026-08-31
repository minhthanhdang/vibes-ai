import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type GrantMethod = "GET" | "PUT";

export type Grant = {
  bucket: string;
  object: string;
  method: GrantMethod;
  contentType?: string;
  cacheControl?: string;
  accessibleAt: number;
  expires: number;
};

export type GrantRefusal = { refused: string };

const VERSION = "v1";

export function grantPayload(grant: Grant): string {
  return [
    VERSION,
    grant.bucket,
    grant.object,
    grant.method,
    grant.contentType ?? "",
    grant.cacheControl ?? "",
    String(grant.accessibleAt),
    String(grant.expires),
  ].join("\n");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function grantToken(grant: Grant, secret: string): string {
  const payload = grantPayload(grant);
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload, secret)}`;
}

export function grantUrl(origin: string, grant: Grant, secret: string): string {
  const path = grant.object
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${origin}/api/dev-storage/${encodeURIComponent(grant.bucket)}/${path}?t=${grantToken(grant, secret)}`;
}

function sameSignature(offered: string, expected: string) {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function grantFromPayload(payload: string): Grant | null {
  const [version, bucket, object, method, contentType, cacheControl, accessibleAt, expires] =
    payload.split("\n");
  if (version !== VERSION || !bucket || !object) return null;
  if (method !== "GET" && method !== "PUT") return null;
  return {
    bucket,
    object,
    method,
    ...(contentType && { contentType }),
    ...(cacheControl && { cacheControl }),
    accessibleAt: Number(accessibleAt),
    expires: Number(expires),
  };
}

export type GrantCheck = {
  bucket: string;
  object: string;
  method: GrantMethod;
  headers?: Headers;
  now?: number;
};

export function grantRefused(outcome: Grant | GrantRefusal): outcome is GrantRefusal {
  return "refused" in outcome;
}

export function verifyGrant(
  token: string | null | undefined,
  secret: string,
  { bucket, object, method, headers, now = Date.now() }: GrantCheck,
): Grant | GrantRefusal {
  if (!token) return { refused: "no grant on that URL" };

  const [encoded, offered] = token.split(".");
  if (!encoded || !offered) return { refused: "that grant is not a token" };

  const payload = Buffer.from(encoded, "base64url").toString();
  if (!sameSignature(offered, signature(payload, secret))) {
    return { refused: "that grant was not signed by this store" };
  }

  const grant = grantFromPayload(payload);
  if (!grant) return { refused: "that grant is not one this store issues" };

  if (grant.bucket !== bucket || grant.object !== object) {
    return { refused: `that grant is for gs://${grant.bucket}/${grant.object}, not this object` };
  }
  if (grant.method !== method) {
    return { refused: `that grant is for ${grant.method}, not ${method}` };
  }
  if (now < grant.accessibleAt) return { refused: "that grant is not accessible yet" };
  if (now > grant.expires) return { refused: "that grant has expired" };

  return headerRefusal(grant, headers) ?? grant;
}

function headerRefusal(grant: Grant, headers: Headers | undefined): GrantRefusal | null {
  const signed: [string, string | undefined][] = [
    ["content-type", grant.contentType],
    ["cache-control", grant.cacheControl],
  ];
  for (const [name, expected] of signed) {
    if (expected === undefined) continue;
    const sent = headers?.get(name);
    if (sent !== expected) {
      return { refused: `that grant signed ${name}: ${expected}, and the request sent ${sent ?? "none"}` };
    }
  }
  return null;
}
