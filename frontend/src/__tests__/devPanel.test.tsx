/**
 * 开发者面板 seam 测试:整树渲染 + 按 URL 分流的 mock fetch。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevPanel } from "../dev/DevPanel";
import App from "../App";

const STATS = { total_chunks: 8368, total_documents: 5974, course_documents: 5968 };
const MONITOR = {
  agent_stats: {
    course_0: { total: 3, success_rate: 1.0, avg_ms: 16738.4, monitor_penalty: 0.4, routing_score: 0.43 },
  },
  tool_stats: {
    knowledge_search: { total: 12, success_rate: 1.0, avg_latency_ms: 61.6, consecutive_fails: 0, circuit_state: "closed" },
  },
  active_alerts: [{ severity: "warning", metric: "agent_avg_ms:course_0", message: "course_0 latency high" }],
};
const SKILLS = {
  root_dir: "/app/skills",
  count: 1,
  skills: [{ name: "课程事实规范", description: "回答安全约束", keywords: ["先修", "gpa"] }],
};
const SKILLS_AFTER_RELOAD = {
  ...SKILLS,
  count: 2,
  skills: [...SKILLS.skills, { name: "新技能", description: "热重载新增", keywords: [] }],
};

const jsonResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as Response;

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("developer panel", () => {
  it("renders knowledge stats, monitor tables and skills; reload updates skills", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/knowledge/stats")) return Promise.resolve(jsonResponse(STATS));
      if (u.includes("/monitor")) return Promise.resolve(jsonResponse(MONITOR));
      if (u.includes("/skills/reload")) return Promise.resolve(jsonResponse(SKILLS_AFTER_RELOAD));
      if (u.includes("/skills")) return Promise.resolve(jsonResponse(SKILLS));
      if (u.includes("/knowledge/add")) {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(
          jsonResponse({ message: `成功导入 1 个文档片段: ${body.documents[0].title}` }),
        );
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DevPanel />);

    // 知识库统计
    expect(await screen.findByText(/8368 chunks/)).toBeInTheDocument();
    // monitor 表格:agent 与工具(含熔断状态)
    expect(await screen.findByText("course_0")).toBeInTheDocument();
    expect(screen.getByText("knowledge_search")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByText(/course_0 latency high/)).toBeInTheDocument();
    // skills 列表
    expect(screen.getByText("课程事实规范")).toBeInTheDocument();

    // skills 热重载
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reload skills/i }));
    expect(await screen.findByText("新技能")).toBeInTheDocument();
    const reloadCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/skills/reload"));
    expect(reloadCall?.[1]?.method).toBe("POST");

    // 知识库导入
    await user.type(screen.getByPlaceholderText(/document title/i), "CSE 100 tips");
    await user.type(screen.getByPlaceholderText(/document content/i), "Practice B-trees.");
    await user.click(screen.getByRole("button", { name: /add document/i }));
    expect(await screen.findByText(/成功导入 1 个文档片段: CSE 100 tips/)).toBeInTheDocument();
    const addCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/knowledge/add"));
    expect(JSON.parse(String(addCall?.[1]?.body)).documents[0].content).toBe("Practice B-trees.");
  });

  it("has no navigation entry to /dev in the chat UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response),
    );
    render(<App />);
    expect(document.querySelector('a[href="/dev"]')).toBeNull();
  });
});
