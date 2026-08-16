import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/chatApi";
import { ArrowLeftIcon } from "../components/icons";
import { DEV_STRINGS } from "../lib/strings";

interface DevPanelProps {
  /** 把主区交回聊天;独立渲染(无宿主视图)时不给,按钮就不出现。 */
  onBackToChat?: () => void;
}

/**
 * 开发者面板(侧边栏底部入口 / /dev 深链,无鉴权):
 * 知识库管理 + monitor 摘要 + skills 热重载。占据主区,聊天区不受污染。
 * 生产环境要屏蔽的是它依赖的后端端点(见 nginx.conf 注释),不是这个入口。
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
  active_alerts: {
    severity: string;
    metric: string;
    message: string;
    /** 同一指标持续超标的累计触发次数(后端已去重,不再一次一条)。 */
    count: number;
  }[];
}

interface SkillsSummary {
  root_dir: string;
  count: number;
  skills: {
    name: string;
    description: string;
    path: string;
    keywords: string[];
    agents: string[];
    enabled: boolean;
    content_chars: number;
    content?: string;
  }[];
}

const card = "rounded-xl border border-border bg-card p-4 text-card-foreground";
const th = "px-2 py-1.5 text-left font-medium text-muted-foreground";
const td = "px-2 py-1.5";
const button =
  "rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground";

export const DevPanel = ({ onBackToChat }: DevPanelProps) => {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [monitor, setMonitor] = useState<MonitorSummary | null>(null);
  const [skills, setSkills] = useState<SkillsSummary | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState<"reload" | "add" | "upload" | null>(null);

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
      grab<SkillsSummary>("/skills?include_content=true"),
    ]);
    setStats(s);
    setMonitor(m);
    setSkills(k);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const reloadSkills = async () => {
    setPending("reload");
    try {
      const res = await fetch(`${API_BASE}/skills/reload?include_content=true`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("reload failed");
      setSkills((await res.json()) as SkillsSummary);
      setNotice(DEV_STRINGS.skillsReloaded);
    } catch {
      setNotice(DEV_STRINGS.skillsReloadFailed);
    } finally {
      setPending(null);
    }
  };

  const addDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending("add");
    try {
      const res = await fetch(`${API_BASE}/knowledge/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documents: [{ title, content }] }),
      });
      if (!res.ok) throw new Error("import failed");
      const data = (await res.json()) as { added_chunks: number };
      setNotice(DEV_STRINGS.importSucceeded(data.added_chunks));
      setTitle("");
      setContent("");
      void loadAll();
    } catch {
      setNotice(DEV_STRINGS.importFailed);
    } finally {
      setPending(null);
    }
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setPending("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/knowledge/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { added_chunks: number };
      setNotice(DEV_STRINGS.uploadSucceeded(file.name, data.added_chunks));
      void loadAll();
    } catch {
      setNotice(DEV_STRINGS.uploadFailed);
    } finally {
      setPending(null);
    }
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="flex-1 bg-background p-6 text-sm text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex items-center gap-3">
          {onBackToChat && (
            <button
              type="button"
              onClick={onBackToChat}
              className={`${button} flex items-center gap-1.5`}
            >
              <ArrowLeftIcon />
              {DEV_STRINGS.backToChat}
            </button>
          )}
          <h1 className="text-xl font-semibold">{DEV_STRINGS.title}</h1>
          <button type="button" onClick={() => void loadAll()} className={`${button} ml-auto`}>
            {DEV_STRINGS.refresh}
          </button>
        </header>

        {notice && (
          <p
            role="status"
            className="rounded-lg border border-border bg-muted px-3 py-2 text-foreground"
          >
            {notice}
          </p>
        )}

        <section className={card} aria-label={DEV_STRINGS.knowledgeBase}>
          <h2 className="mb-3 font-semibold">{DEV_STRINGS.knowledgeBase}</h2>
          {stats ? (
            <p className="mb-3 text-muted-foreground">
              {DEV_STRINGS.stats(
                stats.total_chunks,
                stats.total_documents,
                stats.course_documents,
              )}
            </p>
          ) : (
            <p className="mb-3 text-muted-foreground">{DEV_STRINGS.statsUnavailable}</p>
          )}
          <form onSubmit={addDocument} className="flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={DEV_STRINGS.documentTitle}
              required
              className="rounded-lg border border-input bg-transparent px-3 py-1.5"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={DEV_STRINGS.documentContent}
              required
              rows={3}
              className="rounded-lg border border-input bg-transparent px-3 py-1.5"
            />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={pending !== null} className={button}>
                {pending === "add" ? DEV_STRINGS.addingDocument : DEV_STRINGS.addDocument}
              </button>
              <label className={`${button} cursor-pointer`}>
                {pending === "upload" ? DEV_STRINGS.uploadingFile : DEV_STRINGS.uploadFile}
                <input
                  type="file"
                  accept=".txt,.md,.json"
                  className="hidden"
                  disabled={pending !== null}
                  onChange={(e) => void uploadFile(e.target.files?.[0])}
                />
              </label>
            </div>
          </form>
        </section>

        <section className={card} aria-label={DEV_STRINGS.monitor}>
          <h2 className="mb-3 font-semibold">{DEV_STRINGS.monitor}</h2>
          {monitor ? (
            <div className="flex flex-col gap-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className={th}>{DEV_STRINGS.agent}</th>
                    <th className={th}>{DEV_STRINGS.runs}</th>
                    <th className={th}>{DEV_STRINGS.success}</th>
                    <th className={th}>{DEV_STRINGS.averageMs}</th>
                    <th className={th}>{DEV_STRINGS.penalty}</th>
                    <th className={th}>{DEV_STRINGS.routingScore}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(monitor.agent_stats).map(([name, s]) => (
                    <tr key={name} className="border-b border-border/50">
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
                  <tr className="border-b border-border">
                    <th className={th}>{DEV_STRINGS.tool}</th>
                    <th className={th}>{DEV_STRINGS.calls}</th>
                    <th className={th}>{DEV_STRINGS.success}</th>
                    <th className={th}>{DEV_STRINGS.averageLatencyMs}</th>
                    <th className={th}>{DEV_STRINGS.circuit}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(monitor.tool_stats).map(([name, s]) => (
                    <tr key={name} className="border-b border-border/50">
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
                <details
                  data-testid="monitor-alerts"
                  className="rounded-lg border border-border bg-muted/50"
                >
                  <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">
                    {DEV_STRINGS.activeAlerts(monitor.active_alerts.length)}
                  </summary>
                  <ul className="flex flex-col gap-1 px-3 pb-2">
                    {monitor.active_alerts.map((alert) => (
                      <li key={alert.metric} className="text-muted-foreground">
                        [{alert.severity}] {alert.message}
                        {alert.count > 1 && (
                          <span className="ml-1.5 tabular-nums">
                            {DEV_STRINGS.alertRepeats(alert.count)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">{DEV_STRINGS.monitorUnavailable}</p>
          )}
        </section>

        <section className={card} aria-label={DEV_STRINGS.skills}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-semibold">{DEV_STRINGS.skills}</h2>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void reloadSkills()}
              className={button}
            >
              {pending === "reload" ? DEV_STRINGS.reloadingSkills : DEV_STRINGS.reloadSkills}
            </button>
          </div>
          {skills ? (
            <ul className="flex flex-col gap-2">
              {skills.skills.map((skill, index) => {
                const skillKey = skill.path || skill.name;
                const isExpanded = expandedSkill === skillKey;
                const panelId = `skill-details-${index}`;
                return (
                  <li
                    key={skillKey}
                    className="overflow-hidden rounded-lg border border-transparent hover:border-border hover:bg-muted/40"
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() =>
                        setExpandedSkill(isExpanded ? null : skillKey)
                      }
                      className="flex w-full items-center gap-3 px-3 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{skill.name}</span>
                        <span className="ml-2 text-muted-foreground">
                          {skill.description}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {DEV_STRINGS.keywords(skill.keywords.length)}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`text-lg leading-none text-muted-foreground transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      >
                        ›
                      </span>
                    </button>
                    {isExpanded && (
                      <div
                        id={panelId}
                        className="border-t border-border bg-muted/30 px-3 py-3"
                      >
                        <dl className="grid gap-3 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="text-muted-foreground">
                              {DEV_STRINGS.skillAgents}
                            </dt>
                            <dd className="mt-1 font-medium">
                              {skill.agents.length > 0
                                ? skill.agents.join(", ")
                                : "all"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              {DEV_STRINGS.skillStatus}
                            </dt>
                            <dd className="mt-1 font-medium">
                              {skill.enabled
                                ? DEV_STRINGS.skillEnabled
                                : DEV_STRINGS.skillDisabled}
                            </dd>
                          </div>
                          <div className="min-w-0 sm:col-span-2">
                            <dt className="text-muted-foreground">
                              {DEV_STRINGS.skillSource}
                            </dt>
                            <dd className="mt-1 break-all font-mono">
                              {skill.path}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground">
                            {DEV_STRINGS.skillTriggerKeywords}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {(skill.keywords.length > 0
                              ? skill.keywords
                              : ["all"]
                            ).map((keyword) => (
                              <span
                                key={keyword}
                                className="rounded-full border border-border bg-background px-2 py-0.5 text-xs"
                              >
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground">
                            {DEV_STRINGS.skillRules}
                          </p>
                          <pre className="mt-1.5 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5">
                            {skill.content || DEV_STRINGS.skillContentUnavailable}
                          </pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground">{DEV_STRINGS.skillsUnavailable}</p>
          )}
        </section>
      </div>
    </div>
  );
};
