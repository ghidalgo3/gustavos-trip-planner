import { isVerifiedPrice, priceLabel } from "./flightFormatting";

export type BookingPrice = {
  amount: number;
  currency: string;
  status?: string;
};

export function bookingPriceBadge(
  price: BookingPrice | undefined,
  quoted: BookingPrice | undefined,
  sameFlights: boolean,
) {
  if (
    !sameFlights ||
    !isVerifiedPrice(price) ||
    !isVerifiedPrice(quoted) ||
    price.currency.toUpperCase() !== quoted.currency.toUpperCase()
  )
    return undefined;
  const difference =
    Math.round(price.amount * 100) - Math.round(quoted.amount * 100);
  try {
    const amount = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Math.abs(difference) / 100);
    return `${difference < 0 ? "−" : "+"}${amount}`;
  } catch {
    return undefined;
  }
}

export function bookingPriceDescription(
  price: BookingPrice | undefined,
  quoted: BookingPrice | undefined,
  sameFlights: boolean,
) {
  if (!isVerifiedPrice(price))
    return "Price unconfirmed · difference unavailable";
  const total = priceLabel(price);
  if (!sameFlights) return `${total} · Partial booking; difference unavailable`;
  if (!isVerifiedPrice(quoted)) return `${total} · Original quote unavailable`;
  if (price.currency.toUpperCase() !== quoted.currency.toUpperCase())
    return `${total} · Different currency; difference unavailable`;
  const difference =
    Math.round(price.amount * 100) - Math.round(quoted.amount * 100);
  if (difference === 0) return `${total} · Same as quoted`;
  const change = priceLabel({
    amount: Math.abs(difference) / 100,
    status: "verified",
    currency: price.currency,
  });
  return `${total} · ${difference > 0 ? "+" : "−"}${change} vs quoted`;
}
