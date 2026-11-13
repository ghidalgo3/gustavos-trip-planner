import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test } from "vitest";
import {
  Button,
  Dialog,
  DialogBody,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import { useActionToast } from "./useActionToast";

function Example() {
  const [open, setOpen] = useState(false);
  const { notify, toaster } = useActionToast();
  return (
    <>
      <Button onClick={() => notify("Saved notification", "error")}>
        Notify
      </Button>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Example dialog</DialogTitle>
            <Button onClick={() => notify("Dialog notification", "error")}>
              Notify from dialog
            </Button>
            <Button onClick={() => setOpen(false)}>Close dialog</Button>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      {toaster}
    </>
  );
}

test("notifications keep the same viewport host when modal focus changes and remain dismissible", async () => {
  render(
    <ColorSchemeProvider>
      <Example />
    </ColorSchemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Notify" }));
  const toast = await screen.findByText("Saved notification");
  const portal = toast.closest(".action-toast-portal");
  expect(portal?.parentElement).toBe(document.body);
  const toaster = toast.closest(".fui-Toaster");
  expect(toaster).toHaveAttribute("data-toaster-position", "top-end");
  fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
  const close = await screen.findByRole("button", { name: "Close dialog" });
  act(() => close.focus());
  expect(toast.closest(".action-toast-portal")).toBe(portal);
  expect(toast.closest('[role="dialog"]')).toBeNull();
  const dismiss = await screen.findByRole("button", {
    name: "Dismiss notification",
  });
  act(() => dismiss.focus());
  expect(dismiss).toHaveFocus();
  expect(toast.closest(".fui-Toaster")).toBe(toaster);
  act(() => close.focus());
  fireEvent.click(close);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(toast.closest(".action-toast-portal")).toBe(portal);
  fireEvent.click(dismiss);
  await waitFor(() => expect(toast).not.toBeInTheDocument());
});

test.each(["button", "Escape"])(
  "dismissing a focused notification with %s restores focus and accessibility to the open dialog",
  async (method) => {
    render(
      <ColorSchemeProvider>
        <Example />
      </ColorSchemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Example dialog",
    });
    const notify = within(dialog).getByRole("button", {
      name: "Notify from dialog",
    });
    act(() => notify.focus());
    fireEvent.click(notify);
    const toast = await screen.findByText("Dialog notification");
    const dismiss = await screen.findByRole("button", {
      name: "Dismiss notification",
    });
    act(() => dismiss.focus());
    await waitFor(() => expect(dialog).toHaveAttribute("aria-hidden", "true"));
    if (method === "button") fireEvent.click(dismiss);
    else fireEvent.keyDown(dismiss, { key: "Escape" });
    await waitFor(() => expect(toast).not.toBeInTheDocument());
    expect(notify).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Example dialog" })).toBe(dialog);
  },
);
