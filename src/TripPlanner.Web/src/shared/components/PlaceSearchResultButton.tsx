import { Button } from "@fluentui/react-components";
import type { PlaceSuggestion } from "../../api/api";
import PlaceSearchResult from "./PlaceSearchResult";

export default function PlaceSearchResultButton({
  place,
  index,
  disabled,
  selected,
  onClick,
}: {
  place: PlaceSuggestion;
  index: number;
  disabled?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="place-search-result-button"
      aria-label={`${index + 1}. ${place.label}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{index + 1}.</span>
      <PlaceSearchResult place={place} />
    </Button>
  );
}
