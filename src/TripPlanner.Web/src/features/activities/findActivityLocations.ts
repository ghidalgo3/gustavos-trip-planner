import {
  getActivity,
  researchActivityLocation,
  saveActivity,
  type Activity,
  type Destination,
} from "./activitiesApi";

// Reuse the authorized, source-verified research endpoint and conditional resource replacement.
// Two workers bound AI calls; one failed venue does not discard other useful results.
export async function findActivityLocations({
  tripId,
  destination,
  activities,
  signal,
  onSaved,
  onProgress,
}: {
  tripId: string;
  destination: Destination;
  activities: Activity[];
  signal: AbortSignal;
  onSaved: (activity: Activity) => void;
  onProgress: (completed: number, total: number) => void;
}) {
  const missing = activities.filter((activity) => !activity.geometry);
  const counts = { found: 0, unresolved: 0, failed: 0, skipped: 0 };
  let next = 0,
    completed = 0;
  async function worker() {
    while (next < missing.length) {
      signal.throwIfAborted();
      const item = missing[next++];
      try {
        const current = await getActivity(
          tripId,
          destination.id,
          item.id,
          signal,
        );
        signal.throwIfAborted();
        if (current.activity.geometry) {
          counts.skipped++;
          onSaved(current.activity);
        } else {
          const suggestion = await researchActivityLocation(
            tripId,
            destination,
            item.id,
            current.etag,
            signal,
          );
          signal.throwIfAborted();
          if (!suggestion) counts.unresolved++;
          else {
            const links = current.activity.properties.links ?? [];
            const hasSource = links.some(
              (link) => link.url === suggestion.source.url,
            );
            if (!hasSource && links.length >= 20)
              throw new Error("No room for the location source link.");
            const saved = await saveActivity(
              tripId,
              destination,
              {
                ...current.activity,
                geometry: suggestion.geometry,
                properties: {
                  ...current.activity.properties,
                  placeName:
                    current.activity.properties.placeName ??
                    suggestion.venueName,
                  locationSuggestion: null,
                  links: hasSource ? links : [...links, suggestion.source],
                },
              },
              current.etag,
              signal,
            );
            signal.throwIfAborted();
            counts.found++;
            onSaved(saved);
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        counts.failed++;
      }
      onProgress(++completed, missing.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(2, missing.length) }, worker),
  );
  return counts;
}
