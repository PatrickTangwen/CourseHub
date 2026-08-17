/**
 * Demo Mode 的页内"后端":把全局 fetch 替换为面向实录 fixture 的路由。
 * 应用代码(chatAdapter/HealthDot/DevPanel)原样运行——回放重建为真正的
 * SSE 字节流,由生产解析器与严格 decoder 消费。取舍见 ADR-0003。
 */
import { API_BASE, type ChatAnswer } from "../lib/chatApi";
import { DEMO_SESSIONS, type RecordedTurn } from "./sessions";
import { DEMO_NOTICE } from "./demoStrings";

/** 阶段流回放总时长:等比压缩,各事件相对节奏保持实录比例。测试下瞬时。 */
const REPLAY_TOTAL_MS = import.meta.env.MODE === "test" ? 0 : 2500;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function findTurn(message: string): RecordedTurn | undefined {
  const wanted = normalize(message);
  for (const session of DEMO_SESSIONS) {
    for (const turn of session.turns) {
      if (normalize(turn.question) === wanted) return turn;
    }
  }
  return undefined;
}

const encoder = new TextEncoder();

const sseFrame = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function replayStream(
  turn: RecordedTurn,
  signal: AbortSignal | null | undefined,
): ReadableStream<Uint8Array> {
  const total = turn.events.at(-1)?.at_ms ?? 0;
  const scale = total > 0 ? REPLAY_TOTAL_MS / total : 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      for (const evt of turn.events) {
        const dueIn = evt.at_ms * scale - (Date.now() - t0);
        if (dueIn > 0) await sleep(dueIn);
        if (signal?.aborted) break;
        controller.enqueue(sseFrame(evt.event, evt.data));
      }
      controller.close();
    },
  });
}

function answerFor(turn: RecordedTurn): unknown {
  return turn.events.find((evt) => evt.event === "answer")?.data;
}

const hasCJK = (text: string) => /[㐀-䶿一-鿿]/.test(text);

/** Demo Notice:脚本库外的输入得到按输入语言的固定说明,不伪造任何阶段。 */
function noticeTurn(message: string): RecordedTurn {
  const questions = DEMO_SESSIONS.map((s) => s.turns[0].question);
  const notice = (hasCJK(message) ? DEMO_NOTICE.zh : DEMO_NOTICE.en)(questions);
  const answer: ChatAnswer = {
    conv_id: "demo-notice",
    response: notice,
    intent: "meta_info",
    intent_group: "general",
    agent_type: "general",
    agent_types: ["general"],
    primary_agent: "general",
    supporting_agents: [],
    routing_reason: "Demo Mode notice for unscripted input",
    routing_confidence: 1,
    escalated: false,
    latency_ms: 0,
    knowledge_used: false,
    entities: {},
    intent_confidence: 1,
    intent_source_scores: {},
  };
  return {
    question: message,
    events: [
      { event: "answer", data: answer, at_ms: 0 },
      { event: "done", data: {}, at_ms: 0 },
    ],
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function chatMessage(init: RequestInit | undefined): string {
  const body = typeof init?.body === "string" ? init.body : "{}";
  return (JSON.parse(body) as { message?: string }).message ?? "";
}

export function installDemoBackend(): void {
  const demoFetch: typeof fetch = async (input, init) => {
    const path = requestUrl(input).split("?")[0];

    if (path === `${API_BASE}/chat/stream`) {
      const message = chatMessage(init);
      const turn = findTurn(message) ?? noticeTurn(message);
      return new Response(replayStream(turn, init?.signal), { status: 200 });
    }

    if (path === `${API_BASE}/chat`) {
      const message = chatMessage(init);
      const turn = findTurn(message) ?? noticeTurn(message);
      return Response.json(answerFor(turn));
    }

    if (path === `${API_BASE}/health`) {
      return Response.json({ status: "ok" });
    }

    throw new Error(`Demo Mode has no route for ${path}`);
  };

  globalThis.fetch = demoFetch;
}
