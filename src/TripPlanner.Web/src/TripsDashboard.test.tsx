import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import TripsDashboard from "./TripsDashboard";
import type { Trip } from "./api";

const user = {
  isAuthenticated: true,
  completedOnboarding: true,
  id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
  name: "Ada Traveler",
  email: "ada@example.com",
};

test("creates, edits, and deletes a trip", async () => {
  let storedTrip: Trip | undefined;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      expect(url).toContain(`/api/user/${user.id}/trips`);

      if (method === "GET") {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (method === "POST") {
        expect(JSON.parse(init?.body as string)).toEqual({
          name: "Lisbon summer",
          description: "Food and museums",
        });
        storedTrip = trip("Lisbon summer", "Food and museums");
        return { ok: true, status: 201, json: async () => storedTrip };
      }
      if (method === "PUT") {
        expect(url.endsWith("/trip-1")).toBe(true);
        expect(JSON.parse(init?.body as string)).toEqual({
          name: "Lisbon and Porto",
          description: "Travel by train",
        });
        storedTrip = trip("Lisbon and Porto", "Travel by train");
        return { ok: true, status: 200, json: async () => storedTrip };
      }
      if (method === "DELETE") {
        expect(url.endsWith("/trip-1")).toBe(true);
        storedTrip = undefined;
        return { ok: true, status: 204 };
      }

      throw new Error(`Unexpected ${method} request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <FluentProvider theme={webLightTheme}>
      <TripsDashboard user={user} />
    </FluentProvider>,
  );

  expect(await screen.findByText("No trips yet")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "New trip" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Trip name" }), {
    target: { value: "Lisbon summer" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Food and museums" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

  expect(
    await screen.findByRole("heading", { name: "Lisbon summer" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Trip name" }), {
    target: { value: "Lisbon and Porto" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Travel by train" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  expect(
    await screen.findByRole("heading", { name: "Lisbon and Porto" }),
  ).toBeVisible();
  expect(screen.getByText("Travel by train")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Lisbon and Porto" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

function trip(name: string, description: string): Trip {
  return {
    id: "trip-1",
    ownerUserId: user.id,
    name,
    description,
    constraints: {},
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
  };
}
