import { useMemo } from "react";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { createChatAdapter } from "./lib/chatAdapter";
import { Thread } from "./components/Thread";
import { STRINGS } from "./lib/strings";

export default function App() {
  const adapter = useMemo(() => createChatAdapter(), []);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="text-base font-semibold">{STRINGS.appName}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {STRINGS.tagline}
          </span>
        </header>
        <main className="min-h-0 flex-1">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}
