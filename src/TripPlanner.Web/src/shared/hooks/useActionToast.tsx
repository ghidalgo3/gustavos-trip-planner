import { useCallback, useRef } from "react";
import {
  Button,
  Portal,
  useModalAttributes,
  Toast,
  Toaster,
  ToastTitle,
  ToastTrigger,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";

export function useActionToast({ trapFocus = true } = {}) {
  // Keep notifications outside transformed drawers/dialogs, but reachable while a modal is open.
  const { modalAttributes } = useModalAttributes({
    trapFocus,
    alwaysFocusable: true,
  });
  const toasterId = useId("action-feedback");
  const { dispatchToast, dismissAllToasts } = useToastController(toasterId);
  const toastHost = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const notify = useCallback(
    (message: string, intent: "success" | "error" | "info" = "success") => {
      dismissAllToasts();
      dispatchToast(
        <Toast>
          <ToastTitle
            action={
              <ToastTrigger>
                <Button
                  aria-label="Dismiss notification"
                  icon={<Dismiss20Regular />}
                />
              </ToastTrigger>
            }
          >
            {message}
          </ToastTitle>
        </Toast>,
        {
          intent,
          timeout: intent === "error" ? -1 : 6000,
          onStatusChange: (_, { status }) => {
            const host = toastHost.current;
            if (
              status === "dismissed" &&
              host?.contains(host.ownerDocument.activeElement) &&
              previousFocus.current?.isConnected
            ) {
              // Return ownership to the dialog before the focused toast is removed.
              previousFocus.current.focus();
            }
          },
        },
      );
    },
    [dispatchToast, dismissAllToasts],
  );

  return {
    notify,
    dispatchToast,
    toaster: (
      <Portal mountNode={{ className: "action-toast-portal" }}>
        <div
          {...modalAttributes}
          ref={toastHost}
          onFocusCapture={(event) => {
            if (
              event.relatedTarget instanceof HTMLElement &&
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              previousFocus.current = event.relatedTarget;
            }
          }}
        >
          <Toaster
            inline
            toasterId={toasterId}
            position="top-end"
            className="action-toaster"
            pauseOnHover
            pauseOnWindowBlur
          />
        </div>
      </Portal>
    ),
  };
}
