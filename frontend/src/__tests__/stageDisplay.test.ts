import { describe, expect, it } from "vitest";
import { buildTimeline, summarizeTimeline, toolLabel } from "../lib/stageDisplay";
import type { StageRecord } from "../lib/stages";
import type { ChatAnswer } from "../lib/chatApi";

const stage = (event: StageRecord["event"], data: unknown): StageRecord => ({
  event,
  data,
});

describe("buildTimeline", () => {
  it("maps a greeting flow to domain steps with no tool steps", () => {
    const steps = buildTimeline(
      [
        stage("run_started", { conv_id: "c" }),
        stage("memory_recalled", { working_messages: 0, episodic_hits: 0 }),
        stage("intent_recognized", {
          intent: "greeting",
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
    expect(steps[0].detail).toBe("15ms");
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
    expect(steps).toEqual([{ key: "thinking", label: "Thinking…", active: true }]);
    // 其余阶段到达后占位消失
    const later = buildTimeline(
      [
        stage("run_started", { conv_id: "c" }),
        stage("memory_recalled", { working_messages: 0, episodic_hits: 0 }),
      ],
      true,
    );
    expect(later.map((s) => s.key)).toEqual(["memory"]);
  });

  it("tolerates out-of-order tool frames (finished before started is ignored)", () => {
    const steps = buildTimeline(
      [
        stage("tool_call_finished", { tool_name: "course_lookup", success: true, duration_ms: 5 }),
        stage("tool_call_started", { tool_name: "course_lookup" }),
      ],
      false,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].raw).toBe("course_lookup");
    expect(steps[0].active).toBe(false); // started=1, 迟到的 finished 已被忽略 → 不悬挂
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
