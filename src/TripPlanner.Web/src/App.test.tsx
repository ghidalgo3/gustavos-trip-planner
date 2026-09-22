import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, expect, test, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isAuthenticated: false,
        completedOnboarding: false,
      }),
    }),
  );
});

test("offers both configured sign-in providers", async () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>,
  );

  expect(
    await screen.findByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", expect.stringContaining("/.auth/login/google"));
  expect(
    screen.getByRole("link", { name: "Sign in with Microsoft" }),
  ).toHaveAttribute("href", expect.stringContaining("/.auth/login/aad"));
});

test("does not report an unavailable API when StrictMode cancels its first request", async () => {
  let requestNumber = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestNumber += 1;

      if (requestNumber === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          isAuthenticated: false,
          completedOnboarding: false,
        }),
      });
    }),
  );

  render(
    <StrictMode>
      <FluentProvider theme={webLightTheme}>
        <App />
      </FluentProvider>
    </StrictMode>,
  );

  expect(
    await screen.findByRole("link", { name: "Sign in with Google" }),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("asks a newly created user for their home city", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isAuthenticated: true,
        id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
        name: "Ada Traveler",
        provider: "google",
        completedOnboarding: false,
      }),
    }),
  );

  render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Where do you call home?" }),
  ).toBeVisible();
  expect(document.querySelector('img[src="/api/user/avatar"]')).not.toBeNull();
  expect(
    screen.queryByRole("button", { name: "Plan a trip" }),
  ).not.toBeInTheDocument();
});

test("autocompletes and saves the user's home city", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/api/user")) {
        return {
          ok: true,
          json: async () => ({
            isAuthenticated: true,
            id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
            name: "Ada Traveler",
            provider: "google",
            completedOnboarding: false,
          }),
        };
      }
      if (url.endsWith("/api/mapToken")) {
        return {
          ok: true,
          json: async () => ({
            token: "maps-sas",
            endpoint: "https://atlas.example.test",
            expiresAt: "2030-01-01T02:00:00Z",
          }),
        };
      }
      if (url.includes("geocode%3Aautocomplete")) {
        throw new Error("The autocomplete path must not be URL encoded.");
      }
      if (url.includes("/geocode:autocomplete?")) {
        expect(url).toContain("bbox=-180%2C-90%2C180%2C90");
        expect(init?.headers).toEqual({ Authorization: "jwt-sas maps-sas" });
        return {
          ok: true,
          json: async () => ({
            features: [
              {
                id: "boston",
                geometry: { coordinates: [-71.0589, 42.3601] },
                properties: {
                  address: {
                    formattedAddress: "Boston, Massachusetts, United States",
                  },
                },
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/user/homeCity")) {
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(init?.body as string)).toEqual({
          cityName: "Boston, Massachusetts, United States",
          longitude: -71.0589,
          latitude: 42.3601,
        });
        return {
          ok: true,
          json: async () => ({
            isAuthenticated: true,
            id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
            name: "Ada Traveler",
            provider: "google",
            completedOnboarding: true,
            homeCityName: "Boston, Massachusetts, United States",
          }),
        };
      }
      if (
        url.endsWith("/api/user/d8612b89-4343-4a30-aed4-6b7f2f8c8123/trips") &&
        !init?.method
      ) {
        return { ok: true, json: async () => [] };
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>,
  );

  const input = await screen.findByRole("combobox", { name: "Home city" });
  fireEvent.focus(input);
  expect(
    screen.getByRole("heading", { name: "Where do you call home?" }),
  ).toBeVisible();
  fireEvent.change(input, { target: { value: "Bos" } });
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/geocode:autocomplete?"),
      expect.objectContaining({
        headers: { Authorization: "jwt-sas maps-sas" },
      }),
    ),
  );
  fireEvent.click(
    await screen.findByRole("option", {
      name: "Boston, Massachusetts, United States",
    }),
  );
  const openHomeCity = screen.getByRole("button", {
    name: "Open Home city",
  });
  fireEvent.mouseDown(openHomeCity);
  expect(input).toHaveValue("Boston, Massachusetts, United States");
  expect(
    screen.getByRole("heading", { name: "Where do you call home?" }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Boston, Massachusetts, United States",
    }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByText("Welcome back, Ada Traveler.")).toBeVisible();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/user/homeCity"),
      expect.objectContaining({ method: "PUT" }),
    ),
  );
});
