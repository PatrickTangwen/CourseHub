import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  cycleThemePreference,
  getThemePreference,
  setThemePreference,
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
  document.documentElement.classList.remove("dark");
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

  it("cycles system → light → dark → system", () => {
    stubSystemDark(false);
    expect(cycleThemePreference()).toBe("light");
    expect(cycleThemePreference()).toBe("dark");
    expect(cycleThemePreference()).toBe("system");
  });
});
