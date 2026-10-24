import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Portal } from "@fluentui/react-components";
import ColorSchemeProvider from "./ColorSchemeProvider";

afterEach(() => vi.unstubAllGlobals());

test("tracks the browser color-scheme preference", () => {
  let darkMode = true;
  let onChange: ((event: MediaQueryListEvent) => void) | undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: darkMode,
      media: query,
      onchange: null,
      addEventListener: (
        _event: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        onChange = listener;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  render(
    <ColorSchemeProvider>
      <div>Trip Planner</div>
    </ColorSchemeProvider>,
  );

  const provider = screen.getByText("Trip Planner").parentElement!;
  expect(provider).toHaveAttribute("data-color-scheme", "dark");

  darkMode = false;
  act(() => onChange?.({ matches: darkMode } as MediaQueryListEvent));
  expect(provider).toHaveAttribute("data-color-scheme", "light");
});

test.each([false, true])(
  "portals retain theme tokens without inheriting the opaque app shell (dark: %s)",
  (dark) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: dark,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <ColorSchemeProvider>
        <span>Page content</span>
        <Portal>
          <span>Overlay content</span>
        </Portal>
      </ColorSchemeProvider>,
    );
    const appShell = screen.getByText("Page content").closest(".app-theme")!;
    const portal = screen
      .getByText("Overlay content")
      .closest("[data-portal-node]")!;
    expect(appShell).toHaveAttribute(
      "data-color-scheme",
      dark ? "dark" : "light",
    );
    expect(portal).not.toHaveClass("app-theme");
    expect(portal).not.toHaveClass("fui-FluentProvider");
    const themeClass = [...appShell.classList].find((name) =>
      name.startsWith("fui-FluentProvider_"),
    );
    expect(themeClass).toBeDefined();
    expect(portal).toHaveClass(themeClass!);
  },
);
