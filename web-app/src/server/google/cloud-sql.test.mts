import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeCloudSql, cloudSqlOptions, type ConnectorFactory, type SqlConnector } from "./cloud-sql";

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

  assert.equal(fake.asked[0]?.instanceConnectionName, "proj:us-central1:the-one-asked-for");
});

test("it asks for the public IP, because the instance has no private one", async () => {
  const fake = fresh();

  await cloudSqlOptions("proj:us-central1:one", fake.make);

  assert.equal(fake.asked[0]?.ipType, "PUBLIC");
});

test("what the connector answers is what the caller gets, unreshaped", async () => {
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
  fresh();

  assert.doesNotThrow(() => closeCloudSql());
});

test("the default connector is handed this project's credential, not left to find one", async () => {
  const source = await readFile(new URL("./cloud-sql.ts", import.meta.url), "utf8");

  assert.match(source, /new Connector\(\{ auth: connectorAuth\(\) \}\)/);
  assert.equal(source.match(/new Connector\(/g)?.length, 1);
});
