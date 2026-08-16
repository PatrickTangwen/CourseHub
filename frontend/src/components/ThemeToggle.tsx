import { useState } from "react";
import {
  cycleThemePreference,
  getThemePreference,
  type ThemePreference,
} from "../lib/theme";
import { STRINGS } from "../lib/strings";

const LABELS: Record<ThemePreference, string> = {
  system: STRINGS.themeSystem,
  light: STRINGS.themeLight,
  dark: STRINGS.themeDark,
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
      className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <span aria-hidden>{ICONS[pref]}</span>
    </button>
  );
};
