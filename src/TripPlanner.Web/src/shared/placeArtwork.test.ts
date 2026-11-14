import { expect, test } from "vitest";
import { cityArtwork, flagSymbol, tripCountries } from "./placeArtwork";

test.each([
  ["Tokyo", "JP", "jp-tokyo"],
  ["Chicago", "US", "us-chicago"],
  ["New York City", "us", "us-new-york"],
  ["São Paulo", "BR", "br-sao-paulo"],
  ["Paris, Île-de-France", "FR", "fr-paris"],
  ["London", "GB", "gb-london"],
])("finds city artwork for %s in %s", (city, country, symbol) => {
  expect(cityArtwork(city, country)?.symbol).toBe(symbol);
});

test("United Kingdom destinations use Flagpack's UK asset", () => {
  expect(tripCountries(["GB", "gb", "GB-ENG"])).toEqual(["GB"]);
  expect(flagSymbol("GB")).toBe("gb-ukm");
});

test.each([
  ["Paris", "US"],
  ["Unknown city", "JP"],
  ["", "FR"],
])(
  "does not substitute artwork for an unmatched city %s in %s",
  (city, country) => {
    expect(cityArtwork(city, country)).toBeUndefined();
  },
);

test("country flags are unique, normalized and limited to available artwork", () => {
  expect(tripCountries(["JP", "kr", "jp", " KR ", "", "ZZ", "US"])).toEqual([
    "JP",
    "KR",
    "US",
  ]);
});
