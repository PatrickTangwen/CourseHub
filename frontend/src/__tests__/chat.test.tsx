/**
 * 前端 seam 测试:整树渲染 + mock fetch 提供 fixture SSE 流。
 * 只断言用户可见行为(答案渲染、错误态、会话持久化),不触碰内部实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  localStorage.clear();
});

/** 只统计聊天请求(排除 /health 轮询)。 */
const chatCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat"));

const postedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
  chatCalls(fetchMock).map(([, init]) =>
    JSON.parse(String((init as RequestInit).body)),
  );

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
    expect(screen.queryByTestId("referral-card")).not.toBeInTheDocument();

    expect(chatCalls(fetchMock)).toHaveLength(1);
    const [url, init] = chatCalls(fetchMock)[0] as [string, RequestInit];
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

  it("shows the live timeline during streaming, collapses on completion, expands on toggle", async () => {
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

    // 流式进行中:时间线实时展开,领域友好术语,答案尚未到达
    sse.push('event: run_started\ndata: {"conv_id":"c-1"}\n\n');
    sse.push('event: memory_recalled\ndata: {"working_messages":1,"episodic_hits":2,"has_profile":true,"has_summary":false}\n\n');
    sse.push('event: intent_recognized\ndata: {"intent":"course_overview","intent_group":"facts","intent_confidence":0.93,"intent_source_scores":{"llm":0.9,"embedding":0,"pattern":0.7}}\n\n');
    sse.push('event: routing_decided\ndata: {"primary_agent":"course","supporting_agents":["planning"],"routing_reason":"intent=course_overview, primary=course","routing_confidence":0.9}\n\n');
    sse.push('event: tool_call_started\ndata: {"tool_name":"knowledge_search"}\n\n');

    const liveSteps = await screen.findByTestId("process-steps");
    expect(liveSteps).toHaveTextContent("Recalling conversation context");
    expect(liveSteps).toHaveTextContent("Understanding the question");
    const activeToolLabel = within(liveSteps).getByText(/Reading course materials/);
    expect(activeToolLabel).toHaveClass("process-step-shimmer");
    expect(
      screen.queryByText(/CSE 100 covers advanced data structures/i),
    ).not.toBeInTheDocument();

    // 完成:答案渲染,时间线收起为一行摘要
    sse.push('event: tool_call_finished\ndata: {"tool_name":"knowledge_search","success":true,"duration_ms":12.5}\n\n');
    sse.push(`event: answer\ndata: ${JSON.stringify(ANSWER)}\n\n`);
    sse.push("event: done\ndata: {}\n\n");
    sse.close();

    expect(
      await screen.findByText(/CSE 100 covers advanced data structures/i),
    ).toBeInTheDocument();

    const toggle = await screen.findByTestId("process-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("process-steps")).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent("Course Agent");
    expect(toggle).toHaveTextContent("1 tool call");

    // 展开:详情含主/辅 Agent、路由理由、三路分数、工具耗时与原始标识
    await user.click(toggle);
    const steps = screen.getByTestId("process-steps");
    expect(within(steps).getByText(/Reading course materials/)).not.toHaveClass(
      "process-step-shimmer",
    );
    expect(steps).toHaveTextContent("Course Agent (lead)");
    expect(steps).toHaveTextContent("Planning Agent (support)");
    expect(steps).toHaveTextContent("intent=course_overview, primary=course");
    // 三路信号用人话标签呈现;没出力的一路是 "no signal" 而不是误导性的 0.00
    expect(steps).toHaveTextContent("Intent signals");
    const llmSignal = within(steps).getByTestId("signal-llm");
    expect(llmSignal).toHaveTextContent("LLM classifier");
    expect(llmSignal).toHaveTextContent("0.90");
    expect(llmSignal).toHaveTextContent("lead");
    const embeddingSignal = within(steps).getByTestId("signal-embedding");
    expect(embeddingSignal).toHaveTextContent("Embedding similarity");
    expect(embeddingSignal).toHaveTextContent("no signal");
    expect(within(steps).getByTestId("signal-pattern")).toHaveTextContent("0.70");
    expect(steps).not.toHaveTextContent("embedding 0.00");
    expect(steps).not.toHaveTextContent("13ms");
    expect(steps).toHaveTextContent("(knowledge_search)");
    expect(steps).toHaveTextContent("(course_overview)");

    // 再点收起
    await user.click(screen.getByTestId("process-toggle"));
    expect(screen.queryByTestId("process-steps")).not.toBeInTheDocument();
  });

  it("preserves out-of-order tool results and shows complete memory and tool status", async () => {
    const frames =
      'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
      'event: memory_recalled\ndata: {"working_messages":2,"episodic_hits":1,"has_profile":true,"has_summary":true}\n\n' +
      'event: intent_recognized\ndata: {"intent":"course_overview","intent_group":"facts","intent_confidence":0.93,"intent_source_scores":{"llm":0.9,"embedding":0,"pattern":0.7}}\n\n' +
      'event: routing_decided\ndata: {"primary_agent":"course","supporting_agents":[],"routing_reason":"facts → course","routing_confidence":0.9}\n\n' +
      'event: tool_call_finished\ndata: {"tool_name":"course_lookup","success":true,"duration_ms":8.4}\n\n' +
      'event: tool_call_started\ndata: {"tool_name":"course_lookup"}\n\n' +
      `event: answer\ndata: ${JSON.stringify(ANSWER)}\n\n` +
      "event: done\ndata: {}\n\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(frames)));

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "What does CSE 100 cover?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/CSE 100 covers advanced data structures/i);

    await user.click(await screen.findByTestId("process-toggle"));
    const steps = screen.getByTestId("process-steps");
    expect(steps).toHaveTextContent("profile available");
    expect(steps).toHaveTextContent("summary available");
    expect(steps).not.toHaveTextContent("8ms");
    expect(steps).toHaveTextContent("succeeded");
  });
});

describe("multi-conversation & browser identity (T4)", () => {
  it("keeps user_id stable, continues conv_id in-thread, restores threads after reload", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponse(OK_FRAMES)));
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<App />);
    const user = userEvent.setup();

    // 第一问
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "What does CSE 100 cover?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/CSE 100 covers advanced data structures/i);

    // 会话标题(首问摘要)出现在侧边栏
    const sidebar = screen.getByTestId("thread-sidebar");
    expect(
      await within(sidebar).findByText(/what does cse 100 cover/i),
    ).toBeInTheDocument();

    // 同一会话第二问:conv_id 延续、user_id 稳定
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "And the prerequisites?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await vi.waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(2));

    const [body1, body2] = postedBodies(fetchMock);
    expect(body1.conv_id).toBeUndefined();
    expect(body2.conv_id).toBe("c-1"); // 来自首答元数据
    expect(body1.user_id).toMatch(/[0-9a-f-]{36}/);
    expect(body2.user_id).toBe(body1.user_id);
    expect(localStorage.getItem("coursehub.user_id")).toBe(body1.user_id);

    // 新会话:回到空态,发问不带 conv_id(输入框工具条上也有一个同名按钮,故限定侧边栏)
    await user.click(within(sidebar).getByRole("button", { name: /new chat/i }));
    await screen.findByText(/welcome to coursehub/i);
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "hello there",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await vi.waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(3));
    expect(postedBodies(fetchMock)[2].conv_id).toBeUndefined();
    expect(
      await within(sidebar).findByText(/hello there/i),
    ).toBeInTheDocument();

    // 模拟刷新:卸载重挂,localStorage 恢复会话与消息,零网络请求
    first.unmount();
    render(<App />);
    const sidebar2 = screen.getByTestId("thread-sidebar");
    const restoredItem = await within(sidebar2).findByText(/what does cse 100 cover/i);
    const callsBeforeRestore = chatCalls(fetchMock).length;
    await user.click(restoredItem);
    // 该会话有两轮问答,fixture 答案相同 → 恢复后同文出现两次
    const restored = await screen.findAllByText(/CSE 100 covers advanced data structures/i);
    expect(restored.length).toBeGreaterThanOrEqual(1);
    expect(chatCalls(fetchMock).length).toBe(callsBeforeRestore);
  });

  it("deletes a conversation from the sidebar", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponse(OK_FRAMES)));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "What does CSE 100 cover?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/CSE 100 covers advanced data structures/i);

    const sidebar = screen.getByTestId("thread-sidebar");
    await within(sidebar).findByText(/what does cse 100 cover/i);
    await user.click(within(sidebar).getByRole("button", { name: /delete chat/i }));
    await vi.waitFor(() =>
      expect(
        within(sidebar).queryByText(/what does cse 100 cover/i),
      ).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("coursehub.threads.v1")).not.toContain("What does");
  });

  it("sends an example prompt (bilingual empty state) on click", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponse(OK_FRAMES)));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    // 线程列表异步就绪后空态才渲染
    expect(await screen.findByText("CSE 100 有哪些先修要求?")).toBeInTheDocument();
    await user.click(screen.getByText("What does CSE 100 cover?"));
    await vi.waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1));
    expect(postedBodies(fetchMock)[0].message).toBe("What does CSE 100 cover?");
  });
});

describe("domain constraints & resilience (T5)", () => {
  const healthOk = { ok: true, status: 200 } as Response;

  it("renders the Advisor Referral card on escalated answers, with official channels and no human-handoff wording", async () => {
    const referralAnswer: ChatAnswer = {
      ...ANSWER,
      escalated: true,
      intent: "advisor_referral",
      intent_group: "escalation",
      response:
        "An enrollment hold is case-specific, so I can't resolve it here.",
    };
    const frames =
      'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
      `event: answer\ndata: ${JSON.stringify(referralAnswer)}\n\n` +
      "event: done\ndata: {}\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("/health") ? healthOk : okResponse(frames),
        ),
      ),
    );

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "I have an enrollment hold, can you remove it?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    const card = await screen.findByTestId("referral-card");
    expect(card).toHaveTextContent(/official channel/i);
    expect(card).toHaveTextContent("Virtual Advising Center (VAC)");
    expect(card).toHaveTextContent(/department's advisors/i);
    expect(card).toHaveTextContent(/webreg support/i);
    expect(document.body.textContent).not.toMatch(/human handoff|转人工/);
  });

  it("keeps the planning disclaimer and snapshot timestamp visible in the rendered markdown", async () => {
    const planningAnswer: ChatAnswer = {
      ...ANSWER,
      intent: "professor_choice",
      intent_group: "planning",
      primary_agent: "planning",
      response:
        "Historically stronger outcomes:\n\n" +
        "| Term | Instructor | GPA |\n|---|---|---|\n| FA24 | Moshiri, Niema | 3.539 |\n\n" +
        "Seats: 12 available as of the 2026-08-12T16:39:36Z snapshot (not real-time).\n\n" +
        "本建议为非官方参考,选课决策请咨询学校学业顾问。",
    };
    const frames =
      'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
      `event: answer\ndata: ${JSON.stringify(planningAnswer)}\n\n` +
      "event: done\ndata: {}\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("/health") ? healthOk : okResponse(frames),
        ),
      ),
    );

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "Which professor should I take?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(
      await screen.findByText(/本建议为非官方参考/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2026-08-12T16:39:36Z snapshot \(not real-time\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Moshiri, Niema")).toBeInTheDocument();
  });

  it("falls back to POST /chat once when the stream cannot be established", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health")) return Promise.resolve(healthOk);
      if (u.includes("/chat/stream")) return Promise.reject(new TypeError("network down"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ANSWER,
      } as Response);
    });
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
    const urls = chatCalls(fetchMock).map(([url]) => String(url));
    expect(urls).toEqual(["/api/chat/stream", "/api/chat"]);
  });

  it("falls back to POST /chat once when an established stream disconnects before answer", async () => {
    const interruptedFrames =
      'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
      'event: memory_recalled\ndata: {"working_messages":0,"episodic_hits":0,"has_profile":false,"has_summary":false}\n\n';
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health")) return Promise.resolve(healthOk);
      if (u.includes("/chat/stream")) {
        return Promise.resolve(okResponse(interruptedFrames));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ANSWER,
      } as Response);
    });
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
    expect(screen.queryByTestId("process-timeline")).not.toBeInTheDocument();
    const urls = chatCalls(fetchMock).map(([url]) => String(url));
    expect(urls).toEqual(["/api/chat/stream", "/api/chat"]);
  });

  it("shows an error bubble with Retry when both paths fail; Retry refires the run", async () => {
    let healthy = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/health")) return Promise.resolve(healthOk);
      if (!healthy) {
        if (u.includes("/chat/stream")) return Promise.reject(new TypeError("down"));
        return Promise.resolve({ ok: false, status: 503 } as Response);
      }
      return Promise.resolve(okResponse(OK_FRAMES));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/request failed/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });

    healthy = true;
    await user.click(retry);
    expect(
      await screen.findByText(/CSE 100 covers advanced data structures/i),
    ).toBeInTheDocument();
  });

  it("reflects backend health in the composer indicator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        String(url).includes("/health")
          ? Promise.resolve({ ok: false, status: 503 } as Response)
          : Promise.resolve(okResponse(OK_FRAMES)),
      ),
    );
    render(<App />);
    expect(
      await screen.findByRole("status", { name: /backend unreachable/i }),
    ).toBeInTheDocument();
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
