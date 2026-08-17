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
