import { useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { ChatAnswer } from "../lib/chatApi";
import type { ChatMessageCustom, StageRecord } from "../lib/stages";
import { buildTimeline, summarizeTimeline } from "../lib/stageDisplay";

/**
 * 过程时间线:流式期间实时逐阶段展开(替代纯 spinner);
 * 完成后收起为一行摘要,点开查看详情(置信度、三路分数、路由理由、工具耗时)。
 */
export const ProcessTimeline = () => {
  const stages = useAuiState((s): StageRecord[] | undefined =>
    s.message.role === "assistant"
      ? (s.message.metadata?.custom as ChatMessageCustom | undefined)?.stages
      : undefined,
  );
  const answer = useAuiState((s): ChatAnswer | undefined =>
    s.message.role === "assistant"
      ? ((s.message.metadata?.custom as ChatMessageCustom | undefined)?.answer as
          | ChatAnswer
          | undefined)
      : undefined,
  );
  const running = useAuiState(
    (s) => s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  if (!stages || stages.length === 0) return null;

  const expanded = userExpanded ?? running;
  const steps = buildTimeline(stages, running);

  return (
    <div
      data-testid="process-timeline"
      className="mb-2 w-fit min-w-64 max-w-full rounded-xl border border-border bg-muted/50 text-xs"
    >
      {!running && (
        <button
          type="button"
          data-testid="process-toggle"
          aria-expanded={expanded}
          onClick={() => setUserExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
        >
          <span
            aria-hidden
            className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            ▸
          </span>
          <span>{summarizeTimeline(stages, answer)}</span>
        </button>
      )}
      {expanded && (
        <ol
          data-testid="process-steps"
          className={`flex flex-col gap-1.5 px-3 pb-2.5 ${running ? "pt-2.5" : ""}`}
        >
          {steps.map((step) => (
            <li key={step.key} className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={
                  step.active
                    ? "inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] animate-pulse rounded-full bg-muted-foreground"
                    : "inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-muted-foreground/40"
                }
              />
              <span className="flex flex-col">
                <span className="text-foreground/80">
                  {step.label}
                  {step.raw && (
                    <code className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      ({step.raw})
                    </code>
                  )}
                  {step.detail && (
                    <span className="ml-1.5 text-muted-foreground">
                      {step.detail}
                    </span>
                  )}
                </span>
                {step.expandedDetail && (
                  <span className="text-[10px] text-muted-foreground">
                    {step.expandedDetail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
