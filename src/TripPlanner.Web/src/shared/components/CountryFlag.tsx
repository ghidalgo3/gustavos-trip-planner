import { countryName, flagSymbol } from "../placeArtwork";

export default function CountryFlag({
  code,
  decorative = false,
}: {
  code: string;
  decorative?: boolean;
}) {
  const symbol = flagSymbol(code);
  if (!symbol) return null;
  const label = countryName(code);
  return (
    <svg
      className="country-flag"
      viewBox="0 0 16 12"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      <title>{label}</title>
      <use href={`/artwork/flags.svg#${symbol}`} />
    </svg>
  );
}
