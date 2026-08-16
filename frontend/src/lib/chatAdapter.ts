import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { parseSseStream } from "./sse";
import { API_BASE, type ChatAnswer } from "./chatApi";
import { getBrowserUserId } from "./identity";
import {
  decodeStageEvent,
  isStageEventName,
  type ChatMessageCustom,
  type StageRecord,
} from "./stages";
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

class BackendStreamError extends Error {}

/** 同一会话的 conv_id 单一事实来源:最近一条 assistant 消息的 answer 元数据。 */
function findConvId(messages: readonly ThreadMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") {
      const custom = message.metadata?.custom as ChatMessageCustom | undefined;
      const convId = custom?.answer?.conv_id;
      if (convId) return convId;
    }
  }
  return undefined;
}

/** 流式建立失败时的一次性回退:非流式 POST /chat。 */
async function fetchChatFallback(
  body: string,
  abortSignal: AbortSignal,
): Promise<ChatAnswer> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: abortSignal,
  });
  if (!response.ok) throw new Error(STRINGS.requestFailed);
  return (await response.json()) as ChatAnswer;
}

export function createChatAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const convId = findConvId(messages);
      const body = JSON.stringify({
        message: lastUserText(messages),
        user_id: getBrowserUserId(),
        ...(convId ? { conv_id: convId } : {}),
      });

      let response: Response | null = null;
      try {
        response = await fetch(`${API_BASE}/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: abortSignal,
        });
      } catch (err) {
        if (abortSignal.aborted) throw err;
        response = null; // 连接层失败 → 回退
      }

      let answer: ChatAnswer | null = null;
      const stages: StageRecord[] = [];

      if (response === null || !response.ok || !response.body) {
        answer = await fetchChatFallback(body, abortSignal);
      } else {
        let streamFailure: unknown = null;
        try {
          for await (const evt of parseSseStream(response.body)) {
            if (evt.event === "answer") {
              answer = evt.data as ChatAnswer;
            } else if (evt.event === "error") {
              const message = (evt.data as { message?: string } | null)?.message;
              throw new BackendStreamError(message || STRINGS.requestFailed);
            } else if (isStageEventName(evt.event)) {
              // 阶段事件实时透出:先于任何答案文本更新 metadata,驱动过程展示。
              stages.push(decodeStageEvent(evt.event, evt.data));
              yield { content: [], metadata: { custom: { stages: [...stages] } } };
            }
          }
        } catch (err) {
          if (abortSignal.aborted) throw err;
          streamFailure = err;
        }

        if (!answer) {
          if (streamFailure instanceof BackendStreamError) throw streamFailure;
          // 回退会重新执行请求；不能把失败 attempt 的阶段附到第二次请求的答案。
          stages.length = 0;
          answer = await fetchChatFallback(body, abortSignal);
        }
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
