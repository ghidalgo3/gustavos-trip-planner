import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import BehaviorTracking from "./BehaviorTracking";
import { identifyUser, trackBehavior, trackPage } from "./telemetry";

vi.mock("./telemetry", () => ({
  identifyUser: vi.fn(),
  trackBehavior: vi.fn(),
  trackPage: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

test("StrictMode records each initial view and funnel entry once", () => {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/?create=1"]}>
        <BehaviorTracking
          user={{
            isAuthenticated: true,
            id: "opaque-id",
            completedOnboarding: false,
            profile: { homeCity: null, preferredAirlines: [] },
          }}
        />
      </MemoryRouter>
    </StrictMode>,
  );
  expect(trackPage).toHaveBeenCalledExactlyOnceWith("/");
  expect(trackBehavior).toHaveBeenCalledTimes(3);
  expect(trackBehavior).toHaveBeenCalledWith("session_authenticated");
  expect(trackBehavior).toHaveBeenCalledWith("onboarding_viewed");
  expect(trackBehavior).toHaveBeenCalledWith("trip_creation_started");
  expect(identifyUser).toHaveBeenCalledWith("opaque-id");
});
