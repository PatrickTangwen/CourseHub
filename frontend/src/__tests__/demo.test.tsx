/**
 * Demo Mode seam 测试:与 chat.test.tsx 同一 seam(整树渲染 + SSE 流),
 * 但数据来自实录 fixture,经 installDemoBackend 的页内 fetch 路由回放。
 * 断言:实录事件全部通过严格 decoder;回放全程零真实网络请求。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { decodeStageEvent, isStageEventName } from "../lib/stages";
import { DEMO_SESSIONS } from "../demo/sessions";
import { installDemoBackend } from "../demo/demoBackend";
import { DemoShell } from "../demo/DemoShell";
import { seedDemoThreads } from "../demo/seed";
import panelSnapshots from "../demo/fixtures/panel-snapshots.json";
import type { ChatAnswer } from "../lib/chatApi";

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("recorded fixtures (admission gate)", () => {
  it("contains at least one session, each turn ending in answer + done", () => {
    expect(DEMO_SESSIONS.length).toBeGreaterThan(0);
    for (const session of DEMO_SESSIONS) {
      expect(session.turns.length).toBeGreaterThan(0);
      for (const turn of session.turns) {
        const names = turn.events.map((e) => e.event);
        expect(names).toContain("answer");
        expect(names.at(-1)).toBe("done");
      }
    }
  });

  it("passes every recorded stage event through the strict decoder", () => {
    for (const session of DEMO_SESSIONS) {
      for (const turn of session.turns) {
        const stageEvents = turn.events.filter((e) => isStageEventName(e.event));
        expect(stageEvents.length).toBeGreaterThan(0);
        for (const e of stageEvents) {
          const name = e.event;
          if (!isStageEventName(name)) continue;
          expect(() => decodeStageEvent(name, e.data)).not.toThrow();
        }
        const answer = turn.events.find((e) => e.event === "answer");
        const data = answer?.data as ChatAnswer;
        expect(typeof data.conv_id).toBe("string");
        expect(typeof data.response).toBe("string");
        expect(data.response.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("recorded session inventory (T2 acceptance)", () => {
  const byId = (id: string) => {
    const session = DEMO_SESSIONS.find((s) => s.id === id);
    expect(session, `missing session ${id}`).toBeDefined();
    return session!;
  };
  const answerOf = (sessionId: string, turn: number) =>
    byId(sessionId).turns[turn].events.find((e) => e.event === "answer")
      ?.data as ChatAnswer;

  it("covers all six confirmed sessions", () => {
    expect(DEMO_SESSIONS.map((s) => s.id).sort()).toEqual(
      [
        "advisor-referral",
        "cse100-overview",
        "cse100-prereqs-zh",
        "cse101-instructor",
        "cse110-multiturn",
        "planning-sequence-zh",
      ].sort(),
    );
  });

  it("answers Chinese questions in Chinese and English questions in English", () => {
    const hasCJK = (text: string) => /[一-鿿]/.test(text);
    expect(hasCJK(answerOf("cse100-prereqs-zh", 0).response)).toBe(true);
    expect(hasCJK(answerOf("planning-sequence-zh", 0).response)).toBe(true);
    expect(hasCJK(answerOf("cse100-overview", 0).response)).toBe(false);
    expect(hasCJK(answerOf("cse101-instructor", 0).response)).toBe(false);
  });

  it("planning session carries a GFM table and the planning disclaimer", () => {
    const responses = byId("planning-sequence-zh").turns.map(
      (turn) =>
        (turn.events.find((e) => e.event === "answer")?.data as ChatAnswer)
          .response,
    );
    expect(responses.some((r) => /\|.+\|\n\|[-\s|:]+\|/.test(r))).toBe(true);
    expect(responses.some((r) => /非官方/.test(r))).toBe(true);
  });

  it("advisor-referral session is escalated", () => {
    expect(answerOf("advisor-referral", 0).escalated).toBe(true);
  });

  it("multi-turn session chains conv_id across turns", () => {
    const session = byId("cse110-multiturn");
    expect(session.turns.length).toBeGreaterThanOrEqual(2);
    const convIds = session.turns.map(
      (turn) =>
        (turn.events.find((e) => e.event === "answer")?.data as ChatAnswer)
          .conv_id,
    );
    expect(new Set(convIds).size).toBe(1);
  });

  it("panel snapshots carry the three dev-panel endpoints", () => {
    expect(panelSnapshots.knowledge_stats.total_chunks).toBeGreaterThan(0);
    expect(
      Object.keys(panelSnapshots.monitor.agent_stats).length,
    ).toBeGreaterThan(0);
    expect(panelSnapshots.skills.count).toBe(panelSnapshots.skills.skills.length);
  });
});

describe("Demo Notice for free input (T3)", () => {
  function setup() {
    const realFetch = vi.fn(() => {
      throw new Error("real network was hit in demo mode");
    });
    vi.stubGlobal("fetch", realFetch);
    installDemoBackend();
    render(<DemoShell />);
    return { user: userEvent.setup(), realFetch };
  }
  async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(screen.getByPlaceholderText(/ask about ucsd courses/i), text);
    await user.click(screen.getByRole("button", { name: /send/i }));
  }

  it("answers unscripted English input with the English notice and no timeline", async () => {
    const { user, realFetch } = setup();
    await screen.findByText("What does CSE 100 cover?");
    await send(user, "tell me a joke");
    expect(
      await screen.findByText(/this is a scripted demo/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("process-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("process-steps")).not.toBeInTheDocument();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("answers input containing CJK with the Chinese notice, no forbidden wording", async () => {
    const { user } = setup();
    await screen.findByText("What does CSE 100 cover?");
    await send(user, "给我讲个笑话");
    const hits = await screen.findAllByText(/这是一个脚本化演示页/);
    expect(hits.length).toBeGreaterThan(0);
    // 加粗必须真的渲染成 <strong>(CJK 标点紧邻 ** 会破坏 CommonMark 解析)
    expect(hits.some((el) => el.tagName === "STRONG")).toBe(true);
    expect(document.body.textContent).not.toMatch(/human handoff|转人工/);
    expect(document.body.textContent).not.toContain("**");
  });

  it("replays a recorded session when typed input matches after normalization", async () => {
    const { user } = setup();
    await screen.findByText("What does CSE 100 cover?");
    await send(user, "  WHAT DOES cse 100 cover?  ");
    // findAll:短语出现在行内加粗里,<strong> 与外层 <p> 会同时命中
    const hits = await screen.findAllByText(/advanced data structures/i, undefined, {
      timeout: 8000,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(screen.queryByText(/this is a scripted demo/i)).not.toBeInTheDocument();
  }, 15000);

  it("clicking a suggested question inside the notice replays that session", async () => {
    const { user } = setup();
    await screen.findByText("What does CSE 100 cover?");
    await send(user, "hello");
    await screen.findByText(/this is a scripted demo/i);
    await user.click(
      screen.getByRole("link", { name: "Who teaches CSE 101 in FA26?" }),
    );
    const hits = await screen.findAllByText(/miles jones/i, undefined, {
      timeout: 8000,
    });
    expect(hits.length).toBeGreaterThan(0);
  }, 15000);
});

describe("first-visit seeding (T4)", () => {
  function setupSeeded() {
    const realFetch = vi.fn(() => {
      throw new Error("real network was hit in demo mode");
    });
    vi.stubGlobal("fetch", realFetch);
    installDemoBackend();
    seedDemoThreads();
    return render(<DemoShell />);
  }

  it("lands on the planning thread: table, disclaimer, six threads in sidebar", async () => {
    setupSeeded();
    // 落地即最新会话(修课规划),含 GFM 表格与免责声明,无需任何点击
    expect(
      await screen.findByRole("table", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/本建议为非官方参考/),
    ).toBeInTheDocument();
    const sidebar = screen.getByTestId("thread-sidebar");
    expect(
      within(sidebar).getAllByRole("button", { name: /delete chat/i }),
    ).toHaveLength(6);
  }, 15000);

  it("seeds only once: a deleted thread stays deleted after reload", async () => {
    const first = setupSeeded();
    await screen.findByRole("table", undefined, { timeout: 5000 });
    const sidebar = screen.getByTestId("thread-sidebar");
    const user = userEvent.setup();
    await user.click(
      within(sidebar).getAllByRole("button", { name: /delete chat/i })[0],
    );
    await vi.waitFor(() =>
      expect(
        within(sidebar).getAllByRole("button", { name: /delete chat/i }),
      ).toHaveLength(5),
    );
    // 模拟刷新:重新走 demo 入口的播种 + 挂载
    first.unmount();
    seedDemoThreads();
    render(<DemoShell />);
    const sidebar2 = screen.getByTestId("thread-sidebar");
    await vi.waitFor(() =>
      expect(
        within(sidebar2).getAllByRole("button", { name: /delete chat/i }),
      ).toHaveLength(5),
    );
  }, 15000);

  it("new chat still reaches the welcome state", async () => {
    setupSeeded();
    await screen.findByRole("table", undefined, { timeout: 5000 });
    const user = userEvent.setup();
    const sidebar = screen.getByTestId("thread-sidebar");
    await user.click(within(sidebar).getByRole("button", { name: /new chat/i }));
    expect(
      await screen.findByText(/welcome to coursehub/i),
    ).toBeInTheDocument();
  }, 15000);
});

describe("demo replay through the real frontend", () => {
  it("replays the recorded CSE 100 session with zero real network requests", async () => {
    const realFetch = vi.fn(() => {
      throw new Error("real network was hit in demo mode");
    });
    vi.stubGlobal("fetch", realFetch);
    installDemoBackend();

    render(<App />);
    const user = userEvent.setup();

    // 空态就绪后点击示例提问,触发实录回放
    await user.click(await screen.findByText("What does CSE 100 cover?"));

    // 实录答案经打字机完整渲染;findAll 因 <strong> 与外层 <p> 会同时命中
    const answerHits = await screen.findAllByText(
      /advanced data structures/i,
      undefined,
      { timeout: 8000 },
    );
    expect(answerHits.length).toBeGreaterThan(0);

    // 时间线收起为一行摘要:实录里是 Course Agent + 5 次工具调用
    const toggle = await screen.findByTestId("process-toggle");
    expect(toggle).toHaveTextContent("Course Agent");
    expect(toggle).toHaveTextContent(/tool calls/);

    // 健康点由 demo 路由喂 200,显示 Connected
    expect(
      await screen.findByRole("status", { name: /backend connected/i }),
    ).toBeInTheDocument();

    expect(realFetch).not.toHaveBeenCalled();
  });
});
