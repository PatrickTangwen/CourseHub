/**
 * Demo 壳:包住真实 App(display:contents,不改布局与壳内 DOM),
 * 委托点击接管 Demo Notice 里的 #ask= 建议链接,把问题作为用户消息发进当前线程。
 */
import { useCallback, useRef, useState } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import App from "../App";
import { DEMO_BANNER } from "./demoStrings";

const ASK_PREFIX = "#ask=";

export function DemoShell() {
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const landed = useRef(false);
  const onRuntimeReady = useCallback((runtime: AssistantRuntime) => {
    runtimeRef.current = runtime;
    if (landed.current) return;
    landed.current = true;
    // 落地选中最近一条会话(播种后即修课规划条),而不是空欢迎页。
    const landOnLatestThread = () => {
      const state = runtime.threads.getState();
      if (state.isLoading) return false;
      if (state.threadIds.length > 0) {
        void runtime.threads.switchToThread(state.threadIds[0]);
      }
      return true;
    };
    if (!landOnLatestThread()) {
      const unsubscribe = runtime.threads.subscribe(() => {
        if (landOnLatestThread()) unsubscribe();
      });
    }
  }, []);

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
