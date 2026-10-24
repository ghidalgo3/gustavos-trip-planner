import ContentSkeleton from "../../shared/components/ContentSkeleton";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Text, Title2 } from "@fluentui/react-components";
import { getActivityLog, type ActivityLogEntry } from "../../api/api";

export default function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getActivityLog(0, controller.signal)
      .then((page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load the activity log.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  async function loadMore() {
    setLoading(true);
    setError(undefined);
    try {
      const page = await getActivityLog(entries.length);
      setEntries((existing) => [...existing, ...page.entries]);
      setHasMore(page.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load more activity.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="profile-activity-log"
      aria-labelledby="activity-log-title"
    >
      <div className="activity-log-heading">
        <Title2 as="h2" id="activity-log-title">
          Activity Log
        </Title2>
        <Button
          appearance="secondary"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError(undefined);
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </Button>
      </div>
      <Text>
        Changes to your trips, including actions taken by connected agents.
      </Text>
      {error && <Text role="alert">{error}</Text>}

      {!loading && !error && entries.length === 0 && (
        <Text>No trip changes yet. New changes will appear here.</Text>
      )}
      <ol className="activity-log-entries">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card>
              <div className="activity-log-heading">
                <Text weight="semibold">{entry.action}</Text>
                <Badge
                  appearance="tint"
                  color={entry.source === "Website" ? "informative" : "brand"}
                >
                  {entry.source}
                </Badge>
              </div>
              <Text weight="semibold">{entry.tripName}</Text>
              {entry.description !== entry.action && (
                <Text>{entry.description}</Text>
              )}
              <Text>By {entry.actorName}</Text>
              <time dateTime={entry.occurredAt}>
                {new Date(entry.occurredAt).toLocaleString()}
              </time>
            </Card>
          </li>
        ))}
      </ol>
      {loading && <ContentSkeleton label="Loading activity" />}
      {hasMore && (
        <Button
          appearance="secondary"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          Load more activity
        </Button>
      )}
    </section>
  );
}
