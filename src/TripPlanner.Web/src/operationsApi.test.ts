import { afterEach, expect, test, vi } from "vitest";
import {
  FlightSearchValidationError,
  getFlightSearchResults,
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

test("reports an outdated API response instead of showing every fare as unchecked", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        { response: { itineraries: [{ price: { amount: 100 } }] } },
      ]),
    ),
  );
  await expect(
    getFlightSearchResults("trip", new AbortController().signal),
  ).rejects.toThrow("The API returned flights without requirement checks");
});

test("accepts one evaluation per itinerary", async () => {
  const results = [
    {
      response: { itineraries: [{}] },
      evaluations: [{ status: "Eligible", issues: [] }],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(results)),
  );
  await expect(
    getFlightSearchResults("trip", new AbortController().signal),
  ).resolves.toEqual(results);
});
