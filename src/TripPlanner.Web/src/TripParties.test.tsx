import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import TripParties from "./TripParties";
import type { PlanningParty } from "./planningApi";
const userId = "11111111-1111-1111-1111-111111111111";
const parties = [
  { id: "party", members: [{ id: userId, name: "Ada", homeCity: "Boston" }] },
];
function show(readOnly = false) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <TripParties tripId="trip" userId={userId} readOnly={readOnly} />
    </FluentProvider>,
  );
}
test.each(["Traveller", "Planner"] as const)(
  "invites members as %s and allows role changes",
  async (role) => {
    const traveler = {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Alice Smith",
      email: "alice@example.com",
    };
    let members: PlanningParty["members"] = [...parties[0].members];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/users?query="))
          return { ok: true, json: async () => [traveler] };
        if (url.endsWith(`/members/${traveler.id}`)) {
          if (init?.method === "PUT")
            members = [
              ...members.filter((member) => member.id !== traveler.id),
              {
                id: traveler.id,
                name: traveler.name,
                homeCity: "Seattle",
                role: JSON.parse(String(init.body)).role,
              },
            ];
          else if (init?.method === "DELETE")
            members = members.filter((member) => member.id !== traveler.id);
          return { ok: true, status: 204 };
        }
        if (url.endsWith("/parties"))
          return { ok: true, json: async () => [{ ...parties[0], members }] };
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    show();
    const input = await screen.findByRole("combobox", { name: "Add traveler" });
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(await screen.findByRole("option", { name: /Alice Smith/ }));
    expect(
      screen.getByRole("combobox", { name: "New member role" }),
    ).toHaveValue("Traveller");
    fireEvent.change(
      screen.getByRole("combobox", { name: "New member role" }),
      { target: { value: role } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Alice Smith")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Role for Alice Smith" }),
    ).toHaveValue(role);
    const otherRole = role === "Planner" ? "Traveller" : "Planner";
    fireEvent.change(
      screen.getByRole("combobox", { name: "Role for Alice Smith" }),
      { target: { value: otherRole } },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Role for Alice Smith" }),
      ).toHaveValue(otherRole),
    );
    expect(
      fetchMock.mock.calls
        .filter(
          ([url, init]) =>
            String(url).endsWith(`/members/${traveler.id}`) &&
            init?.method === "PUT",
        )
        .map(([, init]) => JSON.parse(String(init?.body)).role),
    ).toEqual([role, otherRole]);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Alice Smith from party" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/members/${traveler.id}`) &&
          init?.method === "PUT",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/members/${traveler.id}`) &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  },
);

test("shared trips show travelers without membership controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => parties })),
  );
  show(true);
  expect(await screen.findByText(/Ada · Traveller/)).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "Add traveler" }),
  ).not.toBeInTheDocument();
});
