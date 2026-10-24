import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Button,
  Dropdown,
  Field,
  Option,
  Skeleton,
  SkeletonItem,
  Slider,
  Text,
} from "@fluentui/react-components";
import type { PlannedVisit } from "./planningApi";
import type { FareSearchResult } from "./operationsApi";
import { legKey, priceLabel, type AirportCities } from "./flightFormatting";
import {
  buildFlightGraph,
  createFlightPathFilter,
  flightAirlines,
  flightCurrencies,
  flightMatchesFilters,
  type FlightSelections,
  flightNodeId,
  presentFlightFare,
  type FlightFare,
} from "./flightRouteGraph";
import FlightGridCard from "./FlightGridCard";
import FlightConnections from "./FlightConnections";

export default function FlightRouteGrid({
  result,
  visits,
  cities,
  searching,
  chosen,
  busy,
  onChoose,
  onReview,
  onFilterChange,
  preferredAirlines,
  renderSelections,
}: {
  result?: FareSearchResult;
  visits: PlannedVisit[];
  cities: AirportCities;
  searching: boolean;
  chosen: FlightSelections;
  busy: boolean;
  onChoose: (keys: (string | null)[]) => void;
  onReview?: (
    keys: string[],
    price?: { amount: number; currency: string },
  ) => void;
  onFilterChange?: () => void;
  preferredAirlines: string[];
  renderSelections?: (fares: ReadonlyMap<string, FlightFare>) => ReactNode;
}) {
  const graph = useMemo(
    () => buildFlightGraph(result, visits.length + 1, preferredAirlines),
    [result, visits.length, preferredAirlines],
  );
  const findPaths = useMemo(() => createFlightPathFilter(graph), [graph]);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [limit, setLimit] = useState<number>();
  const [stops, setStops] = useState<string[]>();
  const [airlines, setAirlines] = useState<string[]>();
  const [chosenCurrency, setChosenCurrency] = useState<string>();
  const currencies = useMemo(() => flightCurrencies(graph), [graph]);
  const currency = chosenCurrency ?? currencies[0];
  // Cost bounds follow compatible paths in the current grid. The cost cap itself
  // must not shrink its own range, so users can always widen it again.
  const range = useMemo(
    () => findPaths(chosen, { currency, stops, airlines }),
    [findPaths, chosen, currency, stops, airlines],
  );
  const priced =
    Number.isFinite(range.minTotal) && Number.isFinite(range.maxTotal);
  const minimum = priced ? range.minTotal : 0;
  const maximum = priced ? range.maxTotal : 0;
  const effectiveLimit =
    limit === undefined || !priced
      ? undefined
      : Math.max(minimum, Math.min(maximum, limit));
  const filters = useMemo(
    () => ({ currency, maxPrice: effectiveLimit, stops, airlines }),
    [currency, effectiveLimit, stops, airlines],
  );
  const available = useMemo(
    () => findPaths(chosen, filters),
    [findPaths, chosen, filters],
  );
  const selectedCount = chosen.filter(Boolean).length;
  const hasFilters =
    limit !== undefined ||
    stops !== undefined ||
    airlines !== undefined ||
    chosenCurrency !== undefined;
  const restrict = selectedCount > 0 || hasFilters || currencies.length > 1;
  const active = hovered ?? focused;
  const activeNode = graph.columns.flat().find((node) => node.id === active);
  const replacingSelection = Boolean(
    activeNode &&
    chosen[activeNode.legIndex] &&
    chosen[activeNode.legIndex] !== legKey(activeNode.leg),
  );
  const highlighted = useMemo(() => {
    const node = graph.columns.flat().find((node) => node.id === active);
    if (!node || replacingSelection)
      return { nodes: new Set<string>(), edges: [] };
    const keys = Array.from(
      { length: graph.columns.length },
      (_, index) => chosen[index] ?? null,
    );
    keys[node.legIndex] = legKey(node.leg);
    return findPaths(keys, filters);
  }, [graph, findPaths, active, chosen, filters, replacingSelection]);
  const airlineOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const node of graph.columns.flat()) {
      for (const code of flightAirlines(node.leg)) {
        const segment = node.leg.segments.find(
          (segment) =>
            segment.marketing_carrier_code?.trim().toUpperCase() === code,
        );
        const name = segment?.operating_carrier_name ?? node.leg.carrier;
        options.set(code, name && name !== code ? `${name} (${code})` : code);
      }
    }
    return [...options]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graph]);
  const complete =
    selectedCount === graph.columns.length && available.nodes.size > 0;
  const tripPrice = available.prices.get(flightNodeId(0, chosen[0] ?? ""));
  const toggleFlight = useCallback(
    (index: number, key: string) => {
      const keys = Array.from(
        { length: graph.columns.length },
        (_, column) => chosen[column] ?? null,
      );
      keys[index] = keys[index] === key ? null : key;
      onChoose(keys.some(Boolean) ? keys : []);
    },
    [chosen, graph.columns.length, onChoose],
  );
  function resetFilters() {
    setLimit(undefined);
    setStops(undefined);
    setAirlines(undefined);
    setChosenCurrency(undefined);
    onFilterChange?.();
  }
  const canvas = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const registerCard = useCallback(
    (id: string, element: HTMLDivElement | null) => {
      if (element) cards.current.set(id, element);
      else cards.current.delete(id);
    },
    [],
  );
  const visibleColumns = useMemo(
    () =>
      graph.columns.map((column, index) =>
        column.filter((node) =>
          chosen[index]
            ? chosen[index] === legKey(node.leg) ||
              flightMatchesFilters(node, filters)
            : !restrict || available.nodes.has(node.id),
        ),
      ),
    [graph, chosen, filters, restrict, available],
  );

  return (
    <div className="flight-route-explorer">
      <div className="flight-grid-toolbar">
        <div>
          <Text weight="semibold">Explore flight paths</Text>
          <Text>
            Choose one flight per column. Scroll sideways to see more
            destinations.
          </Text>
        </div>
        <div className="flight-grid-selection-actions">
          <Text>
            {selectedCount} of {graph.columns.length} flights selected
          </Text>
          <Button
            disabled={busy || selectedCount === 0}
            onClick={() => onChoose([])}
          >
            Clear selections
          </Button>
          <Button
            appearance="primary"
            disabled={busy || !complete}
            onClick={() =>
              onReview?.(
                chosen.map((key) => key!),
                tripPrice,
              )
            }
          >
            Review selected flights
          </Button>
        </div>
      </div>
      <div
        className="flight-grid-filters"
        role="group"
        aria-label="Flight path filters"
      >
        <Field
          className="flight-grid-budget"
          label={`Total trip cost${currency && priced ? ` · ${priceLabel({ amount: effectiveLimit ?? maximum, currency })} maximum` : ""}`}
        >
          <Slider
            aria-label="Maximum total trip cost"
            aria-valuetext={
              currency
                ? priceLabel({ amount: effectiveLimit ?? maximum, currency })
                : undefined
            }
            min={minimum}
            max={maximum}
            step={0.01}
            value={effectiveLimit ?? maximum}
            disabled={!priced || minimum === maximum}
            onChange={(_, data) => {
              setLimit(data.value);
              setChosenCurrency(currency);
              onFilterChange?.();
            }}
          />
          <Text size={200}>
            {Number.isFinite(range.minTotal) && currency
              ? `Complete trips from ${priceLabel({ amount: range.minTotal, currency })}. Shared outbound and return fares counted once.`
              : "Prices appear when complete trips are found."}
          </Text>
        </Field>
        {(currencies.length > 1 ||
          (chosenCurrency && !currencies.includes(chosenCurrency))) && (
          <Field label="Currency">
            <Dropdown
              aria-label="Trip cost currency"
              value={currency}
              selectedOptions={currency ? [currency] : []}
              onOptionSelect={(_, data) => {
                setChosenCurrency(data.optionValue);
                setLimit(undefined);
                onFilterChange?.();
              }}
            >
              {currencies.map((value) => (
                <Option key={value} value={value}>
                  {value}
                </Option>
              ))}
            </Dropdown>
          </Field>
        )}
        <Field label="Stops per flight">
          <Dropdown
            multiselect
            aria-label="Allowed stops"
            disabled={!result}
            selectedOptions={stops ?? ["0", "1", "2"]}
            value={
              stops === undefined
                ? "All stops"
                : stops.length === 0
                  ? "No stops selected"
                  : stops
                      .map((value) =>
                        value === "0"
                          ? "Nonstop"
                          : value === "1"
                            ? "1 stop"
                            : "2+ stops",
                      )
                      .join(", ")
            }
            onOptionSelect={(_, data) => {
              setStops(data.selectedOptions);
              onFilterChange?.();
            }}
          >
            <Option value="0">Nonstop</Option>
            <Option value="1">1 stop</Option>
            <Option value="2">2+ stops</Option>
          </Dropdown>
        </Field>
        <Field label="Airlines">
          <Dropdown
            multiselect
            aria-label="Allowed airlines"
            selectedOptions={
              airlines ?? airlineOptions.map((option) => option.value)
            }
            value={
              airlines === undefined
                ? "All airlines"
                : airlines.length === 0
                  ? "No airlines selected"
                  : airlines.join(", ")
            }
            disabled={airlineOptions.length === 0}
            onOptionSelect={(_, data) => {
              setAirlines(data.selectedOptions);
              onFilterChange?.();
            }}
          >
            {airlineOptions.map((option) => (
              <Option
                key={option.value}
                value={option.value}
                text={option.label}
              >
                {option.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Button disabled={!hasFilters} onClick={resetFilters}>
          Reset filters
        </Button>
      </div>
      <div className="flight-grid-status" role="status" aria-live="polite">
        <span
          className={
            searching ? "flight-grid-live is-searching" : "flight-grid-live"
          }
        />
        {replacingSelection
          ? "Choose this flight to replace your selection in this column."
          : available.nodes.size === 0 && restrict
            ? "No complete trips match these selections and filters. Clear a selection or adjust the filters."
            : active
              ? highlighted.nodes.size > 0
                ? `Complete paths through this flight · ${highlighted.nodes.size - 1} connected flights`
                : searching
                  ? "Waiting for a compatible complete path…"
                  : "No complete path matches this flight and your filters."
              : searching
                ? "Flights appear as searches finish. Choose a flight in any column."
                : "Choose one flight in each column, then review your selected flights."}
      </div>
      <div
        className="flight-grid-scroll"
        tabIndex={0}
        role="region"
        aria-label="Flight destinations and connections"
      >
        <div
          className="flight-grid-canvas"
          ref={canvas}
          style={{ "--flight-columns": visits.length + 1 } as CSSProperties}
        >
          <FlightConnections
            canvas={canvas}
            cards={cards}
            columns={visibleColumns}
            edges={highlighted.edges}
          />
          {visibleColumns.map((nodes, index) => {
            return (
              <section
                className="flight-grid-column"
                aria-busy={searching && !chosen[index]}
                key={visits[index]?.id ?? "return-home"}
                aria-label={
                  index < visits.length
                    ? `Destination ${index + 1}: ${visits[index].location?.label ?? visits[index].location?.code ?? "Destination"}`
                    : "Return home"
                }
              >
                <header className="flight-grid-column-heading">
                  <span className="flight-grid-step">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h4>
                      {index < visits.length
                        ? (visits[index].location?.label ??
                          visits[index].location?.code ??
                          `Destination ${index + 1}`)
                        : "Return home"}
                    </h4>
                    <Text size={200}>
                      {nodes.length} flight{nodes.length === 1 ? "" : "s"}
                      {index < visits.length && visits[index].presentFrom
                        ? ` · ${visits[index].presentFrom}`
                        : ""}
                    </Text>
                  </div>
                </header>
                {nodes.length === 0 && !searching && (
                  <div className="flight-grid-empty">
                    {restrict
                      ? "No matching flights. Adjust your selections or filters."
                      : "No flights found for this leg."}
                  </div>
                )}
                {nodes.map((node) => {
                  const fare = presentFlightFare(
                    available.fares.get(node.id),
                    index,
                    chosen,
                  );
                  const connected = highlighted.nodes.has(node.id);
                  const selected = Boolean(
                    chosen[index] &&
                    flightNodeId(index, chosen[index]) === node.id,
                  );
                  return (
                    <FlightGridCard
                      key={node.id}
                      node={node}
                      active={active === node.id}
                      connected={connected}
                      selected={selected}
                      muted={
                        Boolean(chosen[index] && !selected) ||
                        Boolean(active && active !== node.id && !connected)
                      }
                      total={available.prices.get(node.id)}
                      farePrice={fare.price}
                      fareLabel={fare.label}
                      restrict={restrict}
                      searching={searching}
                      busy={busy}
                      cities={cities}
                      preferredAirlines={preferredAirlines}
                      register={registerCard}
                      onChoose={toggleFlight}
                      onHover={setHovered}
                      onFocus={setFocused}
                    />
                  );
                })}
                {searching && !chosen[index] && (
                  <Skeleton
                    aria-label={`Loading flights for ${visits[index]?.location?.label ?? "return home"}`}
                    className="flight-grid-skeletons"
                  >
                    {Array.from(
                      { length: nodes.length === 0 ? 3 : 1 },
                      (_, placeholder) => (
                        <div
                          key={placeholder}
                          className="flight-grid-card flight-grid-skeleton"
                          aria-hidden="true"
                        >
                          <SkeletonItem size={16} style={{ width: "55%" }} />
                          <SkeletonItem size={12} style={{ width: "35%" }} />
                          <div className="flight-grid-times">
                            <SkeletonItem size={24} style={{ width: "40%" }} />
                            <SkeletonItem size={24} style={{ width: "40%" }} />
                          </div>
                          <SkeletonItem size={12} style={{ width: "75%" }} />
                        </div>
                      ),
                    )}
                  </Skeleton>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {renderSelections?.(available.fares)}
    </div>
  );
}
