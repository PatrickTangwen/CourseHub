import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createChatAdapter } from "./lib/chatAdapter";
import { useLocalThreadListAdapter } from "./lib/threadListAdapter";
import { HealthDot } from "./components/HealthDot";
import { Sidebar } from "./components/Sidebar";
import { Thread } from "./components/Thread";
import { STRINGS } from "./lib/strings";

const chatAdapter = createChatAdapter();
const runtimeHook = () => useLocalRuntime(chatAdapter);

export default function App() {
  const adapter = useLocalThreadListAdapter();
  const runtime = useRemoteThreadListRuntime({ runtimeHook, adapter });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="text-base font-semibold">{STRINGS.appName}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {STRINGS.tagline}
          </span>
          <HealthDot />
        </header>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-h-0 min-w-0 flex-1">
            <Thread />
          </main>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
