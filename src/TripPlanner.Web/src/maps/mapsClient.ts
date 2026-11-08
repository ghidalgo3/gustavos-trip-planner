import { createAzureMapsClient } from "./AzureMapsClient";
import type { MapsClient } from "./IMapsClient";

export const mapsClient: MapsClient = createAzureMapsClient();
