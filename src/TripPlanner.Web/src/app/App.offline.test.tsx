import { tripDocumentFixture } from "../test/tripDocumentFixture";
import { memoryStorage } from "../test/memoryStorage";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, test, expect, vi } from "vitest";
import App from "./App";
import {
  rememberOfflineUser,
  rememberTripCatalog,
  readOfflineUser,
  documentKey,
} from "../api/offlineCache";
import { clearTripDocumentCache } from "../api/tripDocumentStore";
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
  clearTripDocumentCache();
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
    documentKey("owner", "trip"),
    JSON.stringify({
      document: tripDocumentFixture(trip),
    }),
  );
  const network = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", network);
  show();
  expect(
    await screen.findByRole("region", { name: "Your trips" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("link", { name: "Open trip: Cached trip" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
  expect(screen.queryByText("Offline · View only")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Showing your saved trips."),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("User profile"));
  expect(screen.getByRole("button", { name: "Your profile" })).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "Sign in with Google" }),
  ).not.toBeInTheDocument();
});
test("a list entry without a document is explained rather than offered as an offline trip", async () => {
  seed();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  show();
  expect(await screen.findByText("Connect to open this trip.")).toBeVisible();
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
  await screen.findByRole("region", { name: "Your trips" });
  network.mockImplementation(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).endsWith("/user")
            ? user
            : { trips: [trip], hasMore: false },
        ),
      ),
  );
  fireEvent(window, new Event("online"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New trip" })).toBeEnabled(),
  );
});

test("one compact notice appears after 30 offline seconds while editing is disabled immediately", async () => {
  seed();
  const network = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", network);
  vi.useFakeTimers();
  try {
    show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
    expect(screen.queryByText("Offline · View only")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(screen.queryByText("Offline · View only")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Offline · View only");
    expect(
      screen.queryByText("Showing your saved trips."),
    ).not.toBeInTheDocument();
    network.mockImplementation(async (input) =>
      Response.json(
        String(input).endsWith("/user")
          ? user
          : { trips: [trip], hasMore: false },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Offline · View only")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New trip" })).toBeEnabled();
  } finally {
    vi.useRealTimers();
  }
});

test("a brief request failure recovers before the offline notice appears", async () => {
  seed();
  const network = vi
    .fn()
    .mockRejectedValue(new TypeError("temporarily unavailable"));
  vi.stubGlobal("fetch", network);
  vi.useFakeTimers();
  try {
    show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
    network.mockImplementation(async (input) =>
      Response.json(
        String(input).endsWith("/user")
          ? user
          : { trips: [trip], hasMore: false },
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole("button", { name: "New trip" })).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByText("Offline · View only")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

afterEach(() => vi.unstubAllGlobals());

test("an explicit signed-out response clears the saved account and trip list", async () => {
  seed();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
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
      Response.json(
        String(input).endsWith("/user") ? other : { trips: [], hasMore: false },
      ),
    ),
  );
  show();
  expect(
    await screen.findByRole("region", { name: "Your trips" }),
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
