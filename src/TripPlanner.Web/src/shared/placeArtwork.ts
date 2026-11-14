import artwork from "./placeArtwork.json";

function cityKey(value: string) {
  return value
    .split(",")[0]
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const cities = new Map<string, (typeof artwork.cities)[number]>();
for (const city of artwork.cities) {
  const key = `${city.countryCode}:${cityKey(city.city)}`;
  // Some cities have several variants; keep one consistent choice.
  if (!cities.has(key)) cities.set(key, city);
}
const flags = new Set(artwork.flags);
const aliases: Record<string, string> = {
  "US:newyorkcity": "newyork",
  "US:nyc": "newyork",
};

export function cityArtwork(name: string, countryCode: string) {
  const country = countryCode.trim().toUpperCase();
  const normalized = cityKey(name);
  const key = `${country}:${normalized}`;
  return cities.get(`${country}:${aliases[key] ?? normalized}`);
}

export function tripCountries(countryCodes: string[]) {
  return [
    ...new Set(countryCodes.map((code) => code.trim().toUpperCase())),
  ].filter((code) => /^[A-Z]{2}$/.test(code) && flagSymbol(code));
}

export function flagSymbol(code: string) {
  // Flagpack names the United Kingdom asset with its subdivision identifier.
  const symbol = code === "GB" ? "GB-UKM" : code;
  return flags.has(symbol) ? symbol.toLowerCase() : undefined;
}

const countryNames = new Intl.DisplayNames(undefined, { type: "region" });
export function countryName(code: string) {
  return countryNames.of(code) ?? code;
}
