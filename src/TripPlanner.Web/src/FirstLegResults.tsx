import { useFlightChoiceConfirmation } from "./useFlightChoiceConfirmation";
import { useState } from "react";
import { Button, Text, Title3 } from "@fluentui/react-components";
import FlightInformation from "./FlightInformation";
import FlightLegTabs from "./FlightLegTabs";
import { legKey, legRoute } from "./flightFormatting";
import { flightAirportCodes, useAirportCities } from "./airportCities";
import type { FareSearchResult, FareLeg, FareItinerary } from "./operationsApi";
import type { PlanningParty } from "./planningApi";
import type { PartySettings } from "./planningApi";
import type { FlightChoiceProgress } from "./selectedFlightsApi";

export default function FirstLegResults({
  results,
  parties,
  partySettings = [],
  choices,
  legCount,
  onChoose,
  searching = true,
}: {
  results: FareSearchResult[];
  parties: PlanningParty[];
  partySettings?: PartySettings[];
  choices: Record<string, FlightChoiceProgress>;
  legCount: number;
  onChoose: (partyId: string, keys: (string | null)[]) => Promise<boolean>;
  searching?: boolean;
}) {
  const { confirm, dialog } = useFlightChoiceConfirmation();
  const [busyParty, setBusyParty] = useState<string>();
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  async function choose(partyId: string, keys: (string | null)[]) {
    if (
      choices[partyId]?.legKeys.some(
        (key, index) => key && key !== keys[index],
      ) &&
      !(await confirm(choices[partyId].legKeys, keys))
    )
      return;
    setBusyParty(partyId);
    try {
      const saved = await onChoose(partyId, keys);
      setSaveErrors((errors) => ({
        ...errors,
        [partyId]: saved ? "" : "Could not save this flight. Please try again.",
      }));
    } catch (reason) {
      setSaveErrors((errors) => ({
        ...errors,
        [partyId]:
          reason instanceof Error
            ? reason.message
            : "Could not save this flight. Please try again.",
      }));
    } finally {
      setBusyParty(undefined);
    }
  }
  const options = results.flatMap<{
    partyId: string;
    leg: FareLeg;
    itinerary: FareItinerary;
    request: FareSearchResult["request"];
    legIndex?: number;
  }>((result) =>
    result.response.flights
      ? result.response.flights.map((flight) => ({
          partyId: result.partyId,
          leg: flight.leg,
          itinerary: { price: flight.price },
          request: result.request,
          legIndex: flight.legIndex,
        }))
      : result.request.searchKind !== "oneWay"
        ? []
        : result.response.itineraries.flatMap((itinerary, index) => {
            const leg = itinerary.outbound;
            if (!leg || result.evaluations[index]?.status === "Rejected")
              return [];
            return [
              {
                partyId: result.partyId,
                leg,
                itinerary,
                request: result.request,
                legIndex: undefined,
              },
            ];
          }),
  );
  const cities = useAirportCities(
    flightAirportCodes(options.map((option) => option.leg)),
  );
  return (
    <div className="first-leg-results">
      {dialog}
      {parties.map((party) => {
        const preferredAirlines =
          partySettings.find((settings) => settings.partyId === party.id)
            ?.preferredAirlines ?? [];
        const chosen = choices[party.id]?.legKeys ?? [];
        const partyName =
          party.members.map((member) => member.name).join(", ") ||
          "Travel party";
        const missing = chosen.findIndex((key) => !key);
        const step = missing < 0 ? chosen.length : missing;
        const nextOrigins = choices[party.id]?.nextOrigins ?? [];
        const unique = new Map<string, (typeof options)[number]>();
        for (const option of options
          .filter(
            (option) =>
              option.partyId === party.id &&
              (option.legIndex != null
                ? option.legIndex === step
                : step === 0
                  ? option.request.searchPriority === 0
                  : nextOrigins.includes(option.request.origin)),
          )
          .sort(
            (a, b) =>
              (a.itinerary.price?.amount ?? Infinity) -
              (b.itinerary.price?.amount ?? Infinity),
          )) {
          const key = legKey(option.leg);
          if (!unique.has(key)) unique.set(key, option);
        }
        const choicesForParty = [...unique.values()];
        const byAirline = new Map<string, (typeof options)[number]>();
        for (const option of choicesForParty) {
          const carrier =
            option.leg.carrier ||
            option.leg.segments[0]?.operating_carrier_name ||
            option.leg.segments[0]?.marketing_carrier_code ||
            "Unknown airline";
          if (!byAirline.has(carrier)) byAirline.set(carrier, option);
        }
        const featured = [
          ...new Map(
            [choicesForParty[0], ...byAirline.values(), ...choicesForParty]
              .filter((option): option is (typeof options)[number] =>
                Boolean(option),
              )
              .map((option) => [legKey(option.leg), option] as const),
          ).values(),
        ];
        const routes = Array.from({ length: legCount }, (_, index) => {
          const leg = chosen[index]
            ? options.find(
                (option) =>
                  option.partyId === party.id &&
                  legKey(option.leg) === chosen[index],
              )?.leg
            : index === step
              ? choicesForParty[0]?.leg
              : undefined;
          return legRoute(leg);
        });
        return (
          <section key={party.id} aria-label={`First flights for ${partyName}`}>
            <Title3 as="h3">{partyName}</Title3>
            <FlightLegTabs
              legCount={legCount}
              chosen={chosen}
              step={step}
              label={partyName}
              routes={routes}
              busy={busyParty === party.id}
              onRevisit={(index) =>
                void choose(party.id, chosen.slice(0, index))
              }
            />
            {saveErrors[party.id] && (
              <Text role="alert">{saveErrors[party.id]}</Text>
            )}
            {busyParty === party.id && (
              <Text role="status">Saving flight choice…</Text>
            )}
            {step >= legCount ? (
              <Text role="status">
                {searching
                  ? "Checking the complete route as searches finish…"
                  : "No complete route matches these flights. Change an earlier flight."}
              </Text>
            ) : choicesForParty.length === 0 ? (
              <Text role="status">
                {searching
                  ? `Searching flights for flight ${step + 1}…`
                  : `No flight ${step + 1} options are available for these choices. Change an earlier flight or search again.`}
              </Text>
            ) : (
              <>
                <Text role="status">
                  {searching
                    ? "Available flights are shown as searches finish. Complete routes may change these choices."
                    : "Choose the next flight from the available search results."}
                </Text>
                {featured.slice(0, 6).map((option) => {
                  const key = legKey(option.leg);
                  return (
                    <FlightInformation
                      key={key}
                      leg={option.leg}
                      cities={cities}
                      preferredAirlines={preferredAirlines}
                      price={option.itinerary.price}
                      actions={
                        <Button
                          appearance="primary"
                          disabled={busyParty === party.id}
                          onClick={() =>
                            void choose(
                              party.id,
                              Array.from(
                                { length: Math.max(chosen.length, step + 1) },
                                (_, index) =>
                                  index === step
                                    ? key
                                    : (chosen[index] ?? null),
                              ),
                            )
                          }
                        >
                          Choose flight {step + 1}
                        </Button>
                      }
                    />
                  );
                })}
              </>
            )}
            {step < legCount && featured.length > 6 && (
              <details>
                <summary>
                  More flight {step + 1} options ({featured.length - 6})
                </summary>
                {featured.slice(6).map((option) => {
                  const key = legKey(option.leg);
                  return (
                    <FlightInformation
                      key={key}
                      leg={option.leg}
                      cities={cities}
                      preferredAirlines={preferredAirlines}
                      price={option.itinerary.price}
                      actions={
                        <Button
                          appearance="primary"
                          disabled={busyParty === party.id}
                          onClick={() =>
                            void choose(
                              party.id,
                              Array.from(
                                { length: Math.max(chosen.length, step + 1) },
                                (_, index) =>
                                  index === step
                                    ? key
                                    : (chosen[index] ?? null),
                              ),
                            )
                          }
                        >
                          Choose flight {step + 1}
                        </Button>
                      }
                    />
                  );
                })}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
