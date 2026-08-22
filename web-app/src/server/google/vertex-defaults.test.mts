import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/// What `vertex.ts` supplies when no caller supplies it: the host a request
/// goes to, the number of times a throttled one is asked again, and the client
/// it is all sent through.
///
/// These three are unlike everything else in this module in that no test could
/// reach them by accident — every existing case passes `retries` explicitly, no
/// case calls `apiHost()` at all, and the client is a module-level `let`. So
/// each of the three could be changed to something else entirely with the whole
/// suite green: the region branch dropped, the retry budget set to zero, a
/// fresh client minted per call. A default nobody passes is the easiest thing
/// in a module to get wrong and the last thing to notice.
///
/// `env()` is lazy and memoised onto `process.env` itself under this flag, so
/// the location can be moved between assertions and `apiHost()` reads the move.
process.env.SKIP_ENV_VALIDATION = "1";
process.env.GOOGLE_CLOUD_PROJECT = "test-project";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{}";

const { THROTTLE_RETRIES, apiHost, client, throttleRetried } = await import(
  "@/server/google/vertex"
);

const hostAt = (location: string) => {
  process.env.GOOGLE_CLOUD_LOCATION = location;
  return apiHost();
};

/// The domain itself is deliberately not written down here. `sdk-boundary.test
/// .mts` holds that exactly one file in the tree spells it — that is what makes
/// a hand-rolled model call visible — and a second speller would have to be
/// allow-listed onto the strongest rule in this directory to hold the weaker
/// fact that a string is what it is. What is worth holding is the branch: that
/// a region is served from somewhere else than `global`.
test("a region is served from its own subdomain, and `global` from the bare host", () => {
  const global = hostAt("global");
  const region = hostAt("us-central1");

  assert.notEqual(region, global);
  assert.equal(region, global.replace("https://", "https://us-central1-"));
});

test("every region gets its own, so the prefix is the location and not a constant", () => {
  assert.equal(hostAt("europe-west4"), hostAt("global").replace("https://", "https://europe-west4-"));
});

/// The sleep between attempts, skipped. `throttleRetried` backs off
/// `2 ** attempt * 500`ms, so letting the default budget run to its end in real
/// time would cost this file 7.5 seconds to count to five.
async function attemptsUnderDefaultBudget(throwing: () => unknown) {
  const slept = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void) => slept(run, 0)) as typeof setTimeout;
  let attempts = 0;
  try {
    await throttleRetried(async () => {
      attempts += 1;
      throw throwing();
    });
  } catch {
    /// The throw is the point of the loop, not of this count.
  } finally {
    globalThis.setTimeout = slept;
  }
  return attempts;
}

/// Shaped by hand rather than taken from the SDK, which this file is
/// deliberately not on the allow-list to reach (`sdk-boundary.test.mts` keeps
/// that list to the three cases that need the real classes). It costs nothing
/// here: `throttleRetried` recognises the error by its name and a numeric
/// status on purpose — the package ships two builds and `instanceof` fails
/// across them — so the duck is the whole contract.
const throttling404 = () =>
  Object.assign(new Error(JSON.stringify({ error: { message: "<!DOCTYPE html>", code: 404 } })), {
    name: "ApiError",
    status: 404,
  });

test("a caller that names no budget gets THROTTLE_RETRIES asks after the first", async () => {
  assert.equal(await attemptsUnderDefaultBudget(throttling404), THROTTLE_RETRIES + 1);
});

test("the budget is four, which is the number `image-generator.ts` tells the user about", () => {
  /// Both transports read this one constant — `vertexFetch`'s `retries` default
  /// and `throttleRetried`'s are the same identifier now, not two literals that
  /// happen to agree — so the sentence about a busy drawing service describes
  /// whichever of them the call went through.
  assert.equal(THROTTLE_RETRIES, 4);
});

/// The one mutation the behavioural cases above cannot reach. `vertexFetch` is
/// the REST transport Agent Runtime kept and it needs a live bearer token to
/// call at all, so its budget cannot be counted from here the way
/// `throttleRetried`'s can — but the two agreeing is the whole reason the
/// constant exists, and a literal written back into either default would undo
/// it silently. Read off the source, which is where that drift would land.
test("neither transport writes its budget as a literal — both name the one constant", async () => {
  const source = await readFile(new URL("./vertex.ts", import.meta.url), "utf8");

  assert.equal(source.match(/retries = THROTTLE_RETRIES\b/g)?.length, 2);
  assert.match(source, /retries = /);
  assert.doesNotMatch(source, /retries = (?!THROTTLE_RETRIES\b)/);
});

test("a failure the loop does not own is not asked again on the default budget either", async () => {
  const attempts = await attemptsUnderDefaultBudget(() => new TypeError("fetch failed"));

  assert.equal(attempts, 1);
});

test("the process holds one client, because a client per call is a token per call", () => {
  /// The SDK announces on construction that explicit credentials win over an
  /// ambient API key. True and uninteresting, and one line of it per suite run
  /// is a line someone will eventually go looking for.
  const said = console.debug;
  console.debug = () => {};
  try {
    assert.equal(client(), client());
  } finally {
    console.debug = said;
  }
});
