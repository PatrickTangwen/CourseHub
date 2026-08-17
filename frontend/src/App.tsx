import { useCallback, useEffect, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { createChatAdapter } from "./lib/chatAdapter";
import { useLocalThreadListAdapter } from "./lib/threadListAdapter";
import { DevPanel } from "./dev/DevPanel";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { Thread } from "./components/Thread";
import { STRINGS } from "./lib/strings";

const chatAdapter = createChatAdapter();
const useRuntime = () => useLocalRuntime(chatAdapter);

type View = "chat" | "dev";

/** /dev 仍是可直达的深链(nginx 已做 SPA 回退),但只决定主区显示什么。 */
const viewFromPath = (): View =>
  window.location.pathname === "/dev" ? "dev" : "chat";

interface AppProps {
  /** 运行时就绪回调:外层宿主(如 demo 壳)用它驱动线程。 */
  onRuntimeReady?: (runtime: AssistantRuntime) => void;
}

export default function App({ onRuntimeReady }: AppProps = {}) {
  const adapter = useLocalThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useRuntime, adapter });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState(viewFromPath);

  useEffect(() => {
    onRuntimeReady?.(runtime);
  }, [onRuntimeReady, runtime]);

  useEffect(() => {
    const syncFromUrl = () => setView(viewFromPath());
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const go = useCallback((next: View) => {
    window.history.pushState(null, "", next === "dev" ? "/dev" : "/");
    setView(next);
    setDrawerOpen(false);
  }, []);
  const goChat = useCallback(() => go("chat"), [go]);
  const goDev = useCallback(() => go("dev"), [go]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* 不锁视口高度:滚动交给浏览器窗口,页面里不再出现自己的滚动条。 */}
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label={STRINGS.toggleConversationList}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
            className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <span aria-hidden>☰</span>
          </button>
          <span className="text-base font-semibold">{STRINGS.appName}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {STRINGS.tagline}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </span>
        </header>
        <div className="relative flex flex-1">
          {drawerOpen && (
            <div
              aria-hidden
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 z-30 bg-foreground/30 md:hidden"
            />
          )}
          <div
            data-state={drawerOpen ? "open" : "closed"}
            className={`z-40 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl md:sticky md:top-0 md:h-dvh ${
              drawerOpen ? "" : "max-md:hidden"
            }`}
          >
            <Sidebar
              onNavigate={goChat}
              devActive={view === "dev"}
              onOpenDev={goDev}
            />
          </div>
          <main className="flex min-w-0 flex-1 flex-col">
            {view === "dev" ? <DevPanel onBackToChat={goChat} /> : <Thread />}
          </main>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
