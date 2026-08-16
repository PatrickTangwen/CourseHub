import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownText } from "./MarkdownText";
import { ProcessTimeline } from "./ProcessTimeline";
import { ReferralCard } from "./ReferralCard";
import { EXAMPLE_PROMPTS, STRINGS } from "../lib/strings";

const Welcome = () => (
  <div className="flex flex-col items-center gap-2 py-16 text-center">
    <h2 className="text-2xl font-semibold">{STRINGS.welcomeTitle}</h2>
    <p className="max-w-md text-sm text-muted-foreground">
      {STRINGS.welcomeSubtitle}
    </p>
    <div className="mt-4 flex max-w-lg flex-wrap justify-center gap-2">
      {EXAMPLE_PROMPTS.map((prompt) => (
        <ThreadPrimitive.Suggestion
          key={prompt}
          prompt={prompt}
          method="replace"
          autoSend
          className="rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {prompt}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
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

const Composer = () => (
  <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-input bg-background px-2 py-1.5 focus-within:border-ring">
    <ComposerPrimitive.Input
      rows={1}
      autoFocus
      placeholder={STRINGS.composerPlaceholder}
      className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-muted-foreground"
    />
    <ComposerPrimitive.Send
      aria-label={STRINGS.send}
      className="mb-0.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
    >
      {STRINGS.send}
    </ComposerPrimitive.Send>
  </ComposerPrimitive.Root>
);

export const Thread = () => (
  <ThreadPrimitive.Root className="flex h-full flex-col">
    <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <ThreadPrimitive.Empty>
          <Welcome />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </div>
    </ThreadPrimitive.Viewport>
    <div className="border-t border-border px-4 py-3">
      <Composer />
    </div>
  </ThreadPrimitive.Root>
);
