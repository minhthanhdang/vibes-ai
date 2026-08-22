import "server-only";

import { MODEL_RENDER_LIFECYCLE_DAYS, MODEL_RENDER_PREFIX } from "@/lib/scene/moodboard-render";

/// What the bucket's lifecycle should say about `renders/` (compositor-v2.md
/// §III.2, infra.md §IX), and the arithmetic of putting it there without
/// disturbing what else is on the bucket.
///
/// The rule itself is one line of JSON. The reason it needs a module is that
/// setting a bucket's lifecycle is a whole-list write: there is no "add a rule"
/// call, only "here are the rules", so an operator who pastes the renders rule
/// alone deletes every other rule the bucket had. The merge below is what makes
/// `scripts/bucket-lifecycle.mts` safe to run twice, and safe to run on a bucket
/// that has since grown a rule nobody here knows about.
///
/// The prefix and the number come from the module that names the objects rather
/// than being written again here. A sweep that matches a prefix the renderer
/// stopped writing to is a bucket that only grows, and it would look correct.

/// The action names are the closed set the storage API takes, spelled out here
/// rather than left as a `string`: this is the shape written back to the bucket,
/// and the client's own types refuse anything else at the call.
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

/// A rule this file owns: one that names the renders prefix. Ownership is by
/// prefix and not by the whole rule, so an older or wronger renders rule — 30
/// days, or a SetStorageClass nobody wants any more — is replaced rather than
/// left sitting beside the right one, where the shorter age would still win but
/// the bucket would read as if two people disagreed.
function governsRenders(rule: LifecycleRule) {
  return prefixesOf(rule).includes(MODEL_RENDER_PREFIX);
}

/// A rule that sweeps `renders/` without naming it — no prefix at all, or one
/// the renders prefix starts with. Not touched, because it is somebody else's
/// rule about the whole bucket, but reported: it can delete a render earlier
/// than seven days, and then the age in this file is not the age that governs.
function alsoSweepsRenders(rule: LifecycleRule) {
  const prefixes = prefixesOf(rule);
  if (prefixes.length === 0) return true;
  return prefixes.some((p) => p !== MODEL_RENDER_PREFIX && MODEL_RENDER_PREFIX.startsWith(p));
}

export type LifecyclePlan = {
  rules: LifecycleRule[];
  /// `already` is the run that should change nothing — the second `--apply`,
  /// and the check an operator runs to ask whether the rule is still there.
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
    // The already-right bucket is handed back its own list rather than a
    // reordered copy of it: nothing here is a reason to rewrite a rule.
    rules: already ? existing : [...others, MODEL_RENDER_RULE],
    change: already ? "already" : replaced.length > 0 ? "replaced" : "added",
    replaced: already ? [] : replaced,
    wider: others.filter(alsoSweepsRenders),
  };
}
