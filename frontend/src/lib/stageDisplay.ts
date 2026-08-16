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
import { PROCESS_STRINGS } from "./strings";

export const STAGE_LABELS = {
  run_started: PROCESS_STRINGS.thinking,
  memory_recalled: PROCESS_STRINGS.recallingContext,
  intent_recognized: PROCESS_STRINGS.understandingQuestion,
  routing_decided: PROCESS_STRINGS.routingToSpecialists,
} as const;

export const TOOL_LABELS: Record<string, string> = {
  course_lookup: PROCESS_STRINGS.searchingCourseIndex,
  knowledge_search: PROCESS_STRINGS.readingCourseMaterials,
};

export const AGENT_LABELS: Record<string, string> = PROCESS_STRINGS.agentLabels;

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

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** 把阶段事件流折算成显示步骤:同名工具聚合为一步(含调用次数与总耗时)。 */
export function buildTimeline(stages: StageRecord[], isRunning: boolean): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const tools = new Map<string, ToolAgg>();

  const getOrCreateTool = (name: string): ToolAgg => {
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
    return agg;
  };

  for (const stage of stages) {
    switch (stage.event) {
      case "run_started":
        break; // 后续阶段到达前由下方的 Thinking 占位步骤承担(spec §4.2)
      case "memory_recalled": {
        const data = stage.data;
        steps.push({
          key: "memory",
          label: STAGE_LABELS.memory_recalled,
          detail: [
            PROCESS_STRINGS.recentMessages(data.working_messages),
            PROCESS_STRINGS.relatedMemories(data.episodic_hits),
          ].join(" · "),
          expandedDetail: [
            PROCESS_STRINGS.profileAvailability(data.has_profile),
            PROCESS_STRINGS.summaryAvailability(data.has_summary),
          ].join(" · "),
          active: false,
        });
        break;
      }
      case "intent_recognized": {
        const data = stage.data;
        const scoreText = Object.entries(data.intent_source_scores)
          .map(([source, score]) => `${source} ${score.toFixed(2)}`)
          .join(" · ");
        steps.push({
          key: "intent",
          label: STAGE_LABELS.intent_recognized,
          raw: data.intent,
          detail: `${data.intent} · ${pct(data.intent_confidence)}`,
          expandedDetail: scoreText ? PROCESS_STRINGS.sourceScores(scoreText) : undefined,
          active: false,
        });
        break;
      }
      case "tool_call_started": {
        const name = stage.data.tool_name;
        const agg = getOrCreateTool(name);
        agg.started += 1;
        break;
      }
      case "tool_call_finished": {
        const data = stage.data;
        const name = data.tool_name;
        const agg = getOrCreateTool(name);
        agg.finished += 1;
        agg.totalMs += data.duration_ms;
        if (data.success === false) agg.failed += 1;
        break;
      }
      case "routing_decided": {
        const data = stage.data;
        const primary = agentLabel(data.primary_agent);
        const supporting = data.supporting_agents.map((agent) =>
          PROCESS_STRINGS.supportingAgent(agentLabel(agent)),
        );
        steps.push({
          key: "routing",
          label: STAGE_LABELS.routing_decided,
          detail: [PROCESS_STRINGS.leadAgent(primary), ...supporting].join(" · "),
          expandedDetail: data.routing_reason || undefined,
          active: false,
        });
        break;
      }
    }
  }

  for (const agg of tools.values()) {
    const calls = agg.started > 1 ? PROCESS_STRINGS.toolCount(agg.started) : "";
    agg.step.label = `${toolLabel(agg.step.raw ?? "")}${calls}`;
    const parts: string[] = [];
    if (agg.finished > 0) {
      parts.push(PROCESS_STRINGS.duration(agg.totalMs));
      const succeeded = agg.finished - agg.failed;
      if (succeeded > 0) parts.push(PROCESS_STRINGS.succeeded(succeeded));
    }
    if (agg.failed > 0) parts.push(PROCESS_STRINGS.failed(agg.failed));
    agg.step.detail = parts.join(" · ") || undefined;
    // 只有运行中才标 active:完成后即使有乱序/缺失的 finished 帧也不悬挂脉冲点。
    agg.step.active = isRunning && agg.started > agg.finished;
  }

  // run_started 已到、其余阶段未到:显示 "Thinking…" 占位步骤(spec §4.2)。
  if (steps.length === 0 && stages.some((s) => s.event === "run_started")) {
    steps.push({ key: "thinking", label: PROCESS_STRINGS.thinkingActive, active: isRunning });
    return steps;
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
  // 中性措辞:含语义检索,不能落入 "lookup"(CONTEXT.md 词表边界)。
  const toolCalls = stages.filter((s) => s.event === "tool_call_started").length;
  if (toolCalls > 0) parts.push(PROCESS_STRINGS.toolCalls(toolCalls));
  if (typeof answer?.latency_ms === "number") {
    parts.push(PROCESS_STRINGS.seconds(answer.latency_ms));
  }
  return parts.join(" · ") || PROCESS_STRINGS.process;
}
