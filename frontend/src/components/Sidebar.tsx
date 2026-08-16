import { useMemo } from "react";
import { ThreadListItemPrimitive, ThreadListPrimitive } from "@assistant-ui/react";
import { STRINGS } from "../lib/strings";

interface SidebarProps {
  /** 移动端抽屉:选择会话后收起。 */
  onNavigate?: () => void;
}

const makeThreadListItem = (onNavigate?: () => void) => {
  const ThreadListItem = () => (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground">
      <ThreadListItemPrimitive.Trigger
        onClick={onNavigate}
        className="aui-thread-list-item-trigger"
      >
        <ThreadListItemPrimitive.Title fallback={STRINGS.newChat} />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete
        aria-label={STRINGS.deleteChat}
        className="mr-1 rounded px-1.5 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
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
      className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="p-3">
        <ThreadListPrimitive.New
          onClick={onNavigate}
          className="aui-thread-list-new flex w-full items-center bg-sidebar-accent/70 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <span aria-hidden>+</span> {STRINGS.newChat}
        </ThreadListPrimitive.New>
      </div>
      <ThreadListPrimitive.Root className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        <ThreadListPrimitive.Items components={{ ThreadListItem }} />
      </ThreadListPrimitive.Root>
    </aside>
  );
};
