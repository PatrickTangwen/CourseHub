/**
 * 主题:默认跟随系统;用户手动选择后持久化到 localStorage。
 * Tailwind 用 class 策略(.dark),由这里统一施加。
 */
export type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "coursehub.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function effectiveDark(pref: ThemePreference): boolean {
  return pref === "dark" || (pref === "system" && media().matches);
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.classList.toggle("dark", effectiveDark(pref));
}

export function setThemePreference(pref: ThemePreference): void {
  if (pref === "system") {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, pref);
  }
  applyTheme(pref);
}

/** system → light → dark → system */
export function cycleThemePreference(): ThemePreference {
  const order: ThemePreference[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(getThemePreference()) + 1) % order.length];
  setThemePreference(next);
  return next;
}

export function initTheme(): void {
  applyTheme(getThemePreference());
  media().addEventListener?.("change", () => {
    if (getThemePreference() === "system") applyTheme("system");
  });
}
