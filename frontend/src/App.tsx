import { useCallback, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createChatAdapter } from "./lib/chatAdapter";
import { useLocalThreadListAdapter } from "./lib/threadListAdapter";
import { HealthDot } from "./components/HealthDot";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { Thread } from "./components/Thread";
import { STRINGS } from "./lib/strings";

const chatAdapter = createChatAdapter();
const runtimeHook = () => useLocalRuntime(chatAdapter);

export default function App() {
  const adapter = useLocalThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({ runtimeHook, adapter });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            aria-label="Toggle conversation list"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
            className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <span aria-hidden>☰</span>
          </button>
          <span className="text-base font-semibold">{STRINGS.appName}</span>
          <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">
            {STRINGS.tagline}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <HealthDot />
          </span>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {drawerOpen && (
            <div
              aria-hidden
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 z-30 bg-black/30 md:hidden"
            />
          )}
          <div
            data-state={drawerOpen ? "open" : "closed"}
            className={`z-40 h-full max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl ${
              drawerOpen ? "" : "max-md:hidden"
            }`}
          >
            <Sidebar onNavigate={closeDrawer} />
          </div>
          <main className="min-h-0 min-w-0 flex-1">
            <Thread />
          </main>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
