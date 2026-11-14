import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import ActivityLog from "./ActivityLog";
import ConnectedAgents from "../profile/ConnectedAgents";

function show(component: React.ReactNode) {
  return render(
    <FluentProvider theme={webLightTheme}>{component}</FluentProvider>,
  );
}

test("shows agent actions with the person, trip and timestamp, then loads older changes", async () => {
  const entry = {
    id: "entry-1",
    occurredAt: "2026-10-16T12:30:00Z",
    actorUserId: "ada",
    actorName: "Ada Traveler",
    source: "ChatGPT",
    action: "Saved activity",
    tripId: "trip-1",
    tripName: "Autumn in Paris",
    resourceId: "activity-1",
    description: "Visit the Louvre",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ entries: [entry], hasMore: true }))
    .mockResolvedValueOnce(
      Response.json({
        entries: [
          {
            ...entry,
            id: "entry-2",
            action: "Created trip",
            source: "Website",
            description: "Created trip",
          },
        ],
        hasMore: false,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  show(<ActivityLog />);
  expect(screen.getByRole("status", { name: "Loading activity" })).toHaveClass(
    "fui-Skeleton",
  );
  expect(document.querySelector(".fui-Spinner")).toBeNull();
  expect(await screen.findByText("Visit the Louvre")).toBeVisible();
  expect(screen.getByText("MCP", { selector: ".fui-Badge" })).toBeVisible();
  expect(screen.getByText("By Ada Traveler · ChatGPT")).toBeVisible();
  expect(screen.getByText(/Autumn in Paris/)).toBeVisible();
  expect(document.querySelector("time")).toHaveAttribute(
    "dateTime",
    entry.occurredAt,
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
  expect(screen.getByText("Visit the Louvre")).toBeVisible();
  expect(screen.getByRole("status", { name: "Loading activity" })).toHaveClass(
    "fui-Skeleton",
  );
  expect(await screen.findByText("Created trip")).toBeVisible();
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("skip=1"),
    expect.objectContaining({ credentials: "include" }),
  );
  expect(
    screen.queryByRole("button", { name: "Load more activity" }),
  ).toBeNull();
});

test.each([false, true])(
  "shows an empty log and recovers from a load error: %s",
  async (fail) => {
    const fetch = vi.fn();
    if (fail)
      fetch.mockRejectedValueOnce(new Error("Unable to load activity."));
    fetch.mockResolvedValue(Response.json({ entries: [], hasMore: false }));
    vi.stubGlobal("fetch", fetch);
    show(<ActivityLog />);
    if (fail) {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load activity.",
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    }
    expect(await screen.findByText("No trip changes yet.")).toBeVisible();
  },
);

test("disconnects ChatGPT without removing historical activity", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ enabled: true, connected: true }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  show(<ConnectedAgents />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Disconnect ChatGPT" }),
  );
  expect(
    (
      await screen.findByText(/Previous actions remain in your Activity Log/)
    ).closest(".fui-Toast"),
  ).not.toBeNull();
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("/user/mcp-access"),
    expect.objectContaining({ method: "DELETE", credentials: "include" }),
  );
  expect(
    screen.queryByRole("button", { name: "Disconnect ChatGPT" }),
  ).toBeNull();
});

test.each(["API", "MCP"])(
  "loads five entries at a time and resets pagination when filtering by %s",
  async (source) => {
    const entry = {
      occurredAt: "2026-10-16T12:30:00Z",
      actorUserId: "ada",
      actorName: "Ada Traveler",
      source: "Website",
      action: "Updated trip",
      tripId: "trip-1",
      tripName: "Autumn in Paris",
      resourceId: null,
      description: "Updated trip",
    };
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      const skip = Number(url.searchParams.get("skip"));
      const filter = url.searchParams.get("source");
      return Response.json({
        entries: Array.from({ length: skip === 0 ? 5 : 1 }, (_, index) => ({
          ...entry,
          id: `${filter ?? "all"}-${skip + index}`,
          tripName: `${filter ?? "all"} trip ${skip + index}`,
          source: filter === "MCP" ? "ChatGPT" : "Website",
        })),
        hasMore: skip === 0,
      });
    });
    vi.stubGlobal("fetch", fetch);
    show(<ActivityLog />);
    await screen.findByText(/all trip 0/);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
    await screen.findByText(/all trip 5/);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Activity source" }),
      {
        target: { value: source },
      },
    );
    await screen.findByText(new RegExp(`${source} trip 0`));
    expect(screen.queryByText(/all trip/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`skip=0&source=${source}`),
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
    await screen.findByText(new RegExp(`${source} trip 5`));
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`skip=5&source=${source}`),
      expect.anything(),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(
      screen.queryByRole("button", { name: "Load more activity" }),
    ).toBeNull();
  },
);

test("keeps loaded entries after a pagination error and retries the same filtered page", async () => {
  const entry = {
    id: "entry-1",
    occurredAt: "2026-10-16T12:30:00Z",
    actorUserId: "ada",
    actorName: "Ada Traveler",
    source: "MCP",
    action: "Updated trip",
    tripId: "trip-1",
    tripName: "Paris",
    resourceId: null,
    description: "Updated trip",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ entries: [], hasMore: false }))
    .mockResolvedValueOnce(Response.json({ entries: [entry], hasMore: true }))
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(
      Response.json({
        entries: [{ ...entry, id: "entry-2", tripName: "London" }],
        hasMore: false,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  show(<ActivityLog />);
  await screen.findByText("No trip changes yet.");
  fireEvent.change(screen.getByRole("combobox", { name: "Activity source" }), {
    target: { value: "MCP" },
  });
  await screen.findByText(/Paris/);
  fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByText(/Paris/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
  await screen.findByText(/London/);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetch.mock.calls.slice(2).map(([url]) => String(url))).toEqual([
    "/user/activity-log?skip=1&source=MCP",
    "/user/activity-log?skip=1&source=MCP",
  ]);
});
