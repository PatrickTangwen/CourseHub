import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { parseSseStream } from "./sse";
import { API_BASE, type ChatAnswer } from "./chatApi";
import { isStageEventName, type StageRecord } from "./stages";
import { STRINGS } from "./strings";

/** Typewriter presentation: the answer arrives whole; reveal is cosmetic. */
const TYPEWRITER_CHUNK_CHARS = 4;
const TYPEWRITER_DELAY_MS = import.meta.env.MODE === "test" ? 0 : 12;

function lastUserText(messages: readonly ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      return message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    }
  }
  return "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createChatAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: lastUserText(messages),
          user_id: "anonymous",
        }),
        signal: abortSignal,
      });
      if (!response.ok || !response.body) {
        throw new Error(STRINGS.requestFailed);
      }

      let answer: ChatAnswer | null = null;
      const stages: StageRecord[] = [];
      for await (const evt of parseSseStream(response.body)) {
        if (evt.event === "answer") {
          answer = evt.data as ChatAnswer;
        } else if (evt.event === "error") {
          const message = (evt.data as { message?: string } | null)?.message;
          throw new Error(message || STRINGS.requestFailed);
        } else if (isStageEventName(evt.event)) {
          // 阶段事件实时透出:先于任何答案文本更新 metadata,驱动过程展示。
          stages.push({ event: evt.event, data: evt.data });
          yield { content: [], metadata: { custom: { stages: [...stages] } } };
        }
      }
      if (!answer) {
        throw new Error(STRINGS.streamEndedUnexpectedly);
      }

      const full = answer.response;
      const stagesSnapshot = [...stages];
      for (let end = TYPEWRITER_CHUNK_CHARS; end < full.length; end += TYPEWRITER_CHUNK_CHARS) {
        if (abortSignal.aborted) return;
        yield {
          content: [{ type: "text" as const, text: full.slice(0, end) }],
          metadata: { custom: { stages: stagesSnapshot } },
        };
        if (TYPEWRITER_DELAY_MS > 0) await sleep(TYPEWRITER_DELAY_MS);
      }
      yield {
        content: [{ type: "text" as const, text: full }],
        metadata: { custom: { stages: stagesSnapshot, answer } },
      };
    },
  };
}
