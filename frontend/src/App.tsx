import { useCallback, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createChatAdapter } from "./lib/chatAdapter";
import { useLocalThreadListAdapter } from "./lib/threadListAdapter";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { Thread } from "./components/Thread";
import { STRINGS } from "./lib/strings";

const chatAdapter = createChatAdapter();
const useRuntime = () => useLocalRuntime(chatAdapter);

export default function App() {
  const adapter = useLocalThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useRuntime, adapter });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
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
        <div className="relative flex min-h-0 flex-1">
          {drawerOpen && (
            <div
              aria-hidden
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 z-30 bg-foreground/30 md:hidden"
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
