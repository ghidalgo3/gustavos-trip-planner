import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ColorSchemeProvider from "./ColorSchemeProvider";

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
