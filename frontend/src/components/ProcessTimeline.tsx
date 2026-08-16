import { useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ThinkingOrb } from "thinking-orbs";
import type { ChatAnswer } from "../lib/chatApi";
import type { ChatMessageCustom, StageRecord } from "../lib/stages";
import type { IntentSignal } from "../lib/stageDisplay";
import { buildTimeline, summarizeTimeline } from "../lib/stageDisplay";
import { PROCESS_STRINGS } from "../lib/strings";

/**
 * 意图信号明细:三路各是什么、谁主导、哪一路没出力,一眼可读。
 * 没有分数的一路显示 "no signal" 而不是 0.00——后者会被读成"匹配失败",
 * 而它常常只是这一路没参与本次判定。
 */
const IntentSignals = ({ signals }: { signals: IntentSignal[] }) => (
  <span className="mt-1 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
    <span className="uppercase tracking-wide">{PROCESS_STRINGS.intentSignals}</span>
    {signals.map((signal) => (
      <span
        key={signal.key}
        data-testid={`signal-${signal.key}`}
        className="flex items-center gap-1.5"
      >
        <span className="w-28 shrink-0 truncate">{signal.label}</span>
        <span
          aria-hidden
          className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20"
        >
          <span
            className="block h-full rounded-full bg-muted-foreground/60"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, signal.score)) * 100)}%` }}
          />
        </span>
        <span className="tabular-nums">
          {signal.score > 0 ? signal.score.toFixed(2) : PROCESS_STRINGS.signalNone}
        </span>
        {signal.lead && (
          <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[9px] uppercase tracking-wide">
            {PROCESS_STRINGS.signalLead}
          </span>
        )}
        {signal.refined && (
          <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[9px] uppercase tracking-wide">
            {PROCESS_STRINGS.signalRefined}
          </span>
        )}
      </span>
    ))}
  </span>
);

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
            <li key={step.key} className="flex items-start gap-2">
              {/* 固定 20px 槽位:进行中是 orb、完成后是静态点,切换时文字不横跳。 */}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {step.active ? (
                  <ThinkingOrb aria-hidden state={step.orb} size={20} />
                ) : (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                  />
                )}
              </span>
              <span className="flex flex-col">
                <span className="leading-5 text-foreground/80">
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
                {step.signals && <IntentSignals signals={step.signals} />}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
