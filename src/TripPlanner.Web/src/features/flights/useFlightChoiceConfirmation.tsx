import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import type { FlightSelections } from "./flightRouteGraph";

export function useFlightChoiceConfirmation() {
  const [open, setOpen] = useState(false);
  const resolve = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  useEffect(() => () => resolve.current?.(false), []);

  function settle(confirmed: boolean) {
    setOpen(false);
    resolve.current?.(confirmed);
    resolve.current = undefined;
  }

  function confirm(previous: FlightSelections, next: FlightSelections) {
    if (!previous.some((key, index) => key && key !== next[index]))
      return Promise.resolve(true);
    resolve.current?.(false);
    setOpen(true);
    return new Promise<boolean>((done) => {
      resolve.current = done;
    });
  }

  const dialog = (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && settle(false)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Deselect saved flights?</DialogTitle>
          <DialogContent>
            This will remove the saved flights you are changing. Those legs will
            be included the next time you search for flights.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => settle(false)}>Keep selections</Button>
            <Button appearance="primary" onClick={() => settle(true)}>
              Deselect flights
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
  return { confirm, dialog };
}
