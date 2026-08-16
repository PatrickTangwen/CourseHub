import { useCallback, useEffect, useRef } from "react";
import { useAuiState } from "@assistant-ui/react";

/**
 * 窗口级"贴底跟随"。
 *
 * assistant-ui 的 Viewport 自动滚动把滚动容器写死成它自己那个 div
 * (div.scrollTo / div.scrollTop / div.clientHeight),整页滚动时那套逻辑
 * 恒等于"已在底部",不会跟随流式内容。这里用同一套规则接管 window。
 *
 * 两条信号缺一不可,和库内部一样:
 *   - 内容尺寸变化(ResizeObserver):覆盖流式 token 累积、markdown 重排、
 *     时间线展开这类连续增长;
 *   - 线程状态变化(新消息 / run 起止):覆盖内容刚插入、尺寸还没结算的那一帧。
 */

/**
 * 判定"在底部"的容差。流式期间高度持续变化,滚动事件与布局之间总有一两帧的
 * 偏差;容差太小会把这种抖动误判成"用户上滚"而断掉跟随。
 */
const BOTTOM_TOLERANCE_PX = 32;

const pageBottom = () => document.documentElement.scrollHeight;

const isAtBottom = () =>
  window.innerHeight + window.scrollY >= pageBottom() - BOTTOM_TOLERANCE_PX;

export function useStickToBottom(): void {
  const sticking = useRef(true);
  const wasRunning = useRef(false);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const messageCount = useAuiState((s) => s.thread.messages.length);

  const follow = useCallback(() => {
    if (sticking.current) window.scrollTo({ top: pageBottom() });
  }, []);

  useEffect(() => {
    const onScroll = () => {
      sticking.current = isAtBottom();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(follow);
    observer.observe(document.body);

    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [follow]);

  useEffect(() => {
    // 新一轮开始:无条件回到底部并恢复跟随——用户刚发出的问题必须可见,
    // 哪怕他上一轮翻到了历史记录里(与库的 scrollToBottomOnRunStart 同义)。
    if (isRunning && !wasRunning.current) sticking.current = true;
    wasRunning.current = isRunning;
    follow();
  }, [isRunning, messageCount, follow]);
}
