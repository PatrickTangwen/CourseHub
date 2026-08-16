/**
 * 开发者面板 seam 测试:整树渲染 + 按 URL 分流的 mock fetch。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  active_alerts: [
    {
      severity: "warning",
      metric: "agent_avg_ms:course_0",
      message: "course_0 latency high",
      count: 12,
    },
  ],
};
const SKILLS = {
  root_dir: "/app/skills",
  count: 1,
  skills: [
    {
      name: "课程事实规范",
      description: "回答安全约束",
      path: "/app/skills/course_facts/SKILL.md",
      keywords: ["先修", "gpa"],
      agents: ["course"],
      enabled: true,
      content_chars: 34,
      content: "## 回答安全约束\n\n名额必须注明快照时间。",
    },
  ],
};
const SKILLS_AFTER_RELOAD = {
  ...SKILLS,
  count: 2,
  skills: [
    ...SKILLS.skills,
    {
      name: "新技能",
      description: "热重载新增",
      path: "/app/skills/new/SKILL.md",
      keywords: [],
      agents: [],
      enabled: true,
      content_chars: 5,
      content: "新规则。",
    },
  ],
};

const jsonResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as Response;

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

const makeFetchMock = () =>
  vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/knowledge/stats")) return Promise.resolve(jsonResponse(STATS));
    if (u.includes("/monitor")) return Promise.resolve(jsonResponse(MONITOR));
    if (u.includes("/skills/reload")) return Promise.resolve(jsonResponse(SKILLS_AFTER_RELOAD));
    if (u.includes("/skills")) return Promise.resolve(jsonResponse(SKILLS));
    if (u.includes("/health")) return Promise.resolve({ ok: true, status: 200 } as Response);
    if (u.includes("/knowledge/add")) {
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(
        jsonResponse({
          added_chunks: 1,
          total_chunks: STATS.total_chunks + 1,
          title: body.documents[0].title,
        }),
      );
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });

describe("developer panel", () => {
  it("renders knowledge stats, monitor tables and skills; reload updates skills", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<DevPanel />);

    // 知识库统计
    expect(await screen.findByText(/8368 chunks/)).toBeInTheDocument();
    // monitor 表格:agent 与工具(含熔断状态)
    expect(await screen.findByText("course_0")).toBeInTheDocument();
    expect(screen.getByText("knowledge_search")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
    // 告警默认折叠(线上会持续超标,展开着就是刷屏),摘要行给出条数
    const alerts = screen.getByTestId("monitor-alerts");
    expect(alerts).not.toHaveAttribute("open");
    expect(alerts).toHaveTextContent("1 active alert");
    expect(screen.getByText(/course_0 latency high/)).toBeInTheDocument();
    // 重复触发次数收在同一条里,不再一条条堆
    expect(screen.getByText(/×12/)).toBeInTheDocument();
    // skills 列表
    expect(screen.getByText("课程事实规范")).toBeInTheDocument();
    expect(screen.queryByText(/名额必须注明快照时间/)).not.toBeInTheDocument();

    // 整行可点击展开详情,再次点击收起
    const skillToggle = screen.getByRole("button", { name: /课程事实规范/ });
    expect(skillToggle).toHaveAttribute("aria-expanded", "false");
    const user = userEvent.setup();
    await user.click(skillToggle);
    expect(skillToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/名额必须注明快照时间/)).toBeInTheDocument();
    expect(screen.getByText("course")).toBeInTheDocument();
    expect(screen.getByText("先修")).toBeInTheDocument();
    await user.click(skillToggle);
    expect(screen.queryByText(/名额必须注明快照时间/)).not.toBeInTheDocument();

    // skills 热重载
    await user.click(screen.getByRole("button", { name: /reload skills/i }));
    expect(await screen.findByText("新技能")).toBeInTheDocument();
    const reloadCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/skills/reload"));
    expect(reloadCall?.[1]?.method).toBe("POST");

    // 知识库导入
    await user.type(screen.getByPlaceholderText(/document title/i), "CSE 100 tips");
    await user.type(screen.getByPlaceholderText(/document content/i), "Practice B-trees.");
    await user.click(screen.getByRole("button", { name: /add document/i }));
    expect(await screen.findByText(/imported 1 document chunk/i)).toBeInTheDocument();
    const addCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/knowledge/add"));
    expect(JSON.parse(String(addCall?.[1]?.body)).documents[0].content).toBe("Practice B-trees.");
  });

  it("takes over the main area from the sidebar entry, and hands it back to chat", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    render(<App />);
    const user = userEvent.setup();

    // 默认主区是聊天
    expect(
      await screen.findByPlaceholderText(/ask about ucsd courses/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /developer/i }));
    expect(await screen.findByText(/8368 chunks/)).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/ask about ucsd courses/i),
    ).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/dev");

    // 会话列表始终在侧边栏;新建会话把主区交回聊天
    const sidebar = screen.getByTestId("thread-sidebar");
    await user.click(within(sidebar).getByRole("button", { name: /new chat/i }));
    expect(
      await screen.findByPlaceholderText(/ask about ucsd courses/i),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("returns to chat from the panel header without reloading the page", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /developer/i }));
    expect(await screen.findByText(/8368 chunks/)).toBeInTheDocument();

    // 面板自己的返回按钮:走同一套视图切换,不是 <a href="/"> 整页刷新
    const panel = screen.getByRole("heading", { name: /developer panel/i }).parentElement!;
    await user.click(within(panel).getByRole("button", { name: /back to chat/i }));

    expect(
      await screen.findByPlaceholderText(/ask about ucsd courses/i),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(document.querySelector('a[href="/"]')).toBeNull();
  });

  it("still honours the /dev deep link (nginx SPA fallback contract)", async () => {
    window.history.pushState(null, "", "/dev");
    vi.stubGlobal("fetch", makeFetchMock());
    render(<App />);
    expect(await screen.findByText(/8368 chunks/)).toBeInTheDocument();
  });

  it("shows a visible failure notice when a mutation loses the network", async () => {
    const baseFetch = makeFetchMock();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) =>
        String(url).includes("/skills/reload")
          ? Promise.reject(new TypeError("network down"))
          : baseFetch(url, init),
      ),
    );
    render(<DevPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /reload skills/i }));
    expect(await screen.findByText(/skills reload failed/i)).toBeInTheDocument();
  });
});
