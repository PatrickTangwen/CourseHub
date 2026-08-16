/**
 * localStorage 版线程列表适配器(RemoteThreadListAdapter 的本地实现),
 * 组合方式与 assistant-ui cloud adapter 的 canonical 形状一致:
 * unstable_Provider 为每个活动线程注入 history adapter,经
 * useAui().threadListItem 拿到线程 remoteId。
 */
import { useCallback, useMemo, useRef } from "react";
import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";
import type { ThreadHistoryAdapter } from "@assistant-ui/core";
import { createAssistantStream } from "assistant-stream";
import {
  appendMessage,
  deleteThread,
  getThread,
  listThreads,
  loadMessages,
  patchThread,
  updateMessage,
  upsertThread,
} from "./threadStore";
import { STRINGS } from "./strings";

function firstUserText(messages: readonly ThreadMessage[]): string {
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

const LocalThreadProvider = ({ children }: { children?: React.ReactNode }) => {
  const aui = useAui();
  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() {
        const remoteId = aui.threadListItem.getState().remoteId;
        if (!remoteId) return { messages: [] };
        return { messages: loadMessages(remoteId) };
      },
      async append(item) {
        const { remoteId } = await aui.threadListItem.initialize();
        appendMessage(remoteId, item);
        patchThread(remoteId, { lastMessageAt: Date.now() });
      },
      async update(item) {
        const remoteId = aui.threadListItem.getState().remoteId;
        if (!remoteId) return;
        updateMessage(remoteId, item);
      },
    }),
    [aui],
  );
  const adapters = useMemo(() => ({ history }), [history]);
  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
};

export function useLocalThreadListAdapter(): RemoteThreadListAdapter {
  const providerRef = useRef(LocalThreadProvider);
  const unstable_Provider = useCallback(
    ({ children }: { children?: React.ReactNode }) => {
      const Provider = providerRef.current;
      return <Provider>{children}</Provider>;
    },
    [],
  );

  return useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        return {
          threads: listThreads().map((t) => ({
            status: t.status,
            remoteId: t.remoteId,
            title: t.title,
            lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt) : undefined,
          })),
        };
      },
      async initialize(threadId) {
        upsertThread({ remoteId: threadId, status: "regular", lastMessageAt: Date.now() });
        return { remoteId: threadId };
      },
      async rename(remoteId, newTitle) {
        patchThread(remoteId, { title: newTitle });
      },
      async archive(remoteId) {
        patchThread(remoteId, { status: "archived" });
      },
      async unarchive(remoteId) {
        patchThread(remoteId, { status: "regular" });
      },
      async delete(remoteId) {
        deleteThread(remoteId);
      },
      async fetch(threadId) {
        const meta = getThread(threadId);
        if (!meta) throw new Error(`Thread "${threadId}" not found in local storage.`);
        return {
          status: meta.status,
          remoteId: meta.remoteId,
          title: meta.title,
          lastMessageAt: meta.lastMessageAt ? new Date(meta.lastMessageAt) : undefined,
        };
      },
      async generateTitle(remoteId, messages) {
        const title = firstUserText(messages).slice(0, 48) || STRINGS.newChat;
        patchThread(remoteId, { title });
        return createAssistantStream((controller) => {
          controller.appendText(title);
        });
      },
      unstable_Provider,
    }),
    [unstable_Provider],
  );
}
