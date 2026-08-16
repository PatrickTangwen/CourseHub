import { describe, expect, it } from "vitest";
import { buildTimeline, summarizeTimeline, toolLabel } from "../lib/stageDisplay";
import { decodeStageEvent, type StageEventName } from "../lib/stages";
import type { ChatAnswer } from "../lib/chatApi";

const stage = (event: StageEventName, data: unknown) => decodeStageEvent(event, data);

describe("buildTimeline", () => {
  it("maps a greeting flow to domain steps with no tool steps", () => {
    const steps = buildTimeline(
      [
        stage("run_started", { conv_id: "c" }),
        stage("memory_recalled", {
          working_messages: 0,
          episodic_hits: 0,
          has_profile: false,
          has_summary: false,
        }),
        stage("intent_recognized", {
          intent: "greeting",
          intent_group: "general",
          intent_confidence: 1,
          intent_source_scores: { llm: 1.0 },
        }),
        stage("routing_decided", {
          primary_agent: "general",
          supporting_agents: [],
          routing_reason: "greeting → general",
          routing_confidence: 1,
        }),
      ],
      false,
    );
    expect(steps.map((s) => s.key)).toEqual(["memory", "intent", "routing"]);
    expect(steps[2].detail).toBe("General Agent (lead)");
    expect(steps.some((s) => s.key.startsWith("tool:"))).toBe(false);
  });

  it("turns raw intent source scores into named signals with a lead", () => {
    const steps = buildTimeline(
      [
        stage("intent_recognized", {
          intent: "plan_sequence",
          intent_group: "planning",
          intent_confidence: 0.91,
          // embedding 这一路在配了自定义 base_url 时根本不跑,恒为 0——
          // 显示成 "0.00" 会被读成"向量检索没匹配上",必须区分开。
          intent_source_scores: { llm: 0.98, embedding: 0, pattern: 0.5 },
        }),
      ],
      false,
    );
    const intent = steps.find((s) => s.key === "intent")!;
    expect(intent.signals).toEqual([
      { key: "llm", label: "LLM classifier", score: 0.98, lead: true },
      { key: "embedding", label: "Embedding similarity", score: 0, lead: false },
      { key: "pattern", label: "Keyword patterns", score: 0.5, lead: false },
    ]);
    // 旧的裸分数文案不再出现
    expect(intent.expandedDetail).toBeUndefined();
  });

  it("folds refined_by_pattern into the pattern row instead of duplicating it", () => {
    // 后端把 refined_by_pattern 设成 pattern 分数的副本(intent_recognizer.py),
    // 单列一行会读成"两路独立信号都给了 0.55"。
    const steps = buildTimeline(
      [
        stage("intent_recognized", {
          intent: "professor_choice",
          intent_group: "planning",
          intent_confidence: 0.55,
          intent_source_scores: {
            llm: 0.4,
            embedding: 0,
            pattern: 0.55,
            refined_by_pattern: 0.55,
          },
        }),
      ],
      false,
    );
    expect(steps[0].signals).toEqual([
      { key: "llm", label: "LLM classifier", score: 0.4, lead: false },
      { key: "embedding", label: "Embedding similarity", score: 0, lead: false },
      { key: "pattern", label: "Keyword patterns", score: 0.55, lead: true, refined: true },
    ]);
  });

  it("keeps a refinement signal standing alone when its base signal is absent", () => {
    const steps = buildTimeline(
      [
        stage("intent_recognized", {
          intent: "professor_choice",
          intent_group: "planning",
          intent_confidence: 0.55,
          intent_source_scores: { refined_by_pattern: 0.55 },
        }),
      ],
      false,
    );
    expect(steps[0].signals).toEqual([
      { key: "refined_by_pattern", label: "Pattern refinement", score: 0.55, lead: true },
    ]);
  });

  it("falls back to the raw key for unknown intent signals", () => {
    const steps = buildTimeline(
      [
        stage("intent_recognized", {
          intent: "greeting",
          intent_group: "general",
          intent_confidence: 1,
          intent_source_scores: { mystery_source: 0.4 },
        }),
      ],
      false,
    );
    expect(steps[0].signals).toEqual([
      { key: "mystery_source", label: "mystery_source", score: 0.4, lead: true },
    ]);
  });

  it("gives every step a thinking-orb state matching what it is doing", () => {
    const steps = buildTimeline(
      [
        stage("memory_recalled", {
          working_messages: 1,
          episodic_hits: 0,
          has_profile: true,
          has_summary: false,
        }),
        stage("intent_recognized", {
          intent: "course_overview",
          intent_group: "facts",
          intent_confidence: 0.9,
          intent_source_scores: { llm: 0.9 },
        }),
        stage("tool_call_started", { tool_name: "course_lookup" }),
        stage("tool_call_started", { tool_name: "knowledge_search" }),
        stage("tool_call_started", { tool_name: "mystery_tool" }),
        stage("routing_decided", {
          primary_agent: "course",
          supporting_agents: [],
          routing_reason: "facts → course",
          routing_confidence: 0.9,
        }),
      ],
      false,
    );
    expect(Object.fromEntries(steps.map((s) => [s.key, s.orb]))).toEqual({
      memory: "listening",
      intent: "solving",
      routing: "connecting",
      "tool:course_lookup": "searching",
      "tool:knowledge_search": "weaving",
      "tool:mystery_tool": "working",
    });
  });

  it("aggregates repeated tool calls into one step with count and total duration", () => {
    const steps = buildTimeline(
      [
        stage("tool_call_started", { tool_name: "knowledge_search" }),
        stage("tool_call_started", { tool_name: "knowledge_search" }),
        stage("tool_call_finished", { tool_name: "knowledge_search", success: true, duration_ms: 10.2 }),
        stage("tool_call_finished", { tool_name: "knowledge_search", success: true, duration_ms: 5.1 }),
      ],
      false,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toBe("Reading course materials ×2");
    expect(steps[0].raw).toBe("knowledge_search");
    expect(steps[0].detail).toBe("15ms · 2 succeeded");
    expect(steps[0].active).toBe(false);
  });

  it("marks a tool step active while calls are outstanding", () => {
    const steps = buildTimeline(
      [
        stage("tool_call_started", { tool_name: "course_lookup" }),
      ],
      true,
    );
    expect(steps[0].active).toBe(true);
  });

  it("falls back to the raw name for unknown tools", () => {
    expect(toolLabel("mystery_tool")).toBe("mystery_tool");
    const steps = buildTimeline(
      [stage("tool_call_started", { tool_name: "mystery_tool" })],
      false,
    );
    expect(steps[0].label).toBe("mystery_tool");
  });

  it("shows a Thinking placeholder while only run_started has arrived", () => {
    const steps = buildTimeline([stage("run_started", { conv_id: "c" })], true);
    expect(steps).toEqual([
      { key: "thinking", label: "Thinking…", orb: "working", active: true },
    ]);
    // 其余阶段到达后占位消失
    const later = buildTimeline(
      [
        stage("run_started", { conv_id: "c" }),
        stage("memory_recalled", {
          working_messages: 0,
          episodic_hits: 0,
          has_profile: false,
          has_summary: false,
        }),
      ],
      true,
    );
    expect(later.map((s) => s.key)).toEqual(["memory"]);
  });

  it("preserves out-of-order tool frames", () => {
    const steps = buildTimeline(
      [
        stage("tool_call_finished", { tool_name: "course_lookup", success: true, duration_ms: 5 }),
        stage("tool_call_started", { tool_name: "course_lookup" }),
      ],
      false,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].raw).toBe("course_lookup");
    expect(steps[0].detail).toBe("5ms · succeeded");
    expect(steps[0].active).toBe(false);
  });

  it("reports failed calls in the tool detail", () => {
    const steps = buildTimeline(
      [
        stage("tool_call_started", { tool_name: "course_lookup" }),
        stage("tool_call_finished", { tool_name: "course_lookup", success: false, duration_ms: 3 }),
      ],
      false,
    );
    expect(steps[0].detail).toContain("1 failed");
  });
});

describe("summarizeTimeline", () => {
  it("combines agent, lookup count and latency", () => {
    const answer = { primary_agent: "course", latency_ms: 8639.1 } as ChatAnswer;
    const stages = [
      stage("tool_call_started", { tool_name: "a" }),
      stage("tool_call_started", { tool_name: "b" }),
    ];
    expect(summarizeTimeline(stages, answer)).toBe("Course Agent · 2 tool calls · 8.6s");
  });

  it("falls back to a generic label when nothing is known", () => {
    expect(summarizeTimeline([], undefined)).toBe("Process");
  });
});
