import { Badge } from "@fluentui/react-components";
import type { FareItinerary } from "../../api/operationsApi";
import { isVerifiedPrice } from "./flightFormatting";

export default function FlightPriceStatus({
  price,
}: {
  price: FareItinerary["price"];
}) {
  if (isVerifiedPrice(price)) return null;
  return (
    <Badge
      appearance="tint"
      color="warning"
      title="The provider has not confirmed this price. The amount is hidden."
    >
      Price unconfirmed
    </Badge>
  );
}
