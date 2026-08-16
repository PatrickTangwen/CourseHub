import {
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { MarkdownText } from "./MarkdownText";
import { ProcessTimeline } from "./ProcessTimeline";
import { STRINGS } from "../lib/strings";

const Welcome = () => (
  <div className="flex flex-col items-center gap-2 py-16 text-center">
    <h2 className="text-2xl font-semibold">{STRINGS.welcomeTitle}</h2>
    <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
      {STRINGS.welcomeSubtitle}
    </p>
  </div>
);

const UserMessage = () => (
  <MessagePrimitive.Root className="flex justify-end">
    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

const MessageError = () => (
  <ErrorPrimitive.Root>
    {/* Message renders null when the message has no error. */}
    <ErrorPrimitive.Message className="mt-1 inline-block w-fit rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" />
  </ErrorPrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="flex flex-col">
    <ProcessTimeline />
    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
    <MessageError />
  </MessagePrimitive.Root>
);

const Composer = () => (
  <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-zinc-300 bg-white px-2 py-1.5 focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-400">
    <ComposerPrimitive.Input
      rows={1}
      autoFocus
      placeholder={STRINGS.composerPlaceholder}
      className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-zinc-400"
    />
    <ComposerPrimitive.Send
      aria-label={STRINGS.send}
      className="mb-0.5 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
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
    <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <Composer />
    </div>
  </ThreadPrimitive.Root>
);
