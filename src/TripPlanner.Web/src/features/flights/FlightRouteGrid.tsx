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
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItemRadio,
  SplitButton,
  type MenuButtonProps,
  Skeleton,
  SkeletonItem,
  Slider,
  Text,
} from "@fluentui/react-components";
import type { PlannedVisit } from "./planningApi";
import {
  isVerifiedPrice,
  legUsesPreferredAirline,
  legKey,
  priceLabel,
  type AirportCities,
} from "./flightFormatting";
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
  type FlightNode,
  type FlightRouteResult,
} from "./flightRouteGraph";
import FlightGridCard from "./FlightGridCard";
import FlightConnections from "./FlightConnections";

const sortFields = {
  price: "Price",
  departure: "Departure",
  arrival: "Arrival",
  duration: "Duration",
};
type SortField = keyof typeof sortFields;

export default function FlightRouteGrid({
  result,
  visits,
  returnDate,
  cities,
  searching,
  chosen,
  busy,
  onChoose,
  onFilterChange,
  preferredAirlines,
  renderCardActions,
  retainedFlightCount = 0,
}: {
  result?: FlightRouteResult;
  visits: PlannedVisit[];
  returnDate?: string | null;
  cities: AirportCities;
  searching: boolean;
  chosen: FlightSelections;
  busy: boolean;
  onChoose: (keys: (string | null)[]) => void;
  onFilterChange?: () => void;
  preferredAirlines: string[];
  renderCardActions?: (
    node: FlightNode,
    selected: boolean,
    fares: ReadonlyMap<string, FlightFare>,
  ) => ReactNode;
  retainedFlightCount?: number;
}) {
  const graph = useMemo(
    () => buildFlightGraph(result, visits.length + 1, preferredAirlines),
    [result, visits.length, preferredAirlines],
  );
  const findPaths = useMemo(() => createFlightPathFilter(graph), [graph]);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [sortField, setSortField] = useState<SortField>("price");
  const [sortOrder, setSortOrder] = useState<"ascending" | "descending">(
    "ascending",
  );
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
  const cardActions = useMemo(
    () =>
      new Map(
        graph.columns
          .flat()
          .map((node) => [
            node.id,
            renderCardActions?.(
              node,
              chosen[node.legIndex] === legKey(node.leg),
              available.fares,
            ),
          ]),
      ),
    [graph, chosen, available.fares, renderCardActions],
  );
  const selectedCount = chosen.filter(Boolean).length;
  const hasFilters =
    limit !== undefined ||
    stops !== undefined ||
    airlines !== undefined ||
    chosenCurrency !== undefined;
  const restrict = selectedCount > 0 || hasFilters || currencies.length > 1;
  const allChosen = graph.columns.every((_, index) => Boolean(chosen[index]));
  const active = [hovered, focused].find((id) => {
    const node = graph.columns.flat().find((node) => node.id === id);
    return (
      node &&
      (!chosen[node.legIndex] || chosen[node.legIndex] === legKey(node.leg))
    );
  });
  const highlighted = useMemo(() => {
    if (allChosen) {
      // This line shows the user's saved choices, even when retained flights
      // have no current search graph. It does not assert route feasibility.
      const selectedNodes = graph.columns.map((column, index) =>
        column.find((node) => legKey(node.leg) === chosen[index]),
      );
      if (selectedNodes.some((node) => !node))
        return { nodes: new Set<string>(), edges: [] };
      const ids = selectedNodes.map((node) => node!.id);
      return {
        nodes: new Set(ids),
        edges: ids.slice(1).map((to, index) => ({ from: ids[index], to })),
      };
    }
    const node = graph.columns.flat().find((node) => node.id === active);
    if (!node) return { nodes: new Set<string>(), edges: [] };
    const keys = Array.from(
      { length: graph.columns.length },
      (_, index) => chosen[index] ?? null,
    );
    keys[node.legIndex] = legKey(node.leg);
    return findPaths(keys, filters);
  }, [graph, findPaths, active, chosen, filters, allChosen]);
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
  const columnFares = useMemo(
    () =>
      graph.columns.map((_, index) => {
        if (!chosen[index]) return available.fares;
        const alternatives = [...chosen];
        alternatives[index] = null;
        return findPaths(alternatives, filters).fares;
      }),
    [graph, chosen, findPaths, filters, available.fares],
  );
  const visibleColumns = useMemo(
    () =>
      graph.columns.map((column, index) => {
        const price = (node: (typeof column)[number]) => {
          const quote = columnFares[index].get(node.id)?.price ?? node.price;
          return isVerifiedPrice(quote) &&
            (!currency || quote.currency === currency)
            ? quote
            : undefined;
        };
        return column
          .filter((node) =>
            chosen[index]
              ? chosen[index] === legKey(node.leg) ||
                flightMatchesFilters(node, filters)
              : !restrict || available.nodes.has(node.id),
          )
          .sort((a, b) => {
            const selected =
              Number(chosen[index] === legKey(b.leg)) -
              Number(chosen[index] === legKey(a.leg));
            if (selected) return selected;
            if (sortField !== "price") {
              const value = (node: typeof a) => {
                if (sortField === "departure")
                  return (
                    node.leg.segments[0]?.departure_time_local || undefined
                  );
                if (sortField === "arrival")
                  return (
                    node.leg.segments.at(-1)?.arrival_time_local || undefined
                  );
                const duration = node.leg.duration_minutes;
                return duration != null &&
                  Number.isFinite(duration) &&
                  duration > 0
                  ? duration
                  : undefined;
              };
              const left = value(a),
                right = value(b);
              if (left === undefined) return right === undefined ? 0 : 1;
              if (right === undefined) return -1;
              const comparison =
                typeof left === "number" && typeof right === "number"
                  ? left - right
                  : String(left).localeCompare(String(right));
              return sortOrder === "ascending" ? comparison : -comparison;
            }
            const left = price(a),
              right = price(b);
            if (left === undefined) return right === undefined ? 0 : 1;
            if (right === undefined) return -1;
            return (
              left.currency.localeCompare(right.currency) ||
              (sortOrder === "ascending"
                ? left.amount - right.amount
                : right.amount - left.amount)
            );
          });
      }),
    [
      graph,
      chosen,
      filters,
      restrict,
      available,
      columnFares,
      currency,
      sortOrder,
      sortField,
    ],
  );
  const returnFlights = visibleColumns[visits.length] ?? [];
  const selectedReturn = returnFlights.find(
    (node) => chosen[visits.length] === legKey(node.leg),
  );
  const returnDays = [
    ...new Set(
      returnFlights
        .map((node) => node.leg.segments[0].departure_time_local?.slice(0, 10))
        .filter((date): date is string => Boolean(date)),
    ),
  ].sort();
  const returnDateLabel =
    selectedReturn?.leg.segments[0].departure_time_local?.slice(0, 10) ??
    (returnDays.length > 1
      ? `${returnDays[0]} – ${returnDays.at(-1)}`
      : returnDays[0]) ??
    returnDate;

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
            disabled={
              busy || (selectedCount === 0 && retainedFlightCount === 0)
            }
            onClick={() => onChoose([])}
          >
            Clear selections
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
          label={`Total trip cost${currency && priced ? ` · ${priceLabel({ amount: effectiveLimit ?? maximum, currency, status: "verified" })} maximum` : ""}`}
        >
          <Slider
            aria-label="Maximum total trip cost"
            aria-valuetext={
              currency && priced
                ? priceLabel({
                    amount: effectiveLimit ?? maximum,
                    currency,
                    status: "verified",
                  })
                : "Price unconfirmed"
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
              ? `Complete trips from ${priceLabel({ amount: range.minTotal, currency, status: "verified" })}. Shared outbound and return fares counted once.`
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
        <Menu checkedValues={{ sortField: [sortField] }}>
          <MenuTrigger disableButtonEnhancement>
            {(triggerProps: MenuButtonProps) => (
              <SplitButton
                menuButton={{
                  ...triggerProps,
                  "aria-label": "Choose sort field",
                }}
                primaryActionButton={{
                  "aria-label": `${sortFields[sortField]}: ${sortOrder}`,
                  title: `Sort ${sortOrder === "ascending" ? "descending" : "ascending"}. Selected flights stay first; missing values stay last.`,
                  onClick: () =>
                    setSortOrder((order) =>
                      order === "ascending" ? "descending" : "ascending",
                    ),
                }}
              >
                {sortFields[sortField]}{" "}
                <span aria-hidden="true">
                  {sortOrder === "ascending" ? "↑" : "↓"}
                </span>
              </SplitButton>
            )}
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {(Object.keys(sortFields) as SortField[]).map((field) => (
                <MenuItemRadio
                  key={field}
                  name="sortField"
                  value={field}
                  onClick={() => setSortField(field)}
                >
                  {sortFields[field]}
                </MenuItemRadio>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
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
        {result?.savedOnly && !searching
          ? "Your saved flights are shown. Find flights to load more options."
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
                : "Choose flights, open booking links, and mark booked flights on their cards."}
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
                      {(
                        index < visits.length
                          ? visits[index].presentFrom
                          : returnDateLabel
                      )
                        ? ` · ${index < visits.length ? visits[index].presentFrom : returnDateLabel}`
                        : ""}
                    </Text>
                  </div>
                </header>
                {nodes.length === 0 && !searching && (
                  <div className="flight-grid-empty">
                    {result?.savedOnly
                      ? "No flight selected. Find flights to see options."
                      : restrict
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
                      highlightEnabled={!chosen[index] || selected}
                      connected={connected}
                      selected={selected}
                      preferred={legUsesPreferredAirline(
                        node.leg,
                        preferredAirlines,
                      )}
                      actions={cardActions.get(node.id)}
                      muted={
                        Boolean(chosen[index] && !selected) ||
                        Boolean(active && active !== node.id && !connected)
                      }
                      total={available.prices.get(node.id)}
                      farePrice={fare.price}
                      verificationPrice={
                        available.fares.get(node.id)?.price ?? node.price
                      }
                      fareLabel={fare.label}
                      restrict={restrict}
                      hasCompletePath={available.nodes.has(node.id)}
                      searching={searching}
                      busy={busy}
                      cities={cities}
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
    </div>
  );
}
