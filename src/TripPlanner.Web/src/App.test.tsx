import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, expect, test, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ isAuthenticated: false }),
  }));
});

test("offers both configured sign-in providers", async () => {
  render(<FluentProvider theme={webLightTheme}><App /></FluentProvider>);

  expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue with Apple" })).toBeInTheDocument();
});
