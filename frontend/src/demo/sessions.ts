/**
 * Recorded Session 注册表:实录 fixture 的唯一入口。
 * fixture 由 scripts/record-session.mjs 对真实本地后端实录产出;
 * 准入门禁(严格 decoder 校验)见 __tests__/demo.test.tsx。不要手改 fixture,重录。
 */
import cse100Overview from "./fixtures/cse100-overview.json";
import cse101Instructor from "./fixtures/cse101-instructor.json";
import cse100PrereqsZh from "./fixtures/cse100-prereqs-zh.json";
import planningSequenceZh from "./fixtures/planning-sequence-zh.json";
import advisorReferral from "./fixtures/advisor-referral.json";
import cse110Multiturn from "./fixtures/cse110-multiturn.json";

export interface RecordedEvent {
  event: string;
  data: unknown;
  at_ms: number;
}

export interface RecordedTurn {
  question: string;
  events: RecordedEvent[];
}

export interface RecordedSession {
  id: string;
  recorded_at: string;
  backend: string;
  turns: RecordedTurn[];
}

export const DEMO_SESSIONS: RecordedSession[] = [
  cse100Overview,
  cse101Instructor,
  cse100PrereqsZh,
  planningSequenceZh,
  advisorReferral,
  cse110Multiturn,
];
