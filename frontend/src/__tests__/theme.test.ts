import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemePreference,
  setThemePreference,
  toggleThemePreference,
} from "../lib/theme";

function stubSystemDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark", "light");
  vi.unstubAllGlobals();
});

describe("theme", () => {
  it("defaults to system preference", () => {
    stubSystemDark(true);
    expect(getThemePreference()).toBe("system");
    applyTheme(getThemePreference());
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    stubSystemDark(false);
    applyTheme(getThemePreference());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("manual choice overrides system and persists", () => {
    stubSystemDark(true);
    setThemePreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("coursehub.theme")).toBe("light");

    setThemePreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    setThemePreference("system");
    expect(localStorage.getItem("coursehub.theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("states the active theme explicitly, so 'no dark class' never has to mean light", () => {
    // 第三方组件(thinking-orbs)按 dark/light class 判定主题,找不到就回落
    // prefers-color-scheme——手动选 light 而系统偏好 dark 时会判反。
    stubSystemDark(true);
    setThemePreference("light");
    const classes = document.documentElement.classList;
    expect(classes.contains("light")).toBe(true);
    expect(classes.contains("dark")).toBe(false);

    setThemePreference("dark");
    expect(classes.contains("dark")).toBe(true);
    expect(classes.contains("light")).toBe(false);
  });

  it("toggles the effective light/dark theme in one click", () => {
    stubSystemDark(false);
    expect(toggleThemePreference()).toBe("dark");
    expect(toggleThemePreference()).toBe("light");

    localStorage.clear();
    stubSystemDark(true);
    expect(toggleThemePreference()).toBe("light");
  });
});
