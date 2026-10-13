import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import TripParties from "./TripParties";
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
test("searches users by name and adds and removes a party member", async () => {
  const traveler = {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Alice Smith",
    email: "alice@example.com",
  };
  let members = [...parties[0].members];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/users?query="))
        return { ok: true, json: async () => [traveler] };
      if (url.endsWith(`/members/${traveler.id}`)) {
        if (init?.method === "PUT")
          members = [
            ...members,
            { id: traveler.id, name: traveler.name, homeCity: "Seattle" },
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
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Alice Smith")).toBeVisible();
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
});

test("shared trips show travelers without membership controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => parties })),
  );
  show(true);
  expect(await screen.findByText("Ada")).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "Add traveler" }),
  ).not.toBeInTheDocument();
});
