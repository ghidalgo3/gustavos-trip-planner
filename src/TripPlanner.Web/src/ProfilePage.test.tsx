import { fireEvent, render, screen } from "@testing-library/react";
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
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(init?.body as string)).toEqual({
        homeCity: { name: "Boston", longitude: -71, latitude: 42 },
        preferredAirlines: ["AF", "DL"],
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
  fireEvent.change(
    screen.getByRole("textbox", { name: "Preferred airlines" }),
    {
      target: { value: "af, dl, AF" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

  expect(await screen.findByText("Profile saved.")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/user/profile"),
    expect.objectContaining({ method: "PUT" }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
});
