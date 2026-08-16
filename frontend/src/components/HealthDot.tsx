import { useEffect, useState } from "react";
import { API_BASE } from "../lib/chatApi";
import { STRINGS } from "../lib/strings";

type HealthState = "checking" | "ok" | "down";

const POLL_INTERVAL_MS = 30_000;

/** 输入框内的连接状态胶囊:轮询 /health。全应用只此一处轮询。 */
export const HealthDot = () => {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (!cancelled) setState(res.ok ? "ok" : "down");
      } catch {
        if (!cancelled) setState("down");
      }
    };
    void check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const label =
    state === "ok"
      ? STRINGS.backendConnected
      : state === "down"
        ? STRINGS.backendDisconnected
        : STRINGS.backendChecking;
  const shortLabel =
    state === "ok"
      ? STRINGS.healthOk
      : state === "down"
        ? STRINGS.healthDown
        : STRINGS.healthChecking;
  const color =
    state === "ok"
      ? "bg-chart-2"
      : state === "down"
        ? "bg-destructive"
        : "bg-muted-foreground";

  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
      role="status"
      aria-label={label}
      title={label}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {shortLabel}
    </span>
  );
};
