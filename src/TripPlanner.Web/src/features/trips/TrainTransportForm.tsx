import { useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  SearchBox,
  Text,
} from "@fluentui/react-components";
import { searchStayPlaces } from "../activities/activitiesApi";
import { mapsClient } from "../../maps/mapsClient";
import PlaceSearchResultButton from "../../shared/components/PlaceSearchResultButton";
import SearchResultsSkeleton from "../../shared/components/SearchResultsSkeleton";
import { localClockInstant } from "../../shared/time/timeZones";
import {
  transportEndpoint,
  type TransportStop,
  type StationMapSearch,
} from "./destinationTransportModel";
import type {
  Transportation,
  TransportationFeature,
} from "./transportationApi";

export default function TrainTransportForm({
  from,
  to,
  existing,
  disabled,
  onSave,
  onEndpoints,
  onMapSearch,
  activeSearchId,
}: {
  from: TransportStop;
  to: TransportStop;
  existing?: Transportation;
  disabled: boolean;
  onEndpoints: (features: TransportationFeature[]) => void;
  onMapSearch: (search: StationMapSearch | undefined) => void;
  activeSearchId?: string;
  onSave: (details: {
    features: TransportationFeature[];
    departureAt: string;
    arrivalAt: string;
  }) => void;
}) {
  const [start, setStart] = useState(
    existing?.features.find((f) => f.id === "from"),
  );
  const [end, setEnd] = useState(existing?.features.find((f) => f.id === "to"));
  useEffect(() => {
    onEndpoints(
      [start, end].filter(
        (feature): feature is TransportationFeature => !!feature,
      ),
    );
  }, [start, end, onEndpoints]);
  const local = (instant: string | null | undefined, stop: TransportStop) => {
    if (!instant) return `${stop.date ?? ""}T09:00`;
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: stop.destination?.properties.timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant));
    return parts.replace(" ", "T");
  };
  const [departure, setDeparture] = useState(
    local(existing?.departureAt, from),
  );
  const [arrival, setArrival] = useState(local(existing?.arrivalAt, to));
  const [error, setError] = useState("");
  return (
    <form
      className="train-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        try {
          if (!start || !end)
            throw new Error("Choose departure and arrival stations.");
          const instant = (text: string, stop: TransportStop) => {
            const [date, time] = text.split("T");
            return localClockInstant(
              date,
              time,
              stop.destination?.properties.timeZone ?? "UTC",
            );
          };
          const departureAt = instant(departure, from),
            arrivalAt = instant(arrival, to);
          if (
            !Number.isFinite(departureAt) ||
            !Number.isFinite(arrivalAt) ||
            arrivalAt <= departureAt
          )
            throw new Error("Arrival must be after departure.");
          onSave({
            features: [
              start,
              end,
              ...(existing?.features.filter(
                (f) => f.id !== "from" && f.id !== "to",
              ) ?? []),
            ],
            departureAt: new Date(departureAt).toISOString(),
            arrivalAt: new Date(arrivalAt).toISOString(),
          });
        } catch (reason) {
          setError((reason as Error).message);
        }
      }}
    >
      <StationPicker
        onMapSearch={onMapSearch}
        activeSearchId={activeSearchId}
        label="Departure station"
        stop={from}
        value={start}
        disabled={disabled}
        onSelect={setStart}
        id="from"
      />
      <Field
        label={`Departure (${from.destination?.properties.timeZone ?? "UTC"})`}
        required
      >
        <Input
          type="datetime-local"
          value={departure}
          disabled={disabled}
          required
          onChange={(_, d) => setDeparture(d.value)}
        />
      </Field>
      <StationPicker
        onMapSearch={onMapSearch}
        activeSearchId={activeSearchId}
        label="Arrival station"
        stop={to}
        value={end}
        disabled={disabled}
        onSelect={setEnd}
        id="to"
      />
      <Field
        label={`Arrival (${to.destination?.properties.timeZone ?? "UTC"})`}
        required
      >
        <Input
          type="datetime-local"
          value={arrival}
          disabled={disabled}
          required
          onChange={(_, d) => setArrival(d.value)}
        />
      </Field>
      {error && <Text role="alert">{error}</Text>}
      <Button
        type="submit"
        appearance="primary"
        disabled={disabled || !start || !end}
      >
        Save train
      </Button>
    </form>
  );
}
function StationPicker({
  label,
  stop,
  value,
  disabled,
  onSelect,
  id,
  onMapSearch,
  activeSearchId,
}: {
  label: string;
  stop: TransportStop;
  value?: TransportationFeature;
  disabled: boolean;
  onSelect: (feature: TransportationFeature) => void;
  id: string;
  onMapSearch: (search: StationMapSearch | undefined) => void;
  activeSearchId?: string;
}) {
  const [query, setQuery] = useState(value?.properties.name ?? "");
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<
    Awaited<ReturnType<typeof searchStayPlaces>>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function selectResult(
    matches: Awaited<ReturnType<typeof searchStayPlaces>>,
    index: number,
  ) {
    const place = matches[index];
    if (!place?.geometry || disabled) return;
    onSelect({
      ...transportEndpoint(id, place.name, place.geometry),
      properties: { name: place.name, address: place.address },
    });
    setQuery(place.name);
    setResults([]);
    setSearched(false);
    onMapSearch(undefined);
  }
  function publish(matches: Awaited<ReturnType<typeof searchStayPlaces>>) {
    onMapSearch({
      id,
      results: matches.map((place, index) => ({
        id: String(index),
        name: place.name,
        label: place.name,
        address: place.address,
        longitude: place.geometry?.coordinates[0],
        latitude: place.geometry?.coordinates[1],
      })),
      onSelect: (index) => selectResult(matches, index),
    });
  }
  async function search() {
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true);
    setError("");
    setResults([]);
    setSearched(false);
    publish([]);
    try {
      const matches = stop.destination
        ? await searchStayPlaces(
            stop.destination,
            `${query} train station`,
            controller.current.signal,
          )
        : (
            await mapsClient.searchPlaces(
              `${query} train station ${stop.city ?? ""}`,
              controller.current.signal,
            )
          ).map((place) => ({
            name: place.name ?? place.label,
            address: place.address ?? place.label,
            geometry:
              place.longitude != null && place.latitude != null
                ? {
                    type: "Point" as const,
                    coordinates: [place.longitude, place.latitude] as [
                      number,
                      number,
                    ],
                  }
                : null,
          }));
      if (controller.current.signal.aborted) return;
      setResults(matches);
      publish(matches);
      setSearched(true);
    } catch (e) {
      if (!controller.current.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="station-picker">
      <Field label={label}>
        <SearchBox
          value={query}
          disabled={disabled || busy}
          onChange={(_, d) => {
            setQuery(d.value);
            setResults([]);
            setSearched(false);
            onMapSearch(undefined);
          }}
        />
      </Field>
      <Button
        disabled={disabled || busy || !query.trim()}
        onClick={() => void search()}
      >
        Search {label.toLowerCase()}
      </Button>
      {value && <Text block>Selected: {value.properties.name}</Text>}
      {busy && (
        <SearchResultsSkeleton
          label={`Searching ${label.toLowerCase()}`}
          appearance="places"
        />
      )}
      {searched && activeSearchId === id && results.length === 0 && (
        <Text role="status">No stations found. Try another name.</Text>
      )}
      {activeSearchId === id &&
        results.map((place, index) => (
          <PlaceSearchResultButton
            key={index}
            index={index}
            place={{
              id: String(index),
              label: place.name,
              name: place.name,
              address: place.address,
            }}
            disabled={disabled || !place.geometry}
            selected={value?.properties.name === place.name}
            onClick={() => selectResult(results, index)}
          />
        ))}
      {error && <Text role="alert">{error}</Text>}
    </div>
  );
}
