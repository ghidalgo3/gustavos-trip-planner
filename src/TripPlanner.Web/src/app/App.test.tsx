import { tripDocumentFixture } from "../test/tripDocumentFixture";
import { clearTripDocumentCache } from "../api/tripDocumentStore";
import { StrictMode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  clearTripDocumentCache();
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

test("the footer opens public notices without signing in", async () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );
  const footer = document.querySelector("footer")!;
  const link = within(footer).getByRole("link", { name: "Notices" });
  expect(link).toHaveAttribute("href", "/notices");
  fireEvent.click(link);
  expect(await screen.findByRole("heading", { name: "Notices" })).toBeVisible();
  expect(screen.getByRole("link", { name: "City Icons" })).toHaveAttribute(
    "href",
    "https://svgcities.com/",
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "Third-party software licenses" }),
  ).toHaveAttribute("href", "/notices/software-licenses.txt");
  const city = screen.getByRole("link", { name: "City Icons" }).closest("li")!;
  expect(
    within(city).getByText(/^City Icons by Studio Partdirector/),
  ).toBeVisible();
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
      return { ok: true, json: async () => ({ trips: [], hasMore: false }) };
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
  expect(
    screen.queryByRole("link", { name: "Icon credits" }),
  ).not.toBeInTheDocument();
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
        url.includes("/user/d8612b89-4343-4a30-aed4-6b7f2f8c8123/trips?") &&
        !init?.method
      ) {
        return { ok: true, json: async () => ({ trips: [], hasMore: false }) };
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

  expect(await screen.findByRole("button", { name: "New trip" })).toBeVisible();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/user/profile"),
      expect.objectContaining({ method: "PUT" }),
    ),
  );
});

test.each([false, true])(
  "owner or planner can navigate planning and Party sections, planner=%s",
  async (planner) => {
    const userId = "d8612b89-4343-4a30-aed4-6b7f2f8c8123";
    const trip = {
      id: "trip-1",
      ownerUserId: planner ? "different-owner" : userId,
      canPlan: planner,
      name: "Paris spring",
      description: "A spring getaway in Paris.",
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
        if (url.endsWith("/trips/trip-1/document")) {
          return Response.json(
            tripDocumentFixture(trip, {
              people: [
                {
                  id: userId,
                  name: "Ada",
                  role: "Planner",
                  isOwner: !planner,
                  homeCityName: null,
                },
              ],
              preferences: {
                constraints: {},
                activities: {},
                destinations: [],
                groups: [{ id: "party-1", personIds: [userId] }],
                flightChoices: [],
              },
            }),
            { headers: { ETag: '"document-1"' } },
          );
        }
        if (url.endsWith("/trips/trip-1/flights/constraints"))
          return Response.json({
            schemaVersion: 1,
            visits: [],
            parties: [],
            constraints: [],
          });
        if (url.endsWith(`/user/${userId}/trips/trip-1`))
          return { ok: true, json: async () => trip };
        if (url.endsWith("/trips/trip-1/destinations"))
          return {
            ok: true,
            json: async () => ({
              type: "FeatureCollection",
              features: [],
              route: [],
            }),
          };
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
        if (url.includes(`/user/${userId}/trips?`))
          return {
            ok: true,
            json: async () => ({ trips: [trip], hasMore: false }),
          };
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
    expect(
      screen.queryByText("A spring getaway in Paris."),
    ).not.toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Overview")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(breadcrumb).getByRole("link", { name: "Trips" }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.queryByRole("navigation", { name: "Trip sections" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Your trip starts here" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add destination" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("navigation", { name: "Trip pages" }),
    ).not.toBeInTheDocument();
    const share = screen.getByRole("button", { name: "Share" });
    expect(share.closest("header")).not.toBeNull();
    fireEvent.click(share);
    expect(screen.getByTestId("route")).toHaveTextContent(
      "/trips/trip-1/party",
    );
    const currentBreadcrumb = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(within(currentBreadcrumb).getByText("Party")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("heading", { name: "Party" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Share" }),
    ).not.toBeInTheDocument();
    if (planner)
      expect(
        screen.queryByRole("combobox", { name: "Add traveler" }),
      ).not.toBeInTheDocument();
    fireEvent.click(
      within(currentBreadcrumb).getByRole("link", { name: "Overview" }),
    );
    expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1");
    expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Trip party" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Trip Planner" }));
    expect(screen.getByTestId("route")).toHaveTextContent("/");
    expect(
      await screen.findByRole("button", { name: "New trip" }),
    ).toBeVisible();
  },
);
