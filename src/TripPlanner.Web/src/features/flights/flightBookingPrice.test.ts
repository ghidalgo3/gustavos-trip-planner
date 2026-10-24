import { expect, test } from "vitest";
import {
  bookingPriceDescription,
  bookingPriceBadge,
} from "./flightBookingPrice";

test.each([
  [850, "USD $850 · +USD $150 vs quoted", "+$150"],
  [700, "USD $700 · Same as quoted", "+$0"],
  [650, "USD $650 · −USD $50 vs quoted", "−$50"],
  [700.15, "USD $700.15 · +USD $0.15 vs quoted", "+$0.15"],
])(
  "compares the offer's total with the original booking quote (%s)",
  (amount, expected, badge) => {
    expect(
      bookingPriceBadge(
        { amount, currency: "USD" },
        { amount: 700, currency: "USD" },
        true,
      ),
    ).toBe(badge);
    expect(
      bookingPriceDescription(
        { amount, currency: "USD" },
        { amount: 700, currency: "USD" },
        true,
      ),
    ).toBe(expected);
  },
);

test.each([
  [
    undefined,
    { amount: 700, currency: "USD" },
    true,
    "Price unavailable · difference unavailable",
  ],
  [
    { amount: 800, currency: "EUR" },
    { amount: 700, currency: "USD" },
    true,
    "Different currency; difference unavailable",
  ],
  [
    { amount: 350, currency: "USD" },
    { amount: 700, currency: "USD" },
    false,
    "Partial booking; difference unavailable",
  ],
  [
    { amount: 800, currency: "USD" },
    undefined,
    true,
    "Original quote unavailable",
  ],
  [
    { amount: NaN, currency: "USD" },
    { amount: 700, currency: "USD" },
    true,
    "Price unavailable · difference unavailable",
  ],
])(
  "does not invent a difference when prices are not comparable (%j)",
  (price, quoted, sameFlights, expected) => {
    expect(bookingPriceBadge(price, quoted, sameFlights)).toBeUndefined();
    expect(bookingPriceDescription(price, quoted, sameFlights)).toContain(
      expected,
    );
  },
);
