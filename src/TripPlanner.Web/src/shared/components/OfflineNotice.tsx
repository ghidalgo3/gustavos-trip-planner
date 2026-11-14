import { Button } from "@fluentui/react-components";
import { useEffect, useState } from "react";

export const offlineNoticeDelayMs = 30_000;

export default function OfflineNotice({
  offline,
  onRetry,
}: {
  offline: boolean;
  onRetry: () => void;
}) {
  // Unmount the timer on recovery so a later interruption gets a fresh delay.
  return offline ? <DelayedOfflineNotice onRetry={onRetry} /> : null;
}

function DelayedOfflineNotice({ onRetry }: { onRetry: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(true),
      offlineNoticeDelayMs,
    );
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="offline-notice" role="status">
      <span>Offline · View only</span>
      <Button
        size="small"
        appearance="outline"
        onClick={onRetry}
        aria-label="Retry connection"
      >
        Retry
      </Button>
    </div>
  );
}
