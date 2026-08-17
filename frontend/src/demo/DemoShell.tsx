/**
 * Demo 壳:包住真实 App(display:contents,不改布局与壳内 DOM),
 * 委托点击接管 Demo Notice 里的 #ask= 建议链接,把问题作为用户消息发进当前线程。
 */
import { useCallback, useRef } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import App from "../App";

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

  return (
    <div style={{ display: "contents" }} onClickCapture={onClickCapture}>
      <App onRuntimeReady={onRuntimeReady} />
    </div>
  );
}
