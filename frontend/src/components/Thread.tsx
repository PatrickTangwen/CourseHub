import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { HealthDot } from "./HealthDot";
import { MarkdownText } from "./MarkdownText";
import { ProcessTimeline } from "./ProcessTimeline";
import { ReferralCard } from "./ReferralCard";
import {
  ArrowUpIcon,
  BookIcon,
  CalendarIcon,
  ListIcon,
  PersonIcon,
} from "./icons";
import { useStickToBottom } from "../lib/stickToBottom";
import { EXAMPLE_PROMPTS, STRINGS } from "../lib/strings";

const PROMPT_ICONS = {
  course: BookIcon,
  professor: PersonIcon,
  prereq: ListIcon,
  planning: CalendarIcon,
};

const Welcome = () => (
  <div className="mb-8 flex flex-col items-center gap-2 px-4 text-center">
    <h2 className="text-3xl font-semibold">{STRINGS.welcomeTitle}</h2>
    <p className="max-w-md text-sm text-muted-foreground">
      {STRINGS.welcomeSubtitle}
    </p>
  </div>
);

const Suggestions = () => (
  <div className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-2">
    {EXAMPLE_PROMPTS.map(({ icon, prompt }) => {
      const Icon = PROMPT_ICONS[icon];
      return (
        <ThreadPrimitive.Suggestion
          key={prompt}
          prompt={prompt}
          method="replace"
          autoSend
          className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Icon />
          {prompt}
        </ThreadPrimitive.Suggestion>
      );
    })}
  </div>
);

const UserMessage = () => (
  <MessagePrimitive.Root className="flex justify-end">
    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2.5">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

const MessageError = () => {
  const hasError = useAuiState(
    (s) =>
      s.message.role === "assistant" &&
      s.message.status?.type === "incomplete" &&
      s.message.status.reason === "error",
  );
  if (!hasError) return null;
  return (
    <ErrorPrimitive.Root className="mt-1 flex w-fit items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <ErrorPrimitive.Message />
      <ActionBarPrimitive.Reload className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium hover:bg-destructive/20">
        {STRINGS.retry}
      </ActionBarPrimitive.Reload>
    </ErrorPrimitive.Root>
  );
};

const AssistantMessage = () => (
  <MessagePrimitive.Root className="flex flex-col">
    <ProcessTimeline />
    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
    <ReferralCard />
    <MessageError />
  </MessagePrimitive.Root>
);

/**
 * 输入框:上行文本区 + 下行工具条,同一个圆角容器。
 * 工具条只显示后端连接状态和发送；新建会话统一从侧边栏进入。
 */
const Composer = () => (
  <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-3xl border border-input bg-muted/50 px-4 py-3">
    {/* w-full 必需:autosize 在 flex-col 里没有显式宽度时首帧会量出错误高度。 */}
    <ComposerPrimitive.Input
      rows={1}
      autoFocus
      placeholder={STRINGS.composerPlaceholder}
      className="max-h-40 w-full resize-none bg-transparent pt-1 outline-none placeholder:text-muted-foreground"
    />
    <div className="flex items-center gap-2">
      <HealthDot />
      <ComposerPrimitive.Send
        aria-label={STRINGS.send}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
      >
        <ArrowUpIcon />
      </ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>
);

export const Thread = () => {
  // 空态照 ChatGPT 的样子把输入框放到屏幕中央;有消息后落回底部。
  // 输入框在两种布局里是同一个节点(位置不变,只换 class),不会重挂。
  const isEmpty = useAuiState((s) => s.thread.isEmpty);
  // 滚动归浏览器窗口,所以 Viewport 的自动滚动关掉,由窗口级跟随接管。
  useStickToBottom();
  return (
    <ThreadPrimitive.Root
      className={`flex flex-1 flex-col ${isEmpty ? "justify-center" : ""}`}
    >
      {isEmpty && <Welcome />}
      {/* Viewport 的 flex-1:内容不足时也吃掉剩余高度,把输入框自然推到视口
          底部(sticky 只在元素将被滚出时才粘住,不会自己下沉)。 */}
      {!isEmpty && (
        <ThreadPrimitive.Viewport autoScroll={false} className="flex-1 px-4 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4">
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </div>
        </ThreadPrimitive.Viewport>
      )}
      {/* 贴底:整页滚动时输入框始终可见,背景挡住从下方滚过的消息。 */}
      <div
        className={`px-4 ${
          isEmpty ? "pb-12" : "sticky bottom-0 bg-background py-3"
        }`}
      >
        <Composer />
        {isEmpty && <Suggestions />}
      </div>
    </ThreadPrimitive.Root>
  );
};
