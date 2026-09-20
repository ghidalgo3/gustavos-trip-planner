import { StrictMode } from "react";
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

  expect(await screen.findByRole("link", { name: "Continue with Google" }))
    .toHaveAttribute("href", expect.stringContaining("/.auth/login/google"));
  expect(screen.getByRole("link", { name: "Continue with Microsoft" }))
    .toHaveAttribute("href", expect.stringContaining("/.auth/login/aad"));
});

test("does not report an unavailable API when StrictMode cancels its first request", async () => {
  let requestNumber = 0;
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    requestNumber += 1;

    if (requestNumber === 1) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({ isAuthenticated: false }),
    });
  }));

  render(
    <StrictMode>
      <FluentProvider theme={webLightTheme}><App /></FluentProvider>
    </StrictMode>,
  );

  expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
