import { ActivityLogSkeleton } from "./TripSkeletons";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Select,
  Text,
  Title2,
} from "@fluentui/react-components";
import {
  getActivityLog,
  type ActivityLogEntry,
  type ActivityLogSource,
} from "../../api/api";

export default function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<ActivityLogSource | "">("");
  const [skip, setSkip] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getActivityLog(skip, controller.signal, source || undefined)
      .then((page) => {
        if (controller.signal.aborted) return;
        setEntries((existing) =>
          skip === 0 ? page.entries : [...existing, ...page.entries],
        );
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
  }, [refresh, source, skip]);

  return (
    <Card
      size="small"
      className="profile-activity-log"
      aria-labelledby="activity-log-title"
    >
      <div className="activity-log-heading">
        <Title2 as="h2" id="activity-log-title">
          Activity Log
        </Title2>
        <div className="activity-log-controls">
          <Select
            size="small"
            aria-label="Activity source"
            value={source}
            onChange={(_, data) => {
              setSource(data.value as ActivityLogSource | "");
              setSkip(0);
              setEntries([]);
              setHasMore(false);
              setLoading(true);
              setError(undefined);
            }}
          >
            <option value="">All sources</option>
            <option value="API">API</option>
            <option value="MCP">MCP</option>
          </Select>
          <Button
            size="small"
            appearance="secondary"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError(undefined);
              setSkip(0);
              setRefresh((value) => value + 1);
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      {error && <Text role="alert">{error}</Text>}
      {!loading && !error && entries.length === 0 && (
        <Text>
          {source ? `No ${source} changes yet.` : "No trip changes yet."}
        </Text>
      )}
      <ol className="activity-log-entries">
        {entries.map((entry) => {
          const isMcp = ["ChatGPT", "Muse", "MCP"].includes(entry.source);
          const isApi =
            entry.source === "Website" || entry.source === "API client";
          return (
            <li key={entry.id} className="activity-log-entry">
              <div className="activity-log-heading">
                <Text size={200}>
                  <strong>{entry.action}</strong> · {entry.tripName}
                </Text>
                <Badge
                  size="small"
                  appearance="tint"
                  color={isMcp ? "brand" : "informative"}
                >
                  {isMcp ? "MCP" : isApi ? "API" : entry.source}
                </Badge>
              </div>
              {entry.description !== entry.action && (
                <Text size={200}>{entry.description}</Text>
              )}
              <div className="activity-log-meta">
                <span>
                  By {entry.actorName} · {entry.source}
                </span>
                <time dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString()}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
      {loading && <ActivityLogSkeleton />}
      {hasMore && (
        <Button
          size="small"
          appearance="secondary"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError(undefined);
            setSkip(entries.length);
            setRefresh((value) => value + 1);
          }}
        >
          {loading ? "Loading…" : "Load more activity"}
        </Button>
      )}
    </Card>
  );
}
