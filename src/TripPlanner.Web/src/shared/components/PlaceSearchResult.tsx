import type { PlaceSuggestion } from "../../api/api";

export default function PlaceSearchResult({
  place,
}: {
  place: PlaceSuggestion;
}) {
  const name = place.name || place.label;
  return (
    <span className="place-search-result">
      <span className="place-search-result-name">{name}</span>
      {place.address && place.address !== name && (
        <span className="place-search-result-address">{place.address}</span>
      )}
    </span>
  );
}
