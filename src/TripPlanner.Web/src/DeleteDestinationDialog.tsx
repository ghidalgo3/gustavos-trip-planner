import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
} from "@fluentui/react-components";
import type { Destination } from "./activitiesApi";

export default function DeleteDestinationDialog({
  destination,
  busy,
  error,
  onCancel,
  onDelete,
}: {
  destination?: Destination;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog
      open={Boolean(destination)}
      onOpenChange={(_, data) => {
        if (!data.open && !busy) onCancel();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Delete {destination?.properties.name}?</DialogTitle>
          <DialogContent>
            <p>
              This deletes all visits to {destination?.properties.name} and all
              activities saved there. This cannot be undone.
            </p>
            {error && <Text role="alert">{error}</Text>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={busy} onClick={onDelete}>
              {busy ? "Deleting…" : "Delete destination"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
