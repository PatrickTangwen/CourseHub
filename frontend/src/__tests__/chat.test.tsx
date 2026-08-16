/**
 * 前端 seam 测试:整树渲染 + mock fetch 提供 fixture SSE 流。
 * 只断言用户可见行为(答案渲染、错误态),不触碰内部实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import type { ChatAnswer } from "../lib/chatApi";

function sseBody(frames: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(frames);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

function okResponse(frames: string) {
  return { ok: true, status: 200, body: sseBody(frames) } as Response;
}

const ANSWER: ChatAnswer = {
  conv_id: "c-1",
  response: "CSE 100 covers advanced data structures such as B-trees and graphs.",
  intent: "course_overview",
  intent_group: "facts",
  agent_type: "course",
  agent_types: ["course"],
  primary_agent: "course",
  supporting_agents: [],
  routing_reason: "intent=course_overview, primary=course",
  routing_confidence: 0.88,
  escalated: false,
  latency_ms: 12.3,
  knowledge_used: true,
  entities: { course_code: ["CSE 100"] },
  intent_confidence: 0.93,
  intent_source_scores: { llm: 0.9, embedding: 0, pattern: 0.7 },
};

const OK_FRAMES =
  'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
  `event: answer\ndata: ${JSON.stringify(ANSWER)}\n\n` +
  "event: done\ndata: {}\n\n";

const ERROR_FRAMES =
  'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
  'event: error\ndata: {"message":"Simulated backend failure"}\n\n';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("chat happy path", () => {
  it("sends a question and renders the streamed answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OK_FRAMES));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "What does CSE 100 cover?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(
      await screen.findByText(/CSE 100 covers advanced data structures/i),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/chat/stream");
    const payload = JSON.parse(String(init.body));
    expect(payload.message).toBe("What does CSE 100 cover?");
  });
});

describe("stage events (T2 placeholder display)", () => {
  function controllableSse() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const encoder = new TextEncoder();
    return {
      stream,
      push: (frames: string) => controller.enqueue(encoder.encode(frames)),
      close: () => controller.close(),
    };
  }

  it("shows stage events live during streaming and keeps them after完成", async () => {
    const sse = controllableSse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: sse.stream } as Response),
    );

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "What does CSE 100 cover?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    // 流式进行中:阶段事件实时出现,答案尚未到达
    sse.push('event: run_started\ndata: {"conv_id":"c-1"}\n\n');
    sse.push('event: memory_recalled\ndata: {"working_messages":1,"episodic_hits":2,"has_profile":true,"has_summary":false}\n\n');
    sse.push('event: intent_recognized\ndata: {"intent":"course_overview","intent_group":"facts","intent_confidence":0.93,"intent_source_scores":{"llm":0.9}}\n\n');
    sse.push('event: tool_call_started\ndata: {"tool_name":"knowledge_search"}\n\n');

    const stageList = await screen.findByTestId("stage-list");
    expect(stageList).toHaveTextContent("memory_recalled");
    expect(stageList).toHaveTextContent("intent_recognized");
    expect(stageList).toHaveTextContent("tool_call_started: knowledge_search");
    expect(
      screen.queryByText(/CSE 100 covers advanced data structures/i),
    ).not.toBeInTheDocument();

    // 完成:答案打字机渲染,阶段列表保留
    sse.push('event: tool_call_finished\ndata: {"tool_name":"knowledge_search","success":true,"duration_ms":12.5}\n\n');
    sse.push('event: routing_decided\ndata: {"primary_agent":"course","supporting_agents":["planning"],"routing_reason":"r","routing_confidence":0.9}\n\n');
    sse.push(`event: answer\ndata: ${JSON.stringify(ANSWER)}\n\n`);
    sse.push("event: done\ndata: {}\n\n");
    sse.close();

    expect(
      await screen.findByText(/CSE 100 covers advanced data structures/i),
    ).toBeInTheDocument();
    const finalList = screen.getByTestId("stage-list");
    expect(finalList).toHaveTextContent("routing_decided");
    expect(finalList).toHaveTextContent("tool_call_finished: knowledge_search");
  });
});

describe("chat error state", () => {
  it("surfaces the stream's error event as a visible error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(ERROR_FRAMES)));

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(
      await screen.findByText(/simulated backend failure/i),
    ).toBeInTheDocument();
  });
});
