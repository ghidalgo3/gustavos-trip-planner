import { Text } from "@fluentui/react-components";
import type { ActivityResearchEvidence, ActivityInput } from "./activitiesApi";
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
