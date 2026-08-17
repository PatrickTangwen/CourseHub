/**
 * Demo 壳:包住真实 App(display:contents,不改布局与壳内 DOM),
 * 委托点击接管 Demo Notice 里的 #ask= 建议链接,把问题作为用户消息发进当前线程。
 */
import { useCallback, useRef, useState } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import App from "../App";
import { ASK_PREFIX, DEMO_BANNER } from "./demoStrings";

export function DemoShell() {
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  // 落地保持运行时默认:欢迎页 + 示例提问;播种的会话在侧边栏等待点开(2026-08-17 用户修订)。
  const onRuntimeReady = useCallback((runtime: AssistantRuntime) => {
    runtimeRef.current = runtime;
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
