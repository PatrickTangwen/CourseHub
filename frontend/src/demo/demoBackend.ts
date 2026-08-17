/**
 * Demo Mode 的页内"后端":把全局 fetch 替换为面向实录 fixture 的路由。
 * 应用代码(chatAdapter/HealthDot/DevPanel)原样运行——回放重建为真正的
 * SSE 字节流,由生产解析器与严格 decoder 消费。取舍见 ADR-0003。
 */
import { API_BASE, type ChatAnswer } from "../lib/chatApi";
import { DEMO_SESSIONS, type RecordedTurn } from "./sessions";
import {
  ALERT_MESSAGES_EN,
  DEMO_LOCALE,
  DEMO_NOTICE,
  SKILL_LABELS_EN,
} from "./demoStrings";
import panelSnapshots from "./fixtures/panel-snapshots.json";

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

/** 面板写操作的假成功:作用于内存统计,页面刷新(重新 install)即复位到快照。 */
function createKnowledgeStats() {
  return { ...panelSnapshots.knowledge_stats };
}

/** 英文 demo 页:skills 名称/描述显示英文标注;中文页保持实录原文。 */
function labeledSkills() {
  if (DEMO_LOCALE === "zh") return panelSnapshots.skills;
  return {
    ...panelSnapshots.skills,
    skills: panelSnapshots.skills.skills.map((skill) => ({
      ...skill,
      ...(SKILL_LABELS_EN[skill.name] ?? {}),
    })),
  };
}

function labeledMonitor() {
  if (DEMO_LOCALE === "zh") return panelSnapshots.monitor;
  return {
    ...panelSnapshots.monitor,
    active_alerts: panelSnapshots.monitor.active_alerts.map((alert) => ({
      ...alert,
      message: ALERT_MESSAGES_EN[alert.message] ?? alert.message,
    })),
  };
}

export function installDemoBackend(): void {
  const knowledgeStats = createKnowledgeStats();

  const demoFetch: typeof fetch = async (input, init) => {
    const path = requestUrl(input).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();

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

    if (path === `${API_BASE}/knowledge/stats`) {
      return Response.json(knowledgeStats);
    }

    if (path === `${API_BASE}/monitor`) {
      return Response.json(labeledMonitor());
    }

    if (path === `${API_BASE}/skills` || path === `${API_BASE}/skills/reload`) {
      return Response.json(labeledSkills());
    }

    if (path === `${API_BASE}/knowledge/add` && method === "POST") {
      const body = typeof init?.body === "string" ? init.body : "{}";
      const documents =
        (JSON.parse(body) as { documents?: unknown[] }).documents ?? [];
      knowledgeStats.total_chunks += documents.length;
      knowledgeStats.total_documents += documents.length;
      return Response.json({ added_chunks: documents.length });
    }

    if (path === `${API_BASE}/knowledge/upload` && method === "POST") {
      knowledgeStats.total_chunks += 1;
      knowledgeStats.total_documents += 1;
      return Response.json({ added_chunks: 1 });
    }

    throw new Error(`Demo Mode has no route for ${path}`);
  };

  globalThis.fetch = demoFetch;
}
