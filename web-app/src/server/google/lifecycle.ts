import "server-only";

import { MODEL_RENDER_LIFECYCLE_DAYS, MODEL_RENDER_PREFIX } from "@/lib/scene/moodboard-render";

export type LifecycleRule = {
  action: {
    type: "Delete" | "SetStorageClass" | "AbortIncompleteMultipartUpload";
    storageClass?: string;
  };
  condition: Record<string, unknown>;
};

export const MODEL_RENDER_RULE: LifecycleRule = {
  action: { type: "Delete" },
  condition: {
    age: MODEL_RENDER_LIFECYCLE_DAYS,
    matchesPrefix: [MODEL_RENDER_PREFIX],
  },
};

function prefixesOf(rule: LifecycleRule) {
  const named = rule.condition.matchesPrefix;
  return Array.isArray(named) ? named.filter((p): p is string => typeof p === "string") : [];
}

function governsRenders(rule: LifecycleRule) {
  return prefixesOf(rule).includes(MODEL_RENDER_PREFIX);
}

function alsoSweepsRenders(rule: LifecycleRule) {
  const prefixes = prefixesOf(rule);
  if (prefixes.length === 0) return true;
  return prefixes.some((p) => p !== MODEL_RENDER_PREFIX && MODEL_RENDER_PREFIX.startsWith(p));
}

export type LifecyclePlan = {
  rules: LifecycleRule[];
  change: "already" | "added" | "replaced";
  replaced: LifecycleRule[];
  wider: LifecycleRule[];
};

export function withModelRenderRule(existing: LifecycleRule[]): LifecyclePlan {
  const replaced = existing.filter(governsRenders);
  const others = existing.filter((rule) => !governsRenders(rule));
  const already =
    replaced.length === 1 && JSON.stringify(replaced[0]) === JSON.stringify(MODEL_RENDER_RULE);
  return {
    rules: already ? existing : [...others, MODEL_RENDER_RULE],
    change: already ? "already" : replaced.length > 0 ? "replaced" : "added",
    replaced: already ? [] : replaced,
    wider: others.filter(alsoSweepsRenders),
  };
}
