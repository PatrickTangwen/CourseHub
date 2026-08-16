/**
 * 领域术语映射模块 —— 阶段/工具/Agent → 界面显示名的唯一落点。
 *
 * 词汇与 CONTEXT.md 对齐并遵守其 Avoid 词表:
 * - course_lookup 是 Course Lookup(结构化 Course Index 查询)→ "Searching the course index"
 * - knowledge_search 是语义检索(Knowledge Doc)→ "Reading course materials"
 * - Advisor Referral 绝不表述为 "human handoff" / 转人工
 * 未知工具名兜底显示原始标识;展开层始终括注原始标识。
 */
import type { ChatAnswer } from "./chatApi";
import type { StageRecord } from "./stages";

export const STAGE_LABELS = {
  run_started: "Thinking",
  memory_recalled: "Recalling conversation context",
  intent_recognized: "Understanding the question",
  routing_decided: "Routing to specialists",
} as const;

export const TOOL_LABELS: Record<string, string> = {
  course_lookup: "Searching the course index",
  knowledge_search: "Reading course materials",
};

export const AGENT_LABELS: Record<string, string> = {
  general: "General Agent",
  course: "Course Agent",
  planning: "Planning Agent",
};

export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;
export const agentLabel = (name: string): string => AGENT_LABELS[name] ?? name;

export interface TimelineStep {
  key: string;
  label: string;
  /** 原始标识(intent / tool_name),展开层括注 */
  raw?: string;
  /** 一行摘要级细节 */
  detail?: string;
  /** 展开层的更长细节(路由理由、三路分数) */
  expandedDetail?: string;
  active: boolean;
}

interface ToolAgg {
  step: TimelineStep;
  started: number;
  finished: number;
  totalMs: number;
  failed: number;
}

const asRecord = (data: unknown): Record<string, unknown> =>
  data != null && typeof data === "object" ? (data as Record<string, unknown>) : {};

const pct = (value: unknown): string =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "";

/** 把阶段事件流折算成显示步骤:同名工具聚合为一步(含调用次数与总耗时)。 */
export function buildTimeline(stages: StageRecord[], isRunning: boolean): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const tools = new Map<string, ToolAgg>();

  for (const stage of stages) {
    const data = asRecord(stage.data);
    switch (stage.event) {
      case "run_started":
        break; // 由"最后一步 active"的旋转指示承担,不单列
      case "memory_recalled": {
        const working = Number(data.working_messages ?? 0);
        const episodic = Number(data.episodic_hits ?? 0);
        steps.push({
          key: "memory",
          label: STAGE_LABELS.memory_recalled,
          detail: `${working} recent · ${episodic} related`,
          active: false,
        });
        break;
      }
      case "intent_recognized": {
        const intent = String(data.intent ?? "");
        const scores = asRecord(data.intent_source_scores);
        const scoreText = Object.entries(scores)
          .map(([source, score]) => `${source} ${typeof score === "number" ? score.toFixed(2) : score}`)
          .join(" · ");
        steps.push({
          key: "intent",
          label: STAGE_LABELS.intent_recognized,
          raw: intent,
          detail: `${intent} · ${pct(data.intent_confidence)}`,
          expandedDetail: scoreText ? `source scores: ${scoreText}` : undefined,
          active: false,
        });
        break;
      }
      case "tool_call_started": {
        const name = String(data.tool_name ?? "tool");
        let agg = tools.get(name);
        if (!agg) {
          agg = {
            step: { key: `tool:${name}`, label: toolLabel(name), raw: name, active: false },
            started: 0,
            finished: 0,
            totalMs: 0,
            failed: 0,
          };
          tools.set(name, agg);
          steps.push(agg.step);
        }
        agg.started += 1;
        break;
      }
      case "tool_call_finished": {
        const name = String(data.tool_name ?? "tool");
        const agg = tools.get(name);
        if (!agg) break;
        agg.finished += 1;
        if (typeof data.duration_ms === "number") agg.totalMs += data.duration_ms;
        if (data.success === false) agg.failed += 1;
        break;
      }
      case "routing_decided": {
        const primary = agentLabel(String(data.primary_agent ?? ""));
        const supporting = Array.isArray(data.supporting_agents)
          ? data.supporting_agents.map((a) => `${agentLabel(String(a))} (support)`)
          : [];
        const reason = String(data.routing_reason ?? "");
        steps.push({
          key: "routing",
          label: STAGE_LABELS.routing_decided,
          detail: [`${primary} (lead)`, ...supporting].join(" · "),
          expandedDetail: reason || undefined,
          active: false,
        });
        break;
      }
    }
  }

  for (const agg of tools.values()) {
    const calls = agg.started > 1 ? ` ×${agg.started}` : "";
    agg.step.label = `${toolLabel(agg.step.raw ?? "")}${calls}`;
    const parts: string[] = [];
    if (agg.finished > 0) parts.push(`${Math.round(agg.totalMs)}ms`);
    if (agg.failed > 0) parts.push(`${agg.failed} failed`);
    agg.step.detail = parts.join(" · ") || undefined;
    agg.step.active = agg.started > agg.finished;
  }

  if (isRunning && steps.length > 0) {
    const anyToolActive = steps.some((s) => s.active);
    if (!anyToolActive) steps[steps.length - 1].active = true;
  }
  return steps;
}

/** 完成后的一行摘要:主 Agent · 工具调用次数 · 耗时。 */
export function summarizeTimeline(
  stages: StageRecord[],
  answer: ChatAnswer | undefined,
): string {
  const parts: string[] = [];
  if (answer?.primary_agent) parts.push(agentLabel(answer.primary_agent));
  const toolCalls = stages.filter((s) => s.event === "tool_call_started").length;
  if (toolCalls > 0) parts.push(`${toolCalls} lookup${toolCalls > 1 ? "s" : ""}`);
  if (typeof answer?.latency_ms === "number") {
    parts.push(`${(answer.latency_ms / 1000).toFixed(1)}s`);
  }
  return parts.join(" · ") || "Process";
}
