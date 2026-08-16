/**
 * 主题:默认跟随系统;用户手动选择后持久化到 localStorage。
 * Tailwind 用 class 策略(.dark),由这里统一施加。
 *
 * .light 同时显式施加:第三方组件(如 thinking-orbs)按 dark/light class 判定
 * 主题,两个都找不到才回落 prefers-color-scheme。只写 .dark 的话,"手动选 light
 * + 系统偏好 dark" 会让它们判成 dark,在浅色页面上画浅色墨迹。
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
  const dark = effectiveDark(pref);
  const classes = document.documentElement.classList;
  classes.toggle("dark", dark);
  classes.toggle("light", !dark);
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
