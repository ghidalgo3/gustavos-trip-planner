import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(
    await screen.findByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", expect.stringContaining("/.auth/login/google"));
  expect(
    screen.getByRole("link", { name: "Sign in with Microsoft" }),
  ).toHaveAttribute("href", expect.stringContaining("/.auth/login/aad"));
});

test("opens the profile route from the user menu and keeps sign out there", async () => {
  let userReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/user")) {
        userReads += 1;
        return {
          ok: true,
          json: async () => ({
            isAuthenticated: true,
            completedOnboarding: true,
            id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
            name: "Ada Traveler",
            ...(userReads > 1
              ? {
                  profile: {
                    homeCity: { name: "Boston", longitude: -71, latitude: 42 },
                    preferredAirlines: [],
                  },
                }
              : {}),
          }),
        };
      }
      return { ok: true, json: async () => [] };
    }),
  );
  function RouteState() {
    return <div data-testid="route">{useLocation().pathname}</div>;
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <RouteState />
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );

  fireEvent.click(await screen.findByLabelText("User profile"));
  expect(screen.getByRole("link", { name: "Sign out" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Your profile" }));
  expect(
    await screen.findByRole("heading", { name: "Your profile" }),
  ).toBeVisible();
  expect(screen.getByTestId("route")).toHaveTextContent("/profile");
  expect(screen.getByRole("combobox", { name: "Home city" })).toHaveValue(
    "Boston",
  );
  expect(userReads).toBe(2);
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
        <MemoryRouter>
          <App />
        </MemoryRouter>
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Where do you call home?" }),
  ).toBeVisible();
  expect(document.querySelector('img[src="/user/avatar"]')).not.toBeNull();
  expect(
    screen.queryByRole("button", { name: "Plan a trip" }),
  ).not.toBeInTheDocument();
});

test("autocompletes and saves the user's home city", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/airports/home"))
        return Response.json([{ code: "BOS", name: "Logan", city: "Boston" }]);
      if (url.endsWith("/user")) {
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
      if (url.endsWith("/mapToken")) {
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
      if (url.endsWith("/user/profile")) {
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(init?.body as string)).toEqual({
          homeCity: {
            name: "Boston, MA, United States",
            longitude: -71.0589,
            latitude: 42.3601,
          },
          preferredAirlines: [],
          preferredAirport: "BOS",
        });
        return {
          ok: true,
          json: async () => ({
            isAuthenticated: true,
            id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
            name: "Ada Traveler",
            provider: "google",
            completedOnboarding: true,
            profile: {
              homeCity: {
                name: "Boston, MA, United States",
                longitude: -71.0589,
                latitude: 42.3601,
              },
              preferredAirlines: [],
            },
          }),
        };
      }
      if (
        url.endsWith("/user/d8612b89-4343-4a30-aed4-6b7f2f8c8123/trips") &&
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
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
      name: "Boston, MA, United States",
    }),
  );
  const openHomeCity = screen.getByRole("button", {
    name: "Open Home city",
  });
  fireEvent.mouseDown(openHomeCity);
  expect(input).toHaveValue("Boston, MA, United States");
  expect(
    screen.getByRole("heading", { name: "Where do you call home?" }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Boston, MA, United States",
    }),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByText("Welcome back, Ada Traveler.")).toBeVisible();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/user/profile"),
      expect.objectContaining({ method: "PUT" }),
    ),
  );
});

test("loads a trip from its route and returns to the trips page", async () => {
  const userId = "d8612b89-4343-4a30-aed4-6b7f2f8c8123";
  const trip = {
    id: "trip-1",
    ownerUserId: userId,
    name: "Paris spring",
    description: "",
    constraints: {},
    createdAt: "2030-01-01T00:00:00Z",
    updatedAt: "2030-01-01T00:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/user"))
        return {
          ok: true,
          json: async () => ({
            isAuthenticated: true,
            completedOnboarding: true,
            id: userId,
            name: "Ada Traveler",
            profile: {
              homeCity: { name: "Boston", longitude: -71, latitude: 42 },
              preferredAirlines: [],
            },
          }),
        };
      if (url.endsWith(`/user/${userId}/trips/trip-1`))
        return { ok: true, json: async () => trip };
      if (url.endsWith("/trips/trip-1/flights"))
        return { ok: true, status: 204 };
      if (url.endsWith("/trips/trip-1/flights/constraints"))
        return {
          ok: true,
          json: async () => ({
            document: {
              schemaVersion: 1,
              travelDates: null,
              destination: null,
              parties: [],
              constraints: [],
            },
          }),
        };
      if (url.endsWith("/trips/trip-1/parties"))
        return {
          ok: true,
          json: async () => [
            { id: "party-1", members: [{ id: userId, name: "Ada" }] },
          ],
        };
      if (url.endsWith(`/user/${userId}/trips`))
        return { ok: true, json: async () => [trip] };
      if (url.includes("/operations?"))
        return { ok: true, json: async () => [] };
      throw new Error(`Unexpected request: ${url}`);
    }),
  );

  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="route">{location.pathname}</output>;
  }

  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/trips/trip-1"]}>
        <LocationProbe />
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Paris spring" }),
  ).toBeVisible();
  expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1");
  fireEvent.click(screen.getByRole("button", { name: "Back to trips" }));
  expect(
    await screen.findByRole("heading", { name: "Welcome back, Ada Traveler." }),
  ).toBeVisible();
  expect(screen.getByTestId("route")).toHaveTextContent("/");
  fireEvent.click(screen.getByRole("button", { name: "Find flights" }));
  expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1");
  fireEvent.click(await screen.findByRole("tab", { name: "Plans" }));
  expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1/plans");
  expect(
    await screen.findByRole("heading", { name: "Trip overview" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Stays" }));
  expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1/stays");
});
