/**
 * Record a real chat session from a running CourseHub backend into a demo fixture.
 *
 * Usage:
 *   node scripts/record-session.mjs --id cse100-overview --out src/demo/fixtures/cse100-overview.json \
 *     "What does CSE 100 cover?" ["follow-up question" ...]
 *
 * Multiple questions form one multi-turn session: each turn reuses the same
 * user_id and chains conv_id from the previous answer, exactly like the app.
 * Options: --url <backend base, default http://localhost:8010>
 *
 * The fixture stores every SSE event with its relative timestamp (at_ms), so
 * Demo Mode can replay the stream with the real inter-event rhythm. Fixture
 * admission is gated by the strict frontend decoder in a Vitest test — do not
 * hand-edit fixtures; re-record instead.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = { url: "http://localhost:8010", id: "", out: "", questions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--id") args.id = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else args.questions.push(a);
  }
  if (!args.id || !args.out || args.questions.length === 0) {
    console.error("Required: --id <slug> --out <file> \"question\" [\"question\" ...]");
    process.exit(1);
  }
  return args;
}

/** Minimal SSE block parser for the recorder (the app's parser is the contract). */
function parseBlock(block) {
  let event = "";
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!event) return null;
  let data = null;
  if (dataLines.length > 0) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      data = null;
    }
  }
  return { event, data };
}

async function recordTurn(url, question, userId, convId) {
  const t0 = Date.now();
  const response = await fetch(`${url}/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: question,
      user_id: userId,
      ...(convId ? { conv_id: convId } : {}),
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`POST /chat/stream failed: ${response.status}`);
  }

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const evt = parseBlock(block);
      if (evt) events.push({ ...evt, at_ms: Date.now() - t0 });
    }
  }

  const answer = events.find((e) => e.event === "answer");
  if (!answer) throw new Error(`No answer event for: ${question}`);
  return { question, events };
}

const args = parseArgs(process.argv.slice(2));
const userId = randomUUID();
const turns = [];
let convId;
for (const question of args.questions) {
  console.log(`Recording: ${question}`);
  const turn = await recordTurn(args.url, question, userId, convId);
  convId = turn.events.find((e) => e.event === "answer").data.conv_id;
  const total = turn.events.at(-1).at_ms;
  console.log(`  ${turn.events.length} events over ${total} ms (conv_id ${convId})`);
  turns.push(turn);
}

const fixture = {
  id: args.id,
  recorded_at: new Date().toISOString(),
  backend: args.url,
  turns,
};
const outPath = resolve(args.out);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);
