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

/* 官方 demo 形态:aui-* styled 类挂在 primitives 上(@assistant-ui/styles)。 */

const Welcome = () => (
  <div className="aui-thread-welcome-root">
    <div className="aui-thread-welcome-center px-4 text-center">
      <h2 className="animate-in fade-in slide-in-from-bottom-1 text-2xl font-semibold duration-200">
        {STRINGS.welcomeTitle}
      </h2>
      <p className="animate-in fade-in slide-in-from-bottom-1 mt-1.5 max-w-md text-base text-muted-foreground delay-75 duration-200">
        {STRINGS.welcomeSubtitle}
      </p>
    </div>
  </div>
);

const WelcomeSuggestions = () => (
  <div className="flex flex-wrap justify-center gap-2">
    {EXAMPLE_PROMPTS.map((prompt) => (
      <ThreadPrimitive.Suggestion
        key={prompt}
        prompt={prompt}
        method="replace"
        autoSend
        className="aui-thread-followup-suggestion border-border"
      >
        {prompt}
      </ThreadPrimitive.Suggestion>
    ))}
  </div>
);

const UserMessage = () => (
  <MessagePrimitive.Root className="aui-user-message-root">
    <div className="aui-user-message-content-wrapper">
      <div className="aui-user-message-content whitespace-pre-wrap">
        <MessagePrimitive.Content />
      </div>
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
    <ErrorPrimitive.Root className="mx-2 mt-1 flex w-fit items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <ErrorPrimitive.Message />
      <ActionBarPrimitive.Reload className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium hover:bg-destructive/20">
        {STRINGS.retry}
      </ActionBarPrimitive.Reload>
    </ErrorPrimitive.Root>
  );
};

const AssistantMessage = () => (
  <MessagePrimitive.Root className="aui-assistant-message-root">
    <div className="mx-2">
      <ProcessTimeline />
    </div>
    <div className="aui-assistant-message-content">
      <MessagePrimitive.Content components={{ Text: MarkdownText }} />
    </div>
    <div className="mx-2">
      <ReferralCard />
    </div>
    <MessageError />
  </MessagePrimitive.Root>
);

const ArrowUpIcon = () => (
  <svg
    aria-hidden
    className="aui-composer-send-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

const Composer = () => (
  <ComposerPrimitive.Root className="aui-composer-root rounded-3xl border border-border bg-muted/30 focus-within:border-ring/40 dark:bg-muted/20">
    <ComposerPrimitive.Input
      rows={1}
      autoFocus
      placeholder={STRINGS.composerPlaceholder}
      className="aui-composer-input"
    />
    <div className="aui-composer-action-wrapper">
      <span className="px-2 text-xs text-muted-foreground">{STRINGS.tagline}</span>
      <ComposerPrimitive.Send
        aria-label={STRINGS.send}
        className="aui-composer-send flex items-center justify-center bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
      >
        <ArrowUpIcon />
      </ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>
);

export const Thread = () => (
  <ThreadPrimitive.Root className="aui-thread-root @container flex h-full flex-col bg-background">
    <ThreadPrimitive.Viewport className="aui-thread-viewport">
      <ThreadPrimitive.Empty>
        <Welcome />
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer">
        <Composer />
        <ThreadPrimitive.Empty>
          <WelcomeSuggestions />
        </ThreadPrimitive.Empty>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
);
