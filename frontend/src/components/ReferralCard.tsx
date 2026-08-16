import { useAuiState } from "@assistant-ui/react";
import type { ChatMessageCustom } from "../lib/stages";
import { REFERRAL_CHANNELS, STRINGS } from "../lib/strings";

/**
 * Advisor Referral 卡:escalated=true 表示"已转介官方渠道"
 * (CONTEXT.md:不是转人工客服,语气是指路而非报错)。
 */
export const ReferralCard = () => {
  const escalated = useAuiState((s) => {
    if (s.message.role !== "assistant") return false;
    const custom = s.message.metadata?.custom as ChatMessageCustom | undefined;
    return Boolean(custom?.answer?.escalated);
  });
  if (!escalated) return null;
  return (
    <div
      data-testid="referral-card"
      className="mt-2 w-fit max-w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm"
    >
      <p className="font-medium text-foreground">{STRINGS.referralTitle}</p>
      <p className="mt-1 text-muted-foreground">{STRINGS.referralIntro}</p>
      <ul className="mt-1.5 list-disc pl-5 text-muted-foreground">
        {REFERRAL_CHANNELS.map((channel) => (
          <li key={channel.name}>
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {channel.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
