import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import ActivityLog from "./ActivityLog";
import ConnectedAgents from "./ConnectedAgents";

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
  expect(await screen.findByText("Visit the Louvre")).toBeVisible();
  expect(screen.getByText("ChatGPT")).toBeVisible();
  expect(screen.getByText("By Ada Traveler")).toBeVisible();
  expect(screen.getByText("Autumn in Paris")).toBeVisible();
  expect(document.querySelector("time")).toHaveAttribute(
    "dateTime",
    entry.occurredAt,
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
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
    expect(
      await screen.findByText(
        "No trip changes yet. New changes will appear here.",
      ),
    ).toBeVisible();
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
