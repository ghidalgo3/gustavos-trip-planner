import { createContext } from "react";
import type { FareLeg } from "../../api/operationsApi";

export const FlightMapPreviewContext = createContext<
  | {
      onHover: (flight: FareLeg | undefined) => void;
      onFocus: (flight: FareLeg | undefined) => void;
    }
  | undefined
>(undefined);
