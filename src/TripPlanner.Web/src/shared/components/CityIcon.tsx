import { cityArtwork } from "../placeArtwork";

export default function CityIcon({
  name,
  countryCode,
}: {
  name: string;
  countryCode: string;
}) {
  const artwork = cityArtwork(name, countryCode);
  if (!artwork) return null;
  return (
    <svg className="city-icon" viewBox="0 0 120 120" aria-hidden="true">
      <use href={`/artwork/cities.svg#${artwork.symbol}`} />
    </svg>
  );
}
