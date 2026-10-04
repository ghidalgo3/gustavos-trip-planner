import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import ProfilePage from "./ProfilePage";
import type { CurrentUser } from "./api";

const user: CurrentUser = {
  isAuthenticated: true,
  id: "11111111-1111-1111-1111-111111111111",
  name: "Ada Traveler",
  email: "ada@example.com",
  completedOnboarding: true,
  profile: {
    homeCity: { name: "Boston", longitude: -71, latitude: 42 },
    preferredAirlines: ["DL"],
  },
};

test("saves the complete profile when airline preferences change", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(_input).includes("/airports/home"))
        return Response.json([{ code: "BOS", name: "Logan", city: "Boston" }]);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(init?.body as string)).toEqual({
        homeCity: { name: "Boston", longitude: -71, latitude: 42 },
        preferredAirlines: ["AF", "DL"],
        preferredAirport: "BOS",
      });
      return {
        ok: true,
        json: async () => ({
          ...user,
          profile: { ...user.profile, preferredAirlines: ["AF", "DL"] },
        }),
      };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/profile"]}>
        <ProfilePage user={user} onSaved={onSaved} />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(screen.getByRole("heading", { name: "Your profile" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Home city" })).toHaveValue(
    "Boston",
  );
  const airlineSearch = screen.getByRole("combobox", {
    name: "Search preferred airlines",
  });
  fireEvent.change(airlineSearch, { target: { value: "Air France" } });
  fireEvent.click(airlineSearch);
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Air France (AF)" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

  expect(await screen.findByText("Profile saved.")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/user/profile"),
    expect.objectContaining({ method: "PUT" }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
});

test("requires a preferred airport when the home city has multiple airports", async () => {
  const tokyo = {
    ...user,
    profile: {
      ...user.profile,
      homeCity: { name: "Tokyo", longitude: 139.69, latitude: 35.68 },
    },
  };
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      expect(JSON.parse(init.body as string).preferredAirport).toBe("HND");
      return Response.json({
        ...tokyo,
        profile: { ...tokyo.profile, preferredAirport: "HND" },
      });
    }
    return Response.json([
      { code: "HND", name: "Haneda" },
      { code: "NRT", name: "Narita" },
    ]);
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ProfilePage user={tokyo} onSaved={vi.fn()} />
      </MemoryRouter>
    </FluentProvider>,
  );
  const airport = await screen.findByRole("combobox", {
    name: "Preferred home airport",
  });
  expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
  fireEvent.change(airport, { target: { value: "HND" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByText("Profile saved.")).toBeVisible();
});
