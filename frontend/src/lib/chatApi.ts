/**
 * Backend contract types for the CourseHub chat API.
 * The `answer` SSE event carries the same shape as POST /chat's response.
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface ChatAnswer {
  conv_id: string;
  response: string;
  intent: string;
  intent_group: string;
  agent_type: string;
  agent_types: string[];
  primary_agent: string;
  supporting_agents: string[];
  routing_reason: string;
  routing_confidence: number;
  escalated: boolean;
  latency_ms: number;
  knowledge_used: boolean;
  entities: Record<string, string[]>;
  intent_confidence: number;
  intent_source_scores: Record<string, number>;
}
