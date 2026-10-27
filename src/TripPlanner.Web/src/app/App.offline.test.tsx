import { memoryStorage } from "../test/memoryStorage";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, test, expect, vi } from "vitest";
import App from "./App";
import {
  rememberOfflineUser,
  rememberTripCatalog,
  readOfflineUser,
  snapshotKey,
} from "../api/offlineCache";
import { clearTripSnapshotCache } from "../api/tripSnapshot";
const user = {
  isAuthenticated: true,
  id: "owner",
  completedOnboarding: true,
  name: "Cached Traveller",
  profile: { homeCity: null, preferredAirlines: [] },
};
const trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Cached trip",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  clearTripSnapshotCache();
  localStorage.clear();
  sessionStorage.clear();
});
function show() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </FluentProvider>,
  );
}
function seed() {
  rememberOfflineUser(user);
  rememberTripCatalog("owner", [trip]);
  sessionStorage.clear();
}
test("a fresh offline launch restores identity and downloaded trip links in read-only mode", async () => {
  seed();
  localStorage.setItem(
    snapshotKey("owner", "trip"),
    JSON.stringify({
      snapshot: {
        schemaVersion: 1,
        "@id": "urn:uuid:trip",
        resources: { "/trips/trip": { data: trip } },
      },
    }),
  );
  const network = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", network);
  show();
  expect(
    await screen.findByRole("heading", {
      name: "Welcome back, Cached Traveller.",
    }),
  ).toBeVisible();
  expect(
    await screen.findByRole("link", { name: "Open trip: Cached trip" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("User profile"));
  expect(screen.getByRole("button", { name: "Your profile" })).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "Sign in with Google" }),
  ).not.toBeInTheDocument();
});
test("a list entry without a snapshot is explained rather than offered as an offline trip", async () => {
  seed();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  show();
  expect(
    await screen.findByText(
      "Connect and open this trip once to save it offline.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Open trip: Cached trip" }),
  ).not.toBeInTheDocument();
});
test.each([401, 403])(
  "an online %s rejection clears remembered identity and never falls back",
  async (status) => {
    seed();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );
    show();
    expect(
      await screen.findByRole("link", { name: "Sign in with Google" }),
    ).toBeVisible();
    expect(readOfflineUser()).toBeUndefined();
    expect(
      localStorage.getItem("tripplanner.trip-catalog.v1:owner"),
    ).toBeNull();
  },
);
test("reconnection validates the session before enabling editing", async () => {
  seed();
  const network = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", network);
  show();
  await screen.findByRole("heading", {
    name: "Welcome back, Cached Traveller.",
  });
  network.mockImplementation(
    async (input) =>
      new Response(
        JSON.stringify(String(input).endsWith("/user") ? user : [trip]),
      ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New trip" })).toBeEnabled(),
  );
});

afterEach(() => vi.unstubAllGlobals());

test("an explicit signed-out response clears the saved account and trip list", async () => {
  seed();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          isAuthenticated: false,
          completedOnboarding: false,
          profile: user.profile,
        }),
      ),
  );
  show();
  expect(
    await screen.findByRole("link", { name: "Sign in with Google" }),
  ).toBeVisible();
  expect(readOfflineUser()).toBeUndefined();
  expect(localStorage.getItem("tripplanner.trip-catalog.v1:owner")).toBeNull();
});
test("signing in as another account removes the previous account's offline data", async () => {
  seed();
  const other = { ...user, id: "someone-else", name: "Other Traveller" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      Response.json(String(input).endsWith("/user") ? other : []),
    ),
  );
  show();
  expect(
    await screen.findByRole("heading", {
      name: "Welcome back, Other Traveller.",
    }),
  ).toBeVisible();
  expect(readOfflineUser()?.id).toBe("someone-else");
  expect(localStorage.getItem("tripplanner.trip-catalog.v1:owner")).toBeNull();
});
test("a first offline launch explains that an online sign-in is needed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  show();
  expect(
    await screen.findByText(
      "No saved account is available on this device. Open this app online and sign in first.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: /Welcome back/ }),
  ).not.toBeInTheDocument();
});
