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
        { status: "verified", amount, currency: "USD" },
        { status: "verified", amount: 700, currency: "USD" },
        true,
      ),
    ).toBe(badge);
    expect(
      bookingPriceDescription(
        { status: "verified", amount, currency: "USD" },
        { status: "verified", amount: 700, currency: "USD" },
        true,
      ),
    ).toBe(expected);
  },
);

test.each([
  [
    undefined,
    { status: "verified", amount: 700, currency: "USD" },
    true,
    "Price unconfirmed · difference unavailable",
  ],
  [
    { status: "verified", amount: 800, currency: "EUR" },
    { status: "verified", amount: 700, currency: "USD" },
    true,
    "Different currency; difference unavailable",
  ],
  [
    { status: "verified", amount: 350, currency: "USD" },
    { status: "verified", amount: 700, currency: "USD" },
    false,
    "Partial booking; difference unavailable",
  ],
  [
    { status: "verified", amount: 800, currency: "USD" },
    undefined,
    true,
    "Original quote unavailable",
  ],
  [
    { status: "verified", amount: NaN, currency: "USD" },
    { status: "verified", amount: 700, currency: "USD" },
    true,
    "Price unconfirmed · difference unavailable",
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

test.each(["unverified", undefined, "unknown"])(
  "never reveals an unconfirmed %s booking quote or a difference based on one",
  (status) => {
    const unconfirmed = { amount: 98765, currency: "USD", status };
    const verified = { amount: 100, currency: "USD", status: "verified" };
    expect(bookingPriceDescription(unconfirmed, verified, true)).toBe(
      "Price unconfirmed · difference unavailable",
    );
    expect(bookingPriceBadge(unconfirmed, verified, true)).toBeUndefined();
    expect(bookingPriceBadge(verified, unconfirmed, true)).toBeUndefined();
    expect(bookingPriceDescription(verified, unconfirmed, true)).toBe(
      "USD $100 · Original quote unavailable",
    );
  },
);
