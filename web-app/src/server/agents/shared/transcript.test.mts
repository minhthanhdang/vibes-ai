import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";

const { recordModelCall, transcribing, transcriptSettled, withTranscript } = await import(
  "./transcript"
);

const CALL = {
  model: "gemini-3.7-flash",
  ms: 1234,
  systemInstruction: "You are agent 6.",
  declarations: ["design_page", "add_board"],
  contents: [{ role: "user", parts: [{ text: "make me a page" }] }],
  thinking: [],
  text: "on it",
  calls: [],
};

async function temporary() {
  return mkdtemp(join(tmpdir(), "transcript-"));
}

function transcriptsIn(directory: string | undefined) {
  if (directory === undefined) delete process.env.AGENT_TRANSCRIPT_DIR;
  else process.env.AGENT_TRANSCRIPT_DIR = directory;
}

async function recordsIn(directory: string, stem: string) {
  const written = await readFile(join(directory, `${stem}.jsonl`), "utf8");
  return written
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("the variable unset writes nothing and still returns the turn's answer", async () => {
  const directory = await temporary();
  transcriptsIn(undefined);

  const answered = await withTranscript("orchestrator", async () => {
    recordModelCall({ ...CALL, text: "unrecorded" });
    return "the reply";
  });

  assert.equal(answered, "the reply");
  assert.equal(transcribing(), false);
  assert.deepEqual(await readdir(directory), []);
});

test("a turn writes one pair of files, numbered in the order the rounds ran", async () => {
  const directory = await temporary();
  transcriptsIn(directory);

  await withTranscript("orchestrator", async () => {
    recordModelCall({ ...CALL, text: "first" });
    recordModelCall({ ...CALL, text: "second" });
    await transcriptSettled();
  });

  const written = (await readdir(directory)).sort();
  assert.equal(written.length, 2, `wrote ${written.join(", ")}`);
  const [stem] = written[0].split(".");
  assert.deepEqual(written, [`${stem}.jsonl`, `${stem}.md`]);
  assert.match(stem, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d_orchestrator_[0-9a-f]{8}$/);

  const records = await recordsIn(directory, stem);
  assert.deepEqual(
    records.map(({ seq, agent, under, text }) => ({ seq, agent, under, text })),
    [
      { seq: 1, agent: "orchestrator", under: [], text: "first" },
      { seq: 2, agent: "orchestrator", under: [], text: "second" },
    ],
  );

  const readable = await readFile(join(directory, `${stem}.md`), "utf8");
  assert.match(readable, /## round 1 · orchestrator · gemini-3\.7-flash/);
  assert.match(readable, /## round 2 · orchestrator/);
});

test("a nested agent writes into its parent's file, labelled and in order", async () => {
  const directory = await temporary();
  transcriptsIn(directory);

  await withTranscript("orchestrator", async () => {
    recordModelCall({ ...CALL, text: "routing" });
    await withTranscript("designer", async () => {
      recordModelCall({ ...CALL, text: "designing" });
    });
    recordModelCall({ ...CALL, text: "replying" });
    await transcriptSettled();
  });

  const written = (await readdir(directory)).sort();
  assert.equal(written.length, 2, `one turn is one pair of files, got ${written.join(", ")}`);

  const records = await recordsIn(directory, written[0].split(".")[0]);
  assert.deepEqual(
    records.map(({ seq, agent, under }) => ({ seq, agent, under })),
    [
      { seq: 1, agent: "orchestrator", under: [] },
      { seq: 2, agent: "designer", under: ["orchestrator"] },
      { seq: 3, agent: "orchestrator", under: [] },
    ],
  );
});

test("two turns at once write to two files and never cross", async () => {
  const directory = await temporary();
  transcriptsIn(directory);

  const turn = (said: string) =>
    withTranscript("orchestrator", async () => {
      recordModelCall({ ...CALL, text: `${said} one` });
      await new Promise((settle) => setTimeout(settle, 5));
      recordModelCall({ ...CALL, text: `${said} two` });
      await transcriptSettled();
    });

  await Promise.all([turn("left"), turn("right")]);

  const stems = [...new Set((await readdir(directory)).map((file) => file.split(".")[0]))];
  assert.equal(stems.length, 2, `two turns, ${stems.length} files`);

  const said = await Promise.all(
    stems.map(async (stem) => (await recordsIn(directory, stem)).map((record) => record.text)),
  );
  said.sort();
  assert.deepEqual(said, [
    ["left one", "left two"],
    ["right one", "right two"],
  ]);
});

test("nested agents running at once each keep their own label", async () => {
  const directory = await temporary();
  transcriptsIn(directory);

  await withTranscript("orchestrator", async () => {
    await Promise.all([
      withTranscript("designer", async () => {
        await new Promise((settle) => setTimeout(settle, 5));
        recordModelCall({ ...CALL, text: "designing" });
      }),
      withTranscript("cropper", async () => {
        recordModelCall({ ...CALL, text: "cropping" });
      }),
    ]);
    await transcriptSettled();
  });

  const [stem] = (await readdir(directory))[0].split(".");
  const records = await recordsIn(directory, stem);
  assert.deepEqual(
    records.map(({ agent, under, text }) => ({ agent, under, text })),
    [
      { agent: "cropper", under: ["orchestrator"], text: "cropping" },
      { agent: "designer", under: ["orchestrator"], text: "designing" },
    ],
  );
});

test("a directory that cannot be made takes nothing down, and stops after three", async () => {
  const directory = await temporary();
  const blocked = join(directory, "a-file");
  await writeFile(blocked, "not a directory");
  transcriptsIn(join(blocked, "transcripts"));

  const answered = await withTranscript("orchestrator", async () => {
    recordModelCall(CALL);
    recordModelCall(CALL);
    await transcriptSettled();
    assert.equal(transcribing(), true, "two failures is not yet three");
    recordModelCall(CALL);
    await transcriptSettled();
    return "the reply";
  });

  assert.equal(answered, "the reply");
  assert.equal(transcribing(), false);
  assert.deepEqual(await readdir(directory), ["a-file"]);
});
