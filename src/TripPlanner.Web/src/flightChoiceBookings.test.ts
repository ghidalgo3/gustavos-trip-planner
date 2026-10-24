import { expect, test } from "vitest";
import { partialFlightBookings } from "./flightChoiceBookings";
import type { FlightChoiceProgress } from "./selectedFlightsApi";

const progress: FlightChoiceProgress = {
  partyId: "party",
  legKeys: ["out", null, "home"],
  nextOrigins: [],
  bookings: [
    {
      ignavId: "outbound",
      legIndexes: [0],
      legKeys: ["out"],
      price: { amount: 600, currency: "USD" },
    },
    {
      ignavId: "return",
      legIndexes: [2],
      legKeys: ["home"],
      price: { amount: 600, currency: "USD" },
    },
    {
      ignavId: "pair",
      legIndexes: [0, 2],
      legKeys: ["out", "home"],
      price: { amount: 700, currency: "USD" },
    },
    {
      ignavId: "other-currency",
      legIndexes: [0, 2],
      legKeys: ["out", "home"],
      price: { amount: 500, currency: "EUR" },
    },
  ],
};

test.each([
  [[], ["pair", "pair"]],
  [["outbound"], ["outbound", "return"]],
  [["pair"], ["pair", "pair"]],
])(
  "partial booking prices compare whole bookings and keep purchases (%j)",
  (purchasedOfferIds, expected) => {
    const result = partialFlightBookings(
      { ...progress, purchasedOfferIds },
      progress.legKeys,
      "USD",
    );
    expect([result.get(0)?.ignavId, result.get(2)?.ignavId]).toEqual(expected);
  },
);

test("a return selected first can book its one-way offer without an unselected outbound", () => {
  const result = partialFlightBookings(progress, [null, null, "home"], "USD");
  expect(result.size).toBe(1);
  expect(result.get(2)?.ignavId).toBe("return");
});
