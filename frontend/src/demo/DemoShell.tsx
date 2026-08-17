/**
 * Demo 壳:包住真实 App(display:contents,不改布局与壳内 DOM),
 * 委托点击接管 Demo Notice 里的 #ask= 建议链接,把问题作为用户消息发进当前线程。
 */
import { useCallback, useRef, useState } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import App from "../App";
import { listThreads } from "../lib/threadStore";
import { ASK_PREFIX, DEMO_BANNER } from "./demoStrings";

export function DemoShell() {
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const pendingDeletes = useRef(new Set<string>());

  // 同名线程去重(仅 demo):回放与既有会话同名的线程时只留一条。
  // 存活者按 threadStore(真源)的 lastMessageAt 判定——新回放的线程必然最新,
  // 因此绝不会删掉访客刚看完的会话;运行时状态只用于 remoteId → threadId 映射。
  const dedupeSameTitleThreads = useCallback((runtime: AssistantRuntime) => {
    const state = runtime.threads.getState();
    if (state.isLoading || !state.threadItems) return;
    type StoredMeta = { remoteId: string; lastMessageAt: number };
    const byTitle = new Map<string, StoredMeta[]>();
    for (const meta of listThreads()) {
      if (!meta.title || meta.status !== "regular") continue;
      byTitle.set(meta.title, [
        ...(byTitle.get(meta.title) ?? []),
        { remoteId: meta.remoteId, lastMessageAt: meta.lastMessageAt ?? 0 },
      ]);
    }
    const threadIdByRemote = new Map<string, string>();
    for (const threadId of state.threadIds) {
      const remoteId = state.threadItems[threadId]?.remoteId;
      if (remoteId) threadIdByRemote.set(remoteId, threadId);
    }
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      const survivor = group.reduce((a, b) =>
        a.lastMessageAt >= b.lastMessageAt ? a : b,
      );
      for (const { remoteId } of group) {
        if (remoteId === survivor.remoteId) continue;
        const threadId = threadIdByRemote.get(remoteId);
        if (!threadId || pendingDeletes.current.has(threadId)) continue;
        pendingDeletes.current.add(threadId);
        void runtime.threads.getItemById(threadId).delete();
      }
    }
  }, []);

  // 落地保持运行时默认:欢迎页 + 示例提问;播种的会话在侧边栏等待点开(2026-08-17 用户修订)。
  // 去重必须推迟到状态通知周期之外执行:订阅回调内同步读改会打断运行时自身的流转。
  const onRuntimeReady = useCallback(
    (runtime: AssistantRuntime) => {
      runtimeRef.current = runtime;
      const scheduleDedupe = () =>
        window.setTimeout(() => dedupeSameTitleThreads(runtime), 0);
      scheduleDedupe();
      runtime.threads.subscribe(scheduleDedupe);
    },
    [dedupeSameTitleThreads],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.(
      `a[href^='${ASK_PREFIX}']`,
    );
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href")!;
    const question = decodeURIComponent(href.slice(ASK_PREFIX.length));
    runtimeRef.current?.thread.append(question);
  }, []);

  const [bannerDismissed, setBannerDismissed] = useState(false);

  return (
    <div style={{ display: "contents" }} onClickCapture={onClickCapture}>
      {!bannerDismissed && (
        <div
          data-testid="demo-banner"
          className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground"
        >
          <span>{DEMO_BANNER.text}</span>
          <a
            href={DEMO_BANNER.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            {DEMO_BANNER.linkLabel}
          </a>
          <button
            type="button"
            aria-label={DEMO_BANNER.dismiss}
            onClick={() => setBannerDismissed(true)}
            className="ml-2 rounded px-1 hover:bg-accent hover:text-accent-foreground"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      )}
      <App onRuntimeReady={onRuntimeReady} />
    </div>
  );
}
