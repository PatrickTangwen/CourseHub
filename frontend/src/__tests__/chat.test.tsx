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

const postedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) =>
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
    sse.push('event: tool_call_started\ndata: {"tool_name":"knowledge_search"}\n\n');

    const liveSteps = await screen.findByTestId("process-steps");
    expect(liveSteps).toHaveTextContent("Recalling conversation context");
    expect(liveSteps).toHaveTextContent("Understanding the question");
    expect(liveSteps).toHaveTextContent("Reading course materials");
    expect(
      screen.queryByText(/CSE 100 covers advanced data structures/i),
    ).not.toBeInTheDocument();

    // 完成:答案渲染,时间线收起为一行摘要
    sse.push('event: tool_call_finished\ndata: {"tool_name":"knowledge_search","success":true,"duration_ms":12.5}\n\n');
    sse.push('event: routing_decided\ndata: {"primary_agent":"course","supporting_agents":["planning"],"routing_reason":"intent=course_overview, primary=course","routing_confidence":0.9}\n\n');
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
    expect(toggle).toHaveTextContent("1 lookup");

    // 展开:详情含主/辅 Agent、路由理由、三路分数、工具耗时与原始标识
    await user.click(toggle);
    const steps = screen.getByTestId("process-steps");
    expect(steps).toHaveTextContent("Course Agent (lead)");
    expect(steps).toHaveTextContent("Planning Agent (support)");
    expect(steps).toHaveTextContent("intent=course_overview, primary=course");
    expect(steps).toHaveTextContent("llm 0.90");
    expect(steps).toHaveTextContent("pattern 0.70");
    expect(steps).toHaveTextContent("13ms");
    expect(steps).toHaveTextContent("(knowledge_search)");
    expect(steps).toHaveTextContent("(course_overview)");

    // 再点收起
    await user.click(screen.getByTestId("process-toggle"));
    expect(screen.queryByTestId("process-steps")).not.toBeInTheDocument();
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [body1, body2] = postedBodies(fetchMock);
    expect(body1.conv_id).toBeUndefined();
    expect(body2.conv_id).toBe("c-1"); // 来自首答元数据
    expect(body1.user_id).toMatch(/[0-9a-f-]{36}/);
    expect(body2.user_id).toBe(body1.user_id);
    expect(localStorage.getItem("coursehub.user_id")).toBe(body1.user_id);

    // 新会话:回到空态,发问不带 conv_id
    await user.click(screen.getByRole("button", { name: /new chat/i }));
    await screen.findByText(/welcome to coursehub/i);
    await user.type(
      screen.getByPlaceholderText(/ask about ucsd courses/i),
      "hello there",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(postedBodies(fetchMock)[2].conv_id).toBeUndefined();
    expect(
      await within(sidebar).findByText(/hello there/i),
    ).toBeInTheDocument();

    // 模拟刷新:卸载重挂,localStorage 恢复会话与消息,零网络请求
    first.unmount();
    render(<App />);
    const sidebar2 = screen.getByTestId("thread-sidebar");
    const restoredItem = await within(sidebar2).findByText(/what does cse 100 cover/i);
    const callsBeforeRestore = fetchMock.mock.calls.length;
    await user.click(restoredItem);
    // 该会话有两轮问答,fixture 答案相同 → 恢复后同文出现两次
    const restored = await screen.findAllByText(/CSE 100 covers advanced data structures/i);
    expect(restored.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRestore);
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBodies(fetchMock)[0].message).toBe("What does CSE 100 cover?");
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
