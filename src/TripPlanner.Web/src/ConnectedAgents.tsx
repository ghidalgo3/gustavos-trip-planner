import { useEffect, useState } from "react";
import { Button, Card, Text, Title2 } from "@fluentui/react-components";
import { getMcpAccess, revokeMcpAccess } from "./api";

export default function ConnectedAgents() {
  const [access, setAccess] = useState<{
    enabled: boolean;
    connected: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getMcpAccess(controller.signal)
      .then(setAccess)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load connected agents.",
          );
      });
    return () => controller.abort();
  }, [retry]);
  async function disconnect() {
    setBusy(true);
    setError(undefined);
    try {
      await revokeMcpAccess();
      setAccess({ enabled: true, connected: false });
      setNotice(
        "ChatGPT disconnected. Previous actions remain in your Activity Log.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to disconnect ChatGPT.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!access?.enabled && !error) return null;
  return (
    <Card aria-label="Connected agents">
      <Title2 as="h2">Connected agents</Title2>
      {access?.enabled && (
        <Text>
          {access.connected
            ? "ChatGPT can access TripPlanner with the permissions you granted."
            : "ChatGPT is not connected to your TripPlanner account."}
        </Text>
      )}
      {notice && <Text role="status">{notice}</Text>}
      {error && (
        <>
          <Text role="alert">{error}</Text>
          <Button
            appearance="secondary"
            onClick={() => {
              setError(undefined);
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </>
      )}
      {access?.connected && (
        <Button
          appearance="secondary"
          disabled={busy}
          onClick={() => void disconnect()}
        >
          {busy ? "Disconnecting…" : "Disconnect ChatGPT"}
        </Button>
      )}
    </Card>
  );
}
