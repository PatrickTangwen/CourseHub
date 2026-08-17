/**
 * Demo Mode seam 测试:与 chat.test.tsx 同一 seam(整树渲染 + SSE 流),
 * 但数据来自实录 fixture,经 installDemoBackend 的页内 fetch 路由回放。
 * 断言:实录事件全部通过严格 decoder;回放全程零真实网络请求。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { decodeStageEvent, isStageEventName } from "../lib/stages";
import { DEMO_SESSIONS } from "../demo/sessions";
import { installDemoBackend } from "../demo/demoBackend";
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

    // 实录答案经打字机完整渲染(fixture 中的真实课程内容)
    expect(
      await screen.findByText(/advanced data structures/i, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();

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
