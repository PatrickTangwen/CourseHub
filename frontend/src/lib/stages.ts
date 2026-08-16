/**
 * Stage events of the CourseHub streaming protocol
 * (docs/specs/coursehub-frontend.md §3.1) as accumulated for the UI.
 */
import type { ChatAnswer } from "./chatApi";

export const STAGE_EVENT_NAMES = [
  "run_started",
  "memory_recalled",
  "intent_recognized",
  "routing_decided",
  "tool_call_started",
  "tool_call_finished",
] as const;

export type StageEventName = (typeof STAGE_EVENT_NAMES)[number];

export function isStageEventName(event: string): event is StageEventName {
  return (STAGE_EVENT_NAMES as readonly string[]).includes(event);
}

export interface StagePayloadMap {
  run_started: { conv_id: string };
  memory_recalled: {
    working_messages: number;
    episodic_hits: number;
    has_profile: boolean;
    has_summary: boolean;
  };
  intent_recognized: {
    intent: string;
    intent_group: string;
    intent_confidence: number;
    intent_source_scores: Record<string, number>;
  };
  routing_decided: {
    primary_agent: string;
    supporting_agents: string[];
    routing_reason: string;
    routing_confidence: number;
  };
  tool_call_started: { tool_name: string };
  tool_call_finished: {
    tool_name: string;
    success: boolean;
    duration_ms: number;
  };
}

export type StageRecord = {
  [Event in StageEventName]: { event: Event; data: StagePayloadMap[Event] };
}[StageEventName];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNumberRecord = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Wire-boundary decoder: schema drift becomes a failed stream, never silent UI loss. */
export function decodeStageEvent<Event extends StageEventName>(
  event: Event,
  value: unknown,
): Extract<StageRecord, { event: Event }> {
  if (!isRecord(value)) throw new Error(`Invalid ${event} payload`);

  const valid = (() => {
    switch (event) {
      case "run_started":
        return typeof value.conv_id === "string";
      case "memory_recalled":
        return (
          typeof value.working_messages === "number" &&
          typeof value.episodic_hits === "number" &&
          typeof value.has_profile === "boolean" &&
          typeof value.has_summary === "boolean"
        );
      case "intent_recognized":
        return (
          typeof value.intent === "string" &&
          typeof value.intent_group === "string" &&
          typeof value.intent_confidence === "number" &&
          isNumberRecord(value.intent_source_scores)
        );
      case "routing_decided":
        return (
          typeof value.primary_agent === "string" &&
          isStringArray(value.supporting_agents) &&
          typeof value.routing_reason === "string" &&
          typeof value.routing_confidence === "number"
        );
      case "tool_call_started":
        return typeof value.tool_name === "string";
      case "tool_call_finished":
        return (
          typeof value.tool_name === "string" &&
          typeof value.success === "boolean" &&
          typeof value.duration_ms === "number"
        );
    }
  })();

  if (!valid) throw new Error(`Invalid ${event} payload`);
  return { event, data: value as StagePayloadMap[Event] } as unknown as Extract<
    StageRecord,
    { event: Event }
  >;
}

/** Shape stored in the assistant message's `metadata.custom`. */
export interface ChatMessageCustom {
  stages?: StageRecord[];
  answer?: ChatAnswer;
}
