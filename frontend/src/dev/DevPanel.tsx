import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/chatApi";

/**
 * 开发者面板(/dev 隐藏路由,不入导航、无鉴权):
 * 知识库管理 + monitor 摘要 + skills 热重载。学生主流程零调试污染。
 */

interface KnowledgeStats {
  total_chunks: number;
  total_documents: number;
  course_documents: number;
}

interface AgentStat {
  total: number;
  success_rate: number;
  avg_ms: number;
  monitor_penalty: number;
  routing_score: number;
}

interface ToolStat {
  total: number;
  success_rate: number;
  avg_latency_ms: number;
  consecutive_fails: number;
  circuit_state: string;
}

interface MonitorSummary {
  agent_stats: Record<string, AgentStat>;
  tool_stats: Record<string, ToolStat>;
  active_alerts: { severity: string; metric: string; message: string }[];
}

interface SkillsSummary {
  root_dir: string;
  count: number;
  skills: { name: string; description: string; keywords: string[] }[];
}

const card =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const th = "px-2 py-1.5 text-left font-medium text-zinc-500 dark:text-zinc-400";
const td = "px-2 py-1.5";
const button =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export const DevPanel = () => {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [monitor, setMonitor] = useState<MonitorSummary | null>(null);
  const [skills, setSkills] = useState<SkillsSummary | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const loadAll = useCallback(async () => {
    const grab = async <T,>(path: string): Promise<T | null> => {
      try {
        const res = await fetch(`${API_BASE}${path}`);
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [s, m, k] = await Promise.all([
      grab<KnowledgeStats>("/knowledge/stats"),
      grab<MonitorSummary>("/monitor"),
      grab<SkillsSummary>("/skills"),
    ]);
    setStats(s);
    setMonitor(m);
    setSkills(k);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const reloadSkills = async () => {
    const res = await fetch(`${API_BASE}/skills/reload`, { method: "POST" });
    if (res.ok) {
      setSkills((await res.json()) as SkillsSummary);
      setNotice("Skills reloaded.");
    } else {
      setNotice("Skills reload failed.");
    }
  };

  const addDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE}/knowledge/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [{ title, content }] }),
    });
    if (res.ok) {
      const data = (await res.json()) as { message: string };
      setNotice(data.message);
      setTitle("");
      setContent("");
      void loadAll();
    } else {
      setNotice("Import failed.");
    }
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/knowledge/upload`, {
      method: "POST",
      body: form,
    });
    if (res.ok) {
      const data = (await res.json()) as { message: string };
      setNotice(data.message);
      void loadAll();
    } else {
      setNotice("Upload failed.");
    }
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="min-h-dvh bg-zinc-50 p-6 text-sm text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">CourseHub Developer Panel</h1>
          <a href="/" className="text-xs text-zinc-500 underline">
            back to chat
          </a>
          <button type="button" onClick={() => void loadAll()} className={`${button} ml-auto`}>
            Refresh
          </button>
        </header>

        {notice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {notice}
          </p>
        )}

        <section className={card} aria-label="Knowledge base">
          <h2 className="mb-3 font-semibold">Knowledge base</h2>
          {stats ? (
            <p className="mb-3 text-zinc-600 dark:text-zinc-300">
              {stats.total_chunks} chunks · {stats.total_documents} documents ·{" "}
              {stats.course_documents} course documents
            </p>
          ) : (
            <p className="mb-3 text-zinc-400">Stats unavailable.</p>
          )}
          <form onSubmit={addDocument} className="flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title"
              required
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 dark:border-zinc-700"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Document content"
              required
              rows={3}
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 dark:border-zinc-700"
            />
            <div className="flex items-center gap-3">
              <button type="submit" className={button}>
                Add document
              </button>
              <label className={`${button} cursor-pointer`}>
                Upload file (.txt / .md / .json)
                <input
                  type="file"
                  accept=".txt,.md,.json"
                  className="hidden"
                  onChange={(e) => void uploadFile(e.target.files?.[0])}
                />
              </label>
            </div>
          </form>
        </section>

        <section className={card} aria-label="Monitor">
          <h2 className="mb-3 font-semibold">Monitor</h2>
          {monitor ? (
            <div className="flex flex-col gap-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className={th}>Agent</th>
                    <th className={th}>Runs</th>
                    <th className={th}>Success</th>
                    <th className={th}>Avg ms</th>
                    <th className={th}>Penalty</th>
                    <th className={th}>Routing score</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(monitor.agent_stats).map(([name, s]) => (
                    <tr key={name} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className={td}>{name}</td>
                      <td className={td}>{s.total}</td>
                      <td className={td}>{pct(s.success_rate)}</td>
                      <td className={td}>{Math.round(s.avg_ms)}</td>
                      <td className={td}>{s.monitor_penalty.toFixed(3)}</td>
                      <td className={td}>{s.routing_score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className={th}>Tool</th>
                    <th className={th}>Calls</th>
                    <th className={th}>Success</th>
                    <th className={th}>Avg latency ms</th>
                    <th className={th}>Circuit</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(monitor.tool_stats).map(([name, s]) => (
                    <tr key={name} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className={td}>{name}</td>
                      <td className={td}>{s.total}</td>
                      <td className={td}>{pct(s.success_rate)}</td>
                      <td className={td}>{s.avg_latency_ms.toFixed(1)}</td>
                      <td className={td}>{s.circuit_state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {monitor.active_alerts.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {monitor.active_alerts.map((alert, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    >
                      [{alert.severity}] {alert.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-zinc-400">Monitor unavailable.</p>
          )}
        </section>

        <section className={card} aria-label="Skills">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-semibold">Skills</h2>
            <button type="button" onClick={() => void reloadSkills()} className={button}>
              Reload skills
            </button>
          </div>
          {skills ? (
            <ul className="flex flex-col gap-2">
              {skills.skills.map((skill) => (
                <li key={skill.name}>
                  <span className="font-medium">{skill.name}</span>
                  <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                    {skill.description}
                  </span>
                  <span className="ml-2 text-xs text-zinc-400">
                    {skill.keywords.length} keywords
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-400">Skills unavailable.</p>
          )}
        </section>
      </div>
    </div>
  );
};
