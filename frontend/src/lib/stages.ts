/**
 * Stage events of the CourseHub streaming protocol
 * (docs/specs/coursehub-frontend.md §3.1) as accumulated for the UI.
 */
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

export interface StageRecord {
  event: StageEventName;
  data: unknown;
}

/** Shape stored in the assistant message's `metadata.custom`. */
export interface ChatMessageCustom {
  stages?: StageRecord[];
  answer?: unknown;
}
