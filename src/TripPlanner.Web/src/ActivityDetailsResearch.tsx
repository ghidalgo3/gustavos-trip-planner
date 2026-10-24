import { useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import {
  researchActivityDetails,
  type ActivityCost,
  type ActivityDetailsSuggestion,
  type ActivityInput,
  type ActivityResearchEvidence,
  type Destination,
} from "./activitiesApi";
import { durationMinutes } from "./durations";

function costLabel(cost: ActivityCost | null) {
  return cost
    ? `${new Intl.NumberFormat(undefined, { style: "currency", currency: cost.currency }).format(cost.amount)} ${cost.basis === "perPerson" ? "per person" : "total"}`
    : "Unknown";
}
function durationLabel(value: string | null) {
  return value ? `${durationMinutes(value)} minutes` : "Unknown";
}
function Evidence({ value }: { value: ActivityResearchEvidence }) {
  return (
    <>
      <Text>{value.notes}</Text>
      <a href={value.source.url} target="_blank" rel="noreferrer">
        {value.source.label ?? "View source"}
      </a>
      <Text size={200}>
        Researched {new Date(value.researchedAt).toLocaleDateString()}
      </Text>
    </>
  );
}

export default function ActivityDetailsResearch({
  tripId,
  destination,
  activity,
  etag,
  canResearch,
  busy,
  onBusyChange,
  onChange,
  notify,
}: {
  tripId: string;
  destination: Destination;
  activity: ActivityInput;
  etag?: string;
  canResearch: boolean;
  busy: boolean;
  onBusyChange: (value: boolean) => void;
  onChange: (changes: Partial<ActivityInput["properties"]>) => void;
  notify: (message: string, intent?: "success" | "error" | "info") => void;
}) {
  const [suggestion, setSuggestion] =
    useState<ActivityDetailsSuggestion | null>(null);
  const [researching, setResearching] = useState(false);
  async function research() {
    if (!activity.id || !etag || busy) return;
    onBusyChange(true);
    setResearching(true);
    setSuggestion(null);
    try {
      const result = await researchActivityDetails(
        tripId,
        destination,
        activity.id,
        etag,
      );
      setSuggestion(result);
      if (!result)
        notify(
          "No supported duration or cost was found. You can still enter them manually.",
          "info",
        );
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not research duration and cost.",
        "error",
      );
    } finally {
      setResearching(false);
      onBusyChange(false);
    }
  }
  function accept(field: "duration" | "cost") {
    if (field === "duration" && suggestion?.duration) {
      onChange({
        duration: suggestion.duration.value,
        durationEvidence: suggestion.duration.evidence,
      });
    } else if (field === "cost" && suggestion?.cost) {
      onChange({
        cost: suggestion.cost.value,
        costEvidence: suggestion.cost.evidence,
      });
    } else return;
    setSuggestion((current) =>
      current ? { ...current, [field]: null } : null,
    );
    notify(
      `${field === "duration" ? "Duration" : "Cost"} selected. Save the activity to apply it.`,
    );
  }
  return (
    <>
      {canResearch && activity.id && (
        <div className="activity-details-research-actions">
          <Button disabled={busy} onClick={() => void research()}>
            {researching
              ? "Researching duration and cost…"
              : "Research duration and cost"}
          </Button>
          <Text size={200}>
            Uses saved activity details and destination dates. Review each
            suggestion before saving.
          </Text>
        </div>
      )}
      {suggestion && (suggestion.duration || suggestion.cost) && (
        <section
          className="activity-details-suggestion"
          aria-label="Suggested duration and cost"
        >
          {suggestion.duration ? (
            <div className="activity-research-field">
              <Text weight="semibold">
                Duration: {durationLabel(activity.properties.duration)} →{" "}
                {durationLabel(suggestion.duration.value)}
              </Text>
              <Evidence value={suggestion.duration.evidence} />
              <Button disabled={busy} onClick={() => accept("duration")}>
                Use this duration
              </Button>
            </div>
          ) : (
            <Text>No duration suggestion.</Text>
          )}
          {suggestion.cost ? (
            <div className="activity-research-field">
              <Text weight="semibold">
                Cost: {costLabel(activity.properties.cost)} →{" "}
                {costLabel(suggestion.cost.value)}
              </Text>
              <Evidence value={suggestion.cost.evidence} />
              <Button disabled={busy} onClick={() => accept("cost")}>
                Use this cost
              </Button>
            </div>
          ) : (
            <Text>No cost suggestion.</Text>
          )}
          <Button disabled={busy} onClick={() => setSuggestion(null)}>
            Dismiss suggestions
          </Button>
        </section>
      )}
      <ActivityDetailsEvidence properties={activity.properties} />
    </>
  );
}

export function ActivityDetailsEvidence({
  properties,
}: {
  properties: ActivityInput["properties"];
}) {
  return (
    <>
      {properties.durationEvidence && (
        <section
          className="activity-research-field"
          aria-label="Duration evidence"
        >
          <Text weight="semibold">Duration source and assumptions</Text>
          <Evidence value={properties.durationEvidence} />
        </section>
      )}
      {properties.costEvidence && (
        <section className="activity-research-field" aria-label="Cost evidence">
          <Text weight="semibold">Cost source and conditions</Text>
          <Evidence value={properties.costEvidence} />
        </section>
      )}
    </>
  );
}
