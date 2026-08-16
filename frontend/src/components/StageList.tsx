import { useAuiState } from "@assistant-ui/react";
import type { ChatMessageCustom, StageRecord } from "../lib/stages";

/**
 * 占位版阶段列表(T2):按到达顺序原样列出阶段事件。
 * 正式的可折叠时间线与领域术语映射在 T3 落地。
 */
export const StageList = () => {
  const stages = useAuiState((s): StageRecord[] | undefined =>
    s.message.role === "assistant"
      ? (s.message.metadata?.custom as ChatMessageCustom | undefined)?.stages
      : undefined,
  );
  if (!stages || stages.length === 0) return null;
  return (
    <ol
      data-testid="stage-list"
      className="mb-2 flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
    >
      {stages.map((stage, i) => (
        <li key={i}>
          {stage.event}
          {stage.event.startsWith("tool_call") &&
          stage.data != null &&
          typeof stage.data === "object" &&
          "tool_name" in stage.data
            ? `: ${String((stage.data as { tool_name: unknown }).tool_name)}`
            : ""}
        </li>
      ))}
    </ol>
  );
};
