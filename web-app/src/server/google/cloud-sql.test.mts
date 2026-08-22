import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeCloudSql, cloudSqlOptions, type ConnectorFactory, type SqlConnector } from "./cloud-sql";

/// The connector the whole database path hangs off. `db-path.test.mts` holds
/// *who* may name the package and `once.test.mts` holds how the pool above it
/// is cached; nothing held this module, because `getOptions()` dials the Admin
/// API on its first call and there was no way to hand it anything else.
/// Everything below was verified breakable with 1,989 cases green: the
/// one-per-process cache made unconditional (a second cert-refresh loop against
/// the Admin API for the same instance), the IP type switched to `PRIVATE` (this
/// instance has no private IP — infra §XVI, so every query fails), and either
/// half of `closeCloudSql` dropped (a close that does not close, or a closed
/// connector left in the slot for the next caller to query through).
///
/// The seam is a default parameter, so the app's own call in `db.ts` still
/// passes one argument and still gets the real dialing connector.

/// Never dialled: the point of the fake is that the socket is never opened.
type Options = Awaited<ReturnType<SqlConnector["getOptions"]>>;
const socket = (() => undefined) as unknown as Options["stream"];

function fakeConnector() {
  const asked: Parameters<SqlConnector["getOptions"]>[0][] = [];
  const options: Options = { stream: socket };
  let built = 0;
  let closed = 0;

  const make: ConnectorFactory = () => {
    built += 1;
    return {
      getOptions: async (opts) => {
        asked.push(opts);
        return options;
      },
      close: () => {
        closed += 1;
      },
    };
  };

  return {
    make,
    options,
    asked,
    builds: () => built,
    closes: () => closed,
  };
}

/// The module-level connector outlives a single case by design, which is the
/// behaviour under test — so every case starts from an empty slot.
function fresh() {
  closeCloudSql();
  return fakeConnector();
}

test("a second query reuses the first query's connector, whatever instance it names", async () => {
  const fake = fresh();

  await cloudSqlOptions("proj:us-central1:one", fake.make);
  await cloudSqlOptions("proj:us-central1:two", fake.make);

  assert.equal(fake.builds(), 1);
  assert.equal(fake.asked.length, 2);
});

test("the instance it is asked for is the instance it asks the connector for", async () => {
  const fake = fresh();

  await cloudSqlOptions("proj:us-central1:the-one-asked-for", fake.make);

  /// Deliberately not the production name from infra §XVI: the connection name
  /// written into this file rather than passed through is the mutation that
  /// would survive a case asserting the name the app happens to use.
  assert.equal(fake.asked[0]?.instanceConnectionName, "proj:us-central1:the-one-asked-for");
});

test("it asks for the public IP, because the instance has no private one", async () => {
  /// infra §XVI: `vibes-ai-pg` was provisioned with a public IP and no VPC
  /// peering. `PRIVATE` typechecks, is the safer-sounding of the two, and would
  /// fail every query at runtime with nothing in the suite to say so.
  const fake = fresh();

  await cloudSqlOptions("proj:us-central1:one", fake.make);

  assert.equal(fake.asked[0]?.ipType, "PUBLIC");
});

test("what the connector answers is what the caller gets, unreshaped", async () => {
  /// `{ stream }` and nothing else — tech-spec §VIII's correction to the
  /// connector's own README. A `pg` config assembled here instead of spread
  /// from this object is the shape that would put a hostname back on the wire.
  const fake = fresh();

  assert.equal(await cloudSqlOptions("proj:us-central1:one", fake.make), fake.options);
});

test("closing closes the connector, which is what releases its cert-refresh timer", async () => {
  const fake = fresh();
  await cloudSqlOptions("proj:us-central1:one", fake.make);

  closeCloudSql();

  assert.equal(fake.closes(), 1);
});

test("closing empties the slot, so the next caller does not query through a closed connector", async () => {
  const fake = fresh();
  await cloudSqlOptions("proj:us-central1:one", fake.make);

  closeCloudSql();
  await cloudSqlOptions("proj:us-central1:one", fake.make);

  assert.equal(fake.builds(), 2);
});

test("closing a process that never queried is a no-op, because `closeDb` runs either way", () => {
  /// `npm run floor`, `npm run spend` and `npm run smoke` all end in `closeDb`,
  /// and a run that never touched the database has no connector to close.
  fresh();

  assert.doesNotThrow(() => closeCloudSql());
});

/// The one rule the cases above cannot reach: the default is what production
/// uses and what a test never does. Constructing it dials the Admin API, so it
/// is read where the drift would land instead.
test("the default connector is handed this project's credential, not left to find one", async () => {
  const source = await readFile(new URL("./cloud-sql.ts", import.meta.url), "utf8");

  assert.match(source, /new Connector\(\{ auth: connectorAuth\(\) \}\)/);
  assert.equal(source.match(/new Connector\(/g)?.length, 1);
});
