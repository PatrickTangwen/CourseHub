import { useState } from "react";
import {
  cycleThemePreference,
  getThemePreference,
  type ThemePreference,
} from "../lib/theme";

const LABELS: Record<ThemePreference, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

const ICONS: Record<ThemePreference, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export const ThemeToggle = () => {
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference());
  return (
    <button
      type="button"
      aria-label={LABELS[pref]}
      title={LABELS[pref]}
      onClick={() => setPref(cycleThemePreference())}
      className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      <span aria-hidden>{ICONS[pref]}</span>
    </button>
  );
};
