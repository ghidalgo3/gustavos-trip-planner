import { afterEach, expect, test, vi } from "vitest";
import {
  FlightSearchValidationError,
  startFlightSearch,
} from "./operationsApi";

afterEach(() => vi.unstubAllGlobals());

test("a flight-search 400 preserves structured planning issues", async () => {
  const issue = {
    code: "conflict",
    message: "Return flight window ends before the required stay.",
    partyId: "party",
    constraintIds: ["return", "stay"],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            title: "Resolve the planning issues before searching.",
            issues: [issue],
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  await expect(startFlightSearch("trip", "request")).rejects.toMatchObject({
    issues: [issue],
  });
  await expect(startFlightSearch("trip", "request")).rejects.toBeInstanceOf(
    FlightSearchValidationError,
  );
});
