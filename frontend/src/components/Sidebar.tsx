import { useMemo } from "react";
import { ThreadListItemPrimitive, ThreadListPrimitive } from "@assistant-ui/react";
import { STRINGS } from "../lib/strings";

interface SidebarProps {
  /** 移动端抽屉:选择会话后收起。 */
  onNavigate?: () => void;
}

const makeThreadListItem = (onNavigate?: () => void) => {
  const ThreadListItem = () => (
    <ThreadListItemPrimitive.Root className="group flex items-center gap-1 rounded-lg hover:bg-zinc-100 data-active:bg-zinc-100 dark:hover:bg-zinc-800 dark:data-active:bg-zinc-800">
      <ThreadListItemPrimitive.Trigger
        onClick={onNavigate}
        className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm"
      >
        <ThreadListItemPrimitive.Title fallback={STRINGS.newChat} />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete
        aria-label={STRINGS.deleteChat}
        className="mr-1 rounded px-1.5 py-0.5 text-zinc-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
      >
        ×
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
  return ThreadListItem;
};

export const Sidebar = ({ onNavigate }: SidebarProps) => {
  const ThreadListItem = useMemo(() => makeThreadListItem(onNavigate), [onNavigate]);
  return (
    <aside
      data-testid="thread-sidebar"
      className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900 md:dark:bg-zinc-900/50"
    >
      <div className="p-3">
        <ThreadListPrimitive.New
          onClick={onNavigate}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + {STRINGS.newChat}
        </ThreadListPrimitive.New>
      </div>
      <ThreadListPrimitive.Root className="flex-1 overflow-y-auto px-3 pb-3">
        <ThreadListPrimitive.Items components={{ ThreadListItem }} />
      </ThreadListPrimitive.Root>
    </aside>
  );
};
