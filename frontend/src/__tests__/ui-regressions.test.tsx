import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { ThemeToggle } from "../components/ThemeToggle";
import { setThemePreference } from "../lib/theme";

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
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove("dark", "light");
});

describe("reported UI regressions", () => {
  it("switches from dark to light with one click even when the system theme is dark", async () => {
    stubSystemDark(true);
    setThemePreference("dark");
    render(<ThemeToggle />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /theme: dark/i }),
    );

    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
  });

  it("keeps the composer border unchanged when its input is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response),
    );
    render(<App />);

    const input = await screen.findByPlaceholderText(/ask about ucsd courses/i);
    await userEvent.setup().click(input);
    const composer = input.closest("form");

    expect(composer).not.toBeNull();
    expect(composer).not.toHaveClass("focus-within:border-ring");
  });
});
